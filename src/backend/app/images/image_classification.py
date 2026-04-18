import asyncio
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from math import cos, radians, sqrt
from typing import Optional, Any, Literal
import re

import cv2
import numpy as np
from loguru import logger as log
from fastapi.concurrency import run_in_threadpool
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import settings
from app.models.enums import ImageStatus
from app.s3 import (
    get_obj_from_bucket,
    maybe_presign_s3_key,
    move_file_within_bucket,
    s3_client,
    s3_object_exists,
)


# Number of concurrent workers for parallel classification.
# Must not exceed the connection pool size (default 4) to avoid pool
# exhaustion, which silently leaves images stuck in STAGED.
CLASSIFICATION_CONCURRENCY = 4

# Hard timeout per image to avoid a single stuck S3 read / decode hanging the whole batch.
# If exceeded, the image is marked as REJECTED with a generic "Classification failed".
CLASSIFICATION_PER_IMAGE_TIMEOUT_SECONDS = 120

# Buffer radius in meters for coverage calculation
COVERAGE_BUFFER_METERS = 20.0

# Task states that indicate the task is ready for or past processing.
VERIFIED_TASK_STATES = {
    "READY_FOR_PROCESSING",
    "IMAGE_PROCESSING_STARTED",
    "IMAGE_PROCESSING_FINISHED",
    "IMAGE_PROCESSING_FAILED",
}

ImageUrlVariant = Literal["thumb", "full", "both"]


@dataclass(frozen=True)
class QualityThresholds:
    """Tuning values for image quality checks."""

    # Accept images that point mostly down
    # DJI gimbal pitch is typically ~-90 (down), 0 (horizon), >0 (up)
    max_gimbal_pitch_deg: float = -20.0

    # Blurry detection (Laplacian variance)
    min_sharpness: float = 100.0

    # Lens-cap / underexposed / overexposed detection (simple luminance stats).
    black_pixel_threshold: int = 20
    white_pixel_threshold: int = 235
    saturation_ratio_threshold: float = 0.90
    low_dynamic_range_threshold: float = 25
    low_stddev_threshold: float = 15.0
    very_dark_mean_threshold: float = 40.0
    very_bright_mean_threshold: float = 215.0

    # AOI sanity check (rough): if image is > ~100km away from project centroid, it's likely wrong project.
    far_from_project_km: float = 100.0


Q = QualityThresholds()


class ImageClassifier:
    @staticmethod
    def _to_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.strip())
            except ValueError:
                return None
        return None

    @staticmethod
    def _parse_gps(value: Any) -> Optional[float]:
        """Parse EXIF GPS values into decimal degrees."""
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if not isinstance(value, str):
            return None

        s = value.strip()
        # Fast path: plain float string
        try:
            return float(s)
        except ValueError:
            pass

        # DMS like: 8 deg 17' 58.73" S
        direction = 1.0
        if s.endswith(("S", "W")):
            direction = -1.0
            s = s[:-1].strip()
        elif s.endswith(("N", "E")):
            s = s[:-1].strip()

        m = re.match(
            r"(\d+(?:\.\d+)?)\s*(?:deg|°)?\s*(\d+(?:\.\d+)?)?['\s]*(\d+(?:\.\d+)?)?",
            s,
        )
        if not m:
            return None

        deg = float(m.group(1))
        minutes = float(m.group(2)) if m.group(2) else 0.0
        seconds = float(m.group(3)) if m.group(3) else 0.0
        return direction * (deg + minutes / 60.0 + seconds / 3600.0)

    @staticmethod
    def _rough_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Cheap distance approximation (km) for sanity checks."""
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        mean_lat = (lat1 + lat2) / 2.0
        km_lat = dlat * 111.0
        km_lon = dlon * 111.0 * cos(radians(mean_lat))
        return float(sqrt(km_lat * km_lat + km_lon * km_lon))

    GRID_SIZE = 4
    LOW_TEXTURE_LAPLACIAN = 30.0
    LOW_TEXTURE_RATIO_WATER = 0.6
    TEXTURED_PERCENTILE = 75

    @staticmethod
    def calculate_sharpness(image_bytes: bytes) -> float:
        """Calculate image sharpness using grid-based Laplacian variance.

        Divides the image into a grid and computes per-cell Laplacian variance.
        The representative sharpness is derived from cells that have texture,
        which prevents uniform regions (water, sand, snow) from dragging down
        the score.

        Args:
            image_bytes: Raw image file bytes

        Returns:
            float: Sharpness score (Laplacian variance). Higher = sharper.
                   Typical values:
                   - < 50: Very blurry
                   - 50-100: Moderately blurry
                   - 100-500: Acceptable sharpness
                   - > 500: Very sharp

        Raises:
            ValueError: If image cannot be decoded
        """
        result = ImageClassifier.calculate_sharpness_grid(image_bytes)
        return result["sharpness"]

    @staticmethod
    def calculate_sharpness_grid(image_bytes: bytes) -> dict[str, Any]:
        """Calculate grid-based sharpness and detect terrain type.

        Returns a dict with:
            sharpness: float — representative sharpness score
            terrain_type: str — detected terrain ("mixed", "water", "uniform", "textured")
            cell_scores: list[float] — per-cell Laplacian variances
            low_texture_ratio: float — fraction of cells that are low-texture
        """
        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("Failed to decode image")

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape
            grid = ImageClassifier.GRID_SIZE
            cell_h, cell_w = h // grid, w // grid

            cell_scores: list[float] = []
            for row in range(grid):
                for col in range(grid):
                    y0 = row * cell_h
                    x0 = col * cell_w
                    y1 = h if row == grid - 1 else y0 + cell_h
                    x1 = w if col == grid - 1 else x0 + cell_w
                    cell = gray[y0:y1, x0:x1]
                    lap = cv2.Laplacian(cell, cv2.CV_64F)
                    cell_scores.append(float(lap.var()))

            low_texture_cells = [
                s for s in cell_scores if s < ImageClassifier.LOW_TEXTURE_LAPLACIAN
            ]
            textured_cells = [
                s for s in cell_scores if s >= ImageClassifier.LOW_TEXTURE_LAPLACIAN
            ]
            low_texture_ratio = (
                len(low_texture_cells) / len(cell_scores) if cell_scores else 0.0
            )

            terrain_type = ImageClassifier._classify_terrain(
                img, low_texture_ratio, textured_cells
            )

            if textured_cells:
                sharpness = float(
                    np.percentile(textured_cells, ImageClassifier.TEXTURED_PERCENTILE)
                )
            else:
                sharpness = float(np.mean(cell_scores)) if cell_scores else 0.0

            log.debug(
                f"Grid sharpness: score={sharpness:.1f} terrain={terrain_type} "
                f"low_texture_ratio={low_texture_ratio:.0%} "
                f"cells={len(cell_scores)} textured={len(textured_cells)}"
            )

            return {
                "sharpness": sharpness,
                "terrain_type": terrain_type,
                "cell_scores": cell_scores,
                "low_texture_ratio": low_texture_ratio,
            }

        except Exception as e:
            log.error(f"Error calculating sharpness: {e}")
            raise ValueError(f"Failed to calculate sharpness: {e}") from e

    @staticmethod
    def _classify_terrain(
        bgr: np.ndarray,
        low_texture_ratio: float,
        textured_cells: list[float],
    ) -> str:
        """An heuristic for classifying dominant terrain type using color analysis (HSV/LAB).

        Uses HSV hue and saturation as the primary signal — these are largely
        invariant to brightness, solving false classifications caused by
        lighting conditions (e.g. bright water misclassified as snow).

        Returns one of:
            "water"            — blue/cyan hue, low texture (river, lake, ocean)
            "snow_ice"         — very low saturation, high value (snow, ice, glaciers)
            "sand"             — warm hue (yellow-orange), low saturation
            "bare_soil"        — warm-to-neutral hue, low saturation, mid-tone
            "dense_vegetation" — green hue, dark, low texture
            "urban"            — high texture, high contrast (buildings, roads)
            "vegetation"       — green hue, moderate texture (farmland, grassland)
            "mixed"            — mix of textured and low-texture regions
        """
        # --- Mostly textured image: use texture/contrast for urban vs vegetation ---
        if low_texture_ratio < 0.25:
            hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
            h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
            mean_hue = float(np.mean(h))
            mean_sat = float(np.mean(s))
            std_v = float(np.std(v))

            # Green-dominant → vegetation or dense_vegetation
            if 30 <= mean_hue <= 85 and mean_sat > 40:
                mean_v = float(np.mean(v))
                if mean_v < 90:
                    return "dense_vegetation"
                return "vegetation"

            if std_v > 50:
                return "urban"
            return "vegetation"

        # --- Mixed texture ---
        if low_texture_ratio < ImageClassifier.LOW_TEXTURE_RATIO_WATER:
            return "mixed"

        # --- High low-texture ratio: use color to distinguish terrain ---
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

        mean_hue = float(np.mean(h))  # 0-180 in OpenCV
        mean_sat = float(np.mean(s))  # 0-255
        mean_val = float(np.mean(v))  # 0-255

        blue_ratio = float(np.mean((h >= 85) & (h <= 135)))
        if blue_ratio > 0.3 and mean_sat > 20:
            return "water"

        if mean_val < 80 and mean_sat < 40 and blue_ratio > 0.15:
            return "water"

        # Dirty/muddy water: any hue but extremely uniform texture.
        # Water (even turbid) has near-zero Laplacian variance across the entire
        # image, unlike sand/soil which show grain and micro-shadows.
        # The key signal is texture, not color: zero textured cells means no
        # surface detail at all, which only happens with water (sand has grain).
        if low_texture_ratio >= 0.9 and textured_cells == []:
            return "water"

        if mean_sat < 30 and mean_val > 180:
            return "snow_ice"

        # Sand: warm hue (10-30 in OpenCV = orange-yellow), moderate saturation
        warm_ratio = float(np.mean(((h >= 8) & (h <= 35)) | (h < 8)))
        if warm_ratio > 0.4 and mean_sat > 25 and mean_sat < 120:
            return "sand"

        # Bare soil: low saturation, mid-tone, no strong hue
        if mean_sat < 50 and 60 < mean_val < 180:
            return "bare_soil"

        # Dense vegetation: green hue, dark
        green_ratio = float(np.mean((h >= 30) & (h <= 85)))
        if green_ratio > 0.3 and mean_val < 120:
            return "dense_vegetation"

        # Fallback by brightness
        if mean_val > 160:
            return "sand"

        return "bare_soil"

    @staticmethod
    def _decode_gray(image_bytes: bytes) -> np.ndarray:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    @staticmethod
    def _exposure_issues(gray: np.ndarray) -> tuple[list[str], dict[str, float]]:
        p5, p95 = np.percentile(gray, [5, 95])
        dynamic_range = float(p95 - p5)
        black_ratio = float(np.mean(gray < Q.black_pixel_threshold))
        white_ratio = float(np.mean(gray > Q.white_pixel_threshold))
        mean_luma = float(np.mean(gray))
        std_luma = float(np.std(gray))

        issues: list[str] = []
        if (
            mean_luma <= Q.very_dark_mean_threshold
            and std_luma <= Q.low_stddev_threshold
        ) or (
            black_ratio >= Q.saturation_ratio_threshold
            and dynamic_range <= Q.low_dynamic_range_threshold
        ):
            issues.append(
                f"Image appears mostly black (lens cap or severe underexposure): "
                f"mean={mean_luma:.0f}, std={std_luma:.0f}, range={dynamic_range:.0f}, "
                f"black_ratio={black_ratio:.0%}"
            )

        if (
            mean_luma >= Q.very_bright_mean_threshold
            and std_luma <= Q.low_stddev_threshold
        ) or (
            white_ratio >= Q.saturation_ratio_threshold
            and dynamic_range <= Q.low_dynamic_range_threshold
        ):
            issues.append(
                f"Image appears overexposed (mostly white / blown highlights): "
                f"mean={mean_luma:.0f}, std={std_luma:.0f}, range={dynamic_range:.0f}, "
                f"white_ratio={white_ratio:.0%}"
            )

        metrics = {
            "mean": mean_luma,
            "std": std_luma,
            "dynamic_range": dynamic_range,
            "black_ratio": black_ratio,
            "white_ratio": white_ratio,
        }
        return issues, metrics

    @staticmethod
    async def find_matching_task(
        db: Connection, project_id: uuid.UUID, latitude: float, longitude: float
    ) -> Optional[uuid.UUID]:
        query = """
            SELECT id
            FROM tasks
            WHERE project_id = %(project_id)s
            AND ST_Intersects(
                outline,
                ST_SetSRID(ST_MakePoint(%(longitude)s, %(latitude)s), 4326)
            )
            LIMIT 1;
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query,
                {
                    "project_id": str(project_id),
                    "latitude": latitude,
                    "longitude": longitude,
                },
            )
            result = await cur.fetchone()
            if not result:
                return None
            task_id = result["id"]
            return task_id if isinstance(task_id, uuid.UUID) else uuid.UUID(task_id)

    @staticmethod
    async def classify_single_image(
        db: Connection,
        image_id: uuid.UUID,
        project_id: uuid.UUID,
        project_centroid: Optional[tuple[float, float]] = None,
    ) -> dict[str, Any]:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                    id,
                    exif,
                    location,
                    ST_Y(location::geometry) AS lat,
                    ST_X(location::geometry) AS lon,
                    status,
                    rejection_reason,
                    s3_key
                FROM project_images
                WHERE id = %(image_id)s AND project_id = %(project_id)s
                """,
                {"image_id": str(image_id), "project_id": str(project_id)},
            )
            image = await cur.fetchone()

            if not image:
                return {
                    "image_id": str(image_id),
                    "status": ImageStatus.REJECTED,
                    "reason": "Image not found",
                }

        # If upload-time checks already decided this image is unusable (e.g., invalid GPS),
        # don't run the rest of classification. Preserve the existing status + reason.
        if image.get("status") in [
            ImageStatus.REJECTED.value,
            ImageStatus.INVALID_EXIF.value,
        ]:
            existing_reason = image.get("rejection_reason") or "Previously rejected"
            existing_status = ImageStatus(image.get("status"))
            log.info(
                f"Skipping classification for pre-rejected image: "
                f"image_id={image_id} status={existing_status.value} reason={existing_reason}"
            )
            return {
                "image_id": str(image_id),
                "status": existing_status,  # Return original status
                "reason": existing_reason,
            }

        issues = []
        exif_data = image.get("exif") or {}
        s3_key = image.get("s3_key")
        sharpness_score = None
        terrain_type = None

        # Check EXIF data FIRST before downloading image
        if not exif_data:
            issues.append("Image is missing camera information (EXIF data)")
            log.debug(f"EXIF check FAILED: image_id={image_id} no exif")
        else:
            log.debug(f"EXIF check passed: image_id={image_id}")

        # Extract GPS coordinates from stored EXIF data
        latitude = image.get("lat")
        longitude = image.get("lon")

        # Fallback: parse from EXIF strings (e.g. "8 deg 17' 58.73\" S")
        if latitude is None or longitude is None:
            latitude = ImageClassifier._parse_gps(exif_data.get("GPSLatitude"))
            longitude = ImageClassifier._parse_gps(exif_data.get("GPSLongitude"))

        # Validate numeric ranges
        if latitude is not None and longitude is not None:
            if abs(float(latitude)) > 90 or abs(float(longitude)) > 180:
                issues.append(
                    f"Invalid GPS coordinates (out of range): lat={latitude}, lon={longitude}"
                )
                log.debug(
                    f"GPS check FAILED (out of range): image_id={image_id} lat={latitude} lon={longitude}"
                )
                latitude = None
                longitude = None

        if latitude is None or longitude is None:
            issues.append("Image is missing GPS location data")
            log.debug(f"GPS check FAILED: image_id={image_id} no coordinates")
        else:
            log.debug(
                f"GPS check passed: image_id={image_id} lat={latitude:.6f} lon={longitude:.6f}"
            )

        # Parse UserComment for drone metadata (pitch, yaw, etc.)
        user_comment = exif_data.get("UserComment")
        drone_metadata = {}
        if isinstance(user_comment, str):
            try:
                drone_metadata = json.loads(user_comment)
            except (json.JSONDecodeError, TypeError):
                log.debug("Could not parse UserComment as JSON")

        # Merge drone metadata for quality checks
        quality_check_data = {**exif_data, **drone_metadata}

        # Check gimbal pitch (camera angle, not aircraft pitch)
        # Only use GimbalPitchDegree - FlightPitchDegree is aircraft attitude, not camera angle
        gimbal_angle_raw = quality_check_data.get(
            "GimbalPitchDegree"
        ) or quality_check_data.get("pitch")
        gimbal_angle = ImageClassifier._to_float(gimbal_angle_raw)
        if gimbal_angle_raw is not None and gimbal_angle is None:
            log.debug(
                f"Unparsable gimbal pitch: image_id={image_id} value={gimbal_angle_raw!r}"
            )
        elif gimbal_angle is not None and gimbal_angle > Q.max_gimbal_pitch_deg:
            issues.append(
                f"Camera must point down (gimbal pitch {Q.max_gimbal_pitch_deg:.0f}°"
                f" from horizon), got {gimbal_angle:.0f}°"
            )
            log.debug(
                f"Gimbal check FAILED: image_id={image_id} angle={gimbal_angle:.1f} max={Q.max_gimbal_pitch_deg:.0f}"
            )
        elif gimbal_angle is not None:
            log.debug(
                f"Gimbal check passed: image_id={image_id} angle={gimbal_angle:.1f}"
            )

        # Only download image if we haven't already found critical issues (EXIF/GPS)
        image_bytes = None
        if not issues:
            try:
                log.info(f"Downloading image from S3: {s3_key}")
                file_obj = await run_in_threadpool(
                    get_obj_from_bucket, settings.S3_BUCKET_NAME, s3_key
                )
                image_bytes = file_obj.read()
                log.debug(
                    f"Image download ok: image_id={image_id} size_mb={len(image_bytes) / 1024 / 1024:.2f}"
                )
            except Exception as e:
                log.error(f"Failed to download image from S3: {e}", exc_info=True)
                issues.append(f"Failed to download image: {str(e)[:100]}")

        # Check sharpness and exposure if image bytes available
        if image_bytes:
            try:
                grid_result = ImageClassifier.calculate_sharpness_grid(image_bytes)
                sharpness_score = grid_result["sharpness"]
                terrain_type = grid_result["terrain_type"]

                if sharpness_score < Q.min_sharpness:
                    issues.append(
                        f"Blurry (sharpness: {sharpness_score:.1f}, min: {Q.min_sharpness})"
                    )
                    log.debug(
                        f"Sharpness check FAILED: image_id={image_id} score={sharpness_score:.1f} "
                        f"min={Q.min_sharpness} terrain={terrain_type}"
                    )
                else:
                    log.debug(
                        f"Sharpness check passed: image_id={image_id} score={sharpness_score:.1f} "
                        f"terrain={terrain_type}"
                    )

                # Check exposure issues
                gray = ImageClassifier._decode_gray(image_bytes)
                exposure_issues, exposure_metrics = ImageClassifier._exposure_issues(
                    gray
                )

                # Debug-only: emit the raw metrics to logs for tuning.
                log.debug(
                    "Image quality metrics | "
                    f"id={image_id} file={s3_key} "
                    f"sharpness={sharpness_score:.1f} "
                    f"mean={exposure_metrics['mean']:.1f} std={exposure_metrics['std']:.1f} "
                    f"range(p95-p5)={exposure_metrics['dynamic_range']:.0f} "
                    f"black={exposure_metrics['black_ratio']:.0%} "
                    f"white={exposure_metrics['white_ratio']:.0%}"
                )

                # Add exposure issues (which now include metrics in the message)
                for issue in exposure_issues:
                    issues.append(issue)
                    log.debug(
                        f"Exposure check FAILED: image_id={image_id} issue={issue}"
                    )
            except Exception as e:
                log.warning(f"Could not calculate quality metrics: {e}")
                issues.append(f"Quality analysis failed: {str(e)[:100]}")

        # If there are any issues, reject the image with all reasons
        if issues:
            # Determine the primary status based on issue types
            has_exif_issue = any(
                "camera information" in issue.lower() or "gps" in issue.lower()
                for issue in issues
            )
            rejection_reason = "; ".join(issues)

            status = (
                ImageStatus.INVALID_EXIF if has_exif_issue else ImageStatus.REJECTED
            )

            await ImageClassifier._update_image_status(
                db, image_id, status, rejection_reason, sharpness_score, terrain_type
            )
            log.info(
                f"Image rejected: image_id={image_id} status={status.value} reason={rejection_reason}"
            )
            return {
                "image_id": str(image_id),
                "status": status,
                "reason": rejection_reason,
                "sharpness_score": sharpness_score,
                "terrain_type": terrain_type,
            }

        # All checks passed
        quality_details = (
            f"Gimbal: {gimbal_angle:.1f}°"
            if gimbal_angle is not None
            else "Gimbal: N/A"
        )
        if sharpness_score is not None:
            quality_details += f", Sharpness: {sharpness_score:.1f}"
        quality_details += " - All checks passed"
        log.debug(f"Quality check passed: image_id={image_id} {quality_details}")

        task_id = await ImageClassifier.find_matching_task(
            db, project_id, latitude, longitude
        )

        if not task_id:
            rejection_reason = "Image location is outside of all task areas"
            if project_centroid is not None:
                c_lat, c_lon = project_centroid
                km_approx = ImageClassifier._rough_distance_km(
                    c_lat, c_lon, latitude, longitude
                )
                if km_approx > Q.far_from_project_km:
                    rejection_reason = f"Image {km_approx:.0f}km from project center (likely wrong project)"
                log.debug(
                    f"AOI sanity: image_id={image_id} approx_dist_km={km_approx:.0f}"
                )
            await ImageClassifier._update_image_status(
                db,
                image_id,
                ImageStatus.UNMATCHED,
                rejection_reason,
            )
            log.info(f"Image unmatched: image_id={image_id} reason={rejection_reason}")
            return {
                "image_id": str(image_id),
                "status": ImageStatus.UNMATCHED,
            }

        await ImageClassifier._assign_image_to_task(
            db, image_id, task_id, sharpness_score, terrain_type
        )
        log.info(f"Image assigned: image_id={image_id} task_id={task_id}")

        return {
            "image_id": str(image_id),
            "status": ImageStatus.ASSIGNED,
            "task_id": str(task_id),
            "sharpness_score": sharpness_score,
            "terrain_type": terrain_type,
        }

    @staticmethod
    async def _update_image_status(
        db: Connection,
        image_id: uuid.UUID,
        status: ImageStatus,
        rejection_reason: Optional[str] = None,
        sharpness_score: Optional[float] = None,
        terrain_type: Optional[str] = None,
    ) -> None:
        query = """
            UPDATE project_images
            SET status = %(status)s,
                rejection_reason = %(rejection_reason)s,
                sharpness_score = %(sharpness_score)s,
                terrain_type = %(terrain_type)s,
                classified_at = %(classified_at)s
            WHERE id = %(image_id)s
        """

        async with db.cursor() as cur:
            await cur.execute(
                query,
                {
                    "image_id": str(image_id),
                    "status": status.value,
                    "rejection_reason": rejection_reason,
                    "sharpness_score": sharpness_score,
                    "terrain_type": terrain_type,
                    "classified_at": datetime.utcnow(),
                },
            )

    @staticmethod
    async def _assign_image_to_task(
        db: Connection,
        image_id: uuid.UUID,
        task_id: uuid.UUID,
        sharpness_score: Optional[float] = None,
        terrain_type: Optional[str] = None,
    ) -> None:
        query = """
            UPDATE project_images
            SET status = %(status)s,
                task_id = %(task_id)s,
                sharpness_score = %(sharpness_score)s,
                terrain_type = %(terrain_type)s,
                classified_at = %(classified_at)s,
                rejection_reason = NULL
            WHERE id = %(image_id)s
        """

        async with db.cursor() as cur:
            await cur.execute(
                query,
                {
                    "image_id": str(image_id),
                    "status": ImageStatus.ASSIGNED.value,
                    "task_id": str(task_id),
                    "sharpness_score": sharpness_score,
                    "terrain_type": terrain_type,
                    "classified_at": datetime.utcnow(),
                },
            )

    @staticmethod
    async def classify_project(
        db_pool: AsyncConnectionPool, project_id: uuid.UUID
    ) -> dict[str, Any]:
        """Classify all staged/uploaded images in a project (across all batches)."""
        # Atomically claim pending rows and stale classifying rows.
        # - staged/uploaded: new work.
        # - classifying with classified_at older than the stale threshold: rows
        #   claimed by a previous job that crashed before finishing. We use
        #   classified_at as the claim timestamp (set to NOW() below, overwritten
        #   with the real finish time by classify_single_image).
        # - FOR UPDATE SKIP LOCKED: a live concurrent job still holds row locks
        #   during its claim transaction, so those rows are skipped - only truly
        #   abandoned rows (no lock holder) are reclaimed.
        stale_minutes = 10  # well beyond CLASSIFICATION_PER_IMAGE_TIMEOUT_SECONDS
        async with db_pool.connection() as db:
            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    """
                    UPDATE project_images
                    SET status = %(classifying)s,
                        classified_at = NOW()
                    WHERE id IN (
                        SELECT id
                        FROM project_images
                        WHERE project_id = %(project_id)s
                        AND (
                            status IN (%(staged)s, %(uploaded)s)
                            OR (
                                status = %(classifying)s
                                AND classified_at < NOW() - make_interval(mins => %(stale_minutes)s)
                            )
                        )
                        ORDER BY uploaded_at
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id
                    """,
                    {
                        "project_id": str(project_id),
                        "staged": ImageStatus.STAGED.value,
                        "uploaded": ImageStatus.UPLOADED.value,
                        "classifying": ImageStatus.CLASSIFYING.value,
                        "stale_minutes": stale_minutes,
                    },
                )
                images = await cur.fetchall()
            await db.commit()

        if not images:
            return {
                "project_id": str(project_id),
                "message": "No images to classify",
                "total": 0,
                "assigned": 0,
                "rejected": 0,
                "unmatched": 0,
                "invalid": 0,
                "images": [],
            }

        results: dict[str, Any] = {
            "project_id": str(project_id),
            "total": len(images),
            "assigned": 0,
            "rejected": 0,
            "unmatched": 0,
            "invalid": 0,
            "images": [],
        }

        # Fetch project centroid once for cheap sanity checks.
        project_centroid: Optional[tuple[float, float]] = None
        async with db_pool.connection() as db:
            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    """
                    SELECT
                        ST_Y(centroid::geometry) AS lat,
                        ST_X(centroid::geometry) AS lon
                    FROM projects
                    WHERE id = %(project_id)s
                    AND centroid IS NOT NULL
                    LIMIT 1;
                    """,
                    {"project_id": str(project_id)},
                )
                row = await cur.fetchone()
        if row and row.get("lat") is not None and row.get("lon") is not None:
            try:
                project_centroid = (float(row["lat"]), float(row["lon"]))
            except Exception:
                project_centroid = None

        # Use a semaphore to limit concurrency
        semaphore = asyncio.Semaphore(CLASSIFICATION_CONCURRENCY)
        # Lock for thread-safe counter updates
        results_lock = asyncio.Lock()

        def _format_classification_failure_reason(exc: BaseException) -> str:
            """Return a user-facing rejection_reason for unexpected classification failures."""
            # Prefer a generic message; include details only if we have something meaningful.
            msg = str(exc).strip()
            if not msg:
                return "Classification failed"
            # Avoid dumping huge stack-like content into the UI.
            # Truncate at word boundary if too long
            if len(msg) > 240:
                msg = msg[:240].rsplit(" ", 1)[0] + "..."
            return f"Classification failed: {msg}"

        async def classify_with_commit(image_record: dict[str, Any]) -> dict[str, Any]:
            """Classify a single image with its own connection for proper isolation."""
            async with semaphore:
                image_id = (
                    image_record["id"]
                    if isinstance(image_record["id"], uuid.UUID)
                    else uuid.UUID(image_record["id"])
                )

                # Each worker gets its own connection from the pool
                # (rows are already marked CLASSIFYING by the bulk claim above)
                async with db_pool.connection() as conn:
                    try:
                        # Perform classification with timeout
                        result = await asyncio.wait_for(
                            ImageClassifier.classify_single_image(
                                conn, image_id, project_id, project_centroid
                            ),
                            timeout=CLASSIFICATION_PER_IMAGE_TIMEOUT_SECONDS,
                        )
                        # Commit the classification result immediately
                        await conn.commit()

                    except asyncio.TimeoutError:
                        # Never leave an image stuck in CLASSIFYING.
                        log.warning(
                            f"Classification timed out for image {image_id} after "
                            f"{CLASSIFICATION_PER_IMAGE_TIMEOUT_SECONDS}s"
                        )
                        reason = "Classification failed (timed out)"
                        try:
                            await ImageClassifier._update_image_status(
                                conn,
                                image_id,
                                ImageStatus.REJECTED,
                                reason,
                            )
                            await conn.commit()
                        except Exception as rollback_err:
                            log.error(
                                f"Failed to update status after timeout for {image_id}: {rollback_err}"
                            )
                            await conn.rollback()

                        result = {
                            "image_id": str(image_id),
                            "status": ImageStatus.REJECTED,
                            "reason": reason,
                        }

                    except Exception as e:
                        # Never leave an image stuck in CLASSIFYING.
                        log.error(
                            f"Classification crashed for image {image_id}: {e}",
                            exc_info=True,
                        )
                        reason = _format_classification_failure_reason(e)
                        try:
                            await ImageClassifier._update_image_status(
                                conn,
                                image_id,
                                ImageStatus.REJECTED,
                                reason,
                            )
                            await conn.commit()
                        except Exception as rollback_err:
                            log.error(
                                f"Failed to update status after crash for {image_id}: {rollback_err}"
                            )
                            await conn.rollback()

                        result = {
                            "image_id": str(image_id),
                            "status": ImageStatus.REJECTED,
                            "reason": reason,
                        }

                # Update counters thread-safely
                async with results_lock:
                    if result["status"] == ImageStatus.ASSIGNED:
                        results["assigned"] += 1
                    elif result["status"] == ImageStatus.REJECTED:
                        results["rejected"] += 1
                    elif result["status"] == ImageStatus.UNMATCHED:
                        results["unmatched"] += 1
                    elif result["status"] == ImageStatus.INVALID_EXIF:
                        results["invalid"] += 1
                    results["images"].append(result)

                return result

        tasks = [classify_with_commit(image) for image in images]
        gather_results = await asyncio.gather(*tasks, return_exceptions=True)

        for image_record, result_or_exc in zip(images, gather_results):
            if isinstance(result_or_exc, BaseException):
                image_id = image_record["id"]
                log.error(
                    f"Classification worker failed for image {image_id} "
                    f"(project {project_id}): {result_or_exc!r}"
                )
                # Best-effort: mark the image as rejected so it isn't stuck
                try:
                    async with db_pool.connection() as err_conn:
                        await ImageClassifier._update_image_status(
                            err_conn,
                            image_id
                            if isinstance(image_id, uuid.UUID)
                            else uuid.UUID(image_id),
                            ImageStatus.REJECTED,
                            _format_classification_failure_reason(result_or_exc),
                        )
                        await err_conn.commit()
                    async with results_lock:
                        results["rejected"] += 1
                except Exception as cleanup_err:
                    log.error(
                        f"Failed to mark image {image_id} as rejected after worker error: {cleanup_err}"
                    )

        log.info(
            f"Parallel classification complete for project {project_id}: "
            f"{results['assigned']} assigned, {results['rejected']} rejected, "
            f"{results['unmatched']} unmatched, {results['invalid']} invalid"
        )

        # Auto-transition tasks that received images to HAS_IMAGERY
        newly_assigned_ids = [
            img["image_id"]
            for img in results["images"]
            if img.get("status") == ImageStatus.ASSIGNED
        ]
        if newly_assigned_ids:
            try:
                async with db_pool.connection() as db:
                    async with db.cursor(row_factory=dict_row) as cur:
                        await cur.execute(
                            """
                            WITH affected_tasks AS (
                                SELECT DISTINCT pi.task_id
                                FROM project_images pi
                                WHERE pi.project_id = %(project_id)s
                                AND pi.id = ANY(%(image_ids)s)
                                AND pi.status = 'assigned'
                                AND pi.task_id IS NOT NULL
                            ),
                            current_states AS (
                                SELECT DISTINCT ON (te.task_id) te.task_id, te.state, te.user_id
                                FROM task_events te
                                WHERE te.task_id IN (SELECT task_id FROM affected_tasks)
                                ORDER BY te.task_id, te.created_at DESC
                            )
                            SELECT
                                at.task_id,
                                COALESCE(cs.user_id, p.author_id) AS user_id
                            FROM affected_tasks at
                            LEFT JOIN current_states cs ON cs.task_id = at.task_id
                            JOIN projects p ON p.id = %(project_id)s::uuid
                            WHERE cs.state IS NULL
                               OR cs.state::text IN ('UNLOCKED', 'LOCKED', 'FULLY_FLOWN')
                            """,
                            {
                                "project_id": str(project_id),
                                "image_ids": newly_assigned_ids,
                            },
                        )
                        tasks_to_update = await cur.fetchall()

                    for task_row in tasks_to_update:
                        async with db.cursor() as cur:
                            await cur.execute(
                                """
                                INSERT INTO task_events (event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
                                VALUES (gen_random_uuid(), %(project_id)s, %(task_id)s, %(user_id)s, 'HAS_IMAGERY', 'Images matched to task area', NOW(), NOW())
                                """,
                                {
                                    "project_id": str(project_id),
                                    "task_id": str(task_row["task_id"]),
                                    "user_id": str(task_row["user_id"]),
                                },
                            )
                        await db.commit()
                        log.info(
                            f"Auto-transitioned task {task_row['task_id']} to HAS_IMAGERY"
                        )
            except Exception as e:
                log.error(f"Failed to auto-transition tasks to HAS_IMAGERY: {e}")

        return results

    @staticmethod
    async def get_project_images(
        db: Connection,
        project_id: uuid.UUID,
        last_timestamp: Optional[datetime] = None,
        status_filter: Optional[list[str]] = None,
    ) -> list[dict]:
        """Get images for a project (across all batches).

        Supports incremental polling via last_timestamp and optional status filtering.
        """
        query = """
            SELECT
                id,
                filename,
                s3_key,
                thumbnail_url,
                status,
                rejection_reason,
                task_id,
                classified_at,
                uploaded_at,
                exif,
                terrain_type,
                ST_X(location::geometry) as longitude,
                ST_Y(location::geometry) as latitude
            FROM project_images
            WHERE project_id = %(project_id)s
        """

        params: dict[str, Any] = {"project_id": str(project_id)}

        if status_filter:
            query += " AND status = ANY(%(statuses)s)"
            params["statuses"] = status_filter

        if last_timestamp:
            query += " AND classified_at > %(last_timestamp)s"
            params["last_timestamp"] = last_timestamp

        query += " ORDER BY uploaded_at"

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, params)
            images = await cur.fetchall()

        for image in images:
            image["has_gps"] = (
                image.get("latitude") is not None and image.get("longitude") is not None
            )

        return images

    @staticmethod
    async def _maybe_transition_task_to_has_imagery(
        db: Connection,
        task_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> None:
        """Insert a HAS_IMAGERY event for the task if it hasn't reached that state yet."""
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT te.state, te.user_id
                FROM task_events te
                WHERE te.task_id = %(task_id)s
                ORDER BY te.created_at DESC
                LIMIT 1
                """,
                {"task_id": str(task_id)},
            )
            row = await cur.fetchone()

        current_state = row["state"] if row else None
        # Only transition if task hasn't already progressed past HAS_IMAGERY
        if current_state in (None, "UNLOCKED", "LOCKED", "FULLY_FLOWN"):
            # Get a user_id for the event (prefer existing, fall back to project author)
            user_id = row["user_id"] if row else None
            if not user_id:
                async with db.cursor(row_factory=dict_row) as cur:
                    await cur.execute(
                        "SELECT author_id FROM projects WHERE id = %(pid)s",
                        {"pid": str(project_id)},
                    )
                    proj = await cur.fetchone()
                    user_id = proj["author_id"] if proj else None

            if user_id:
                async with db.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO task_events
                            (event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
                        VALUES
                            (gen_random_uuid(), %(project_id)s, %(task_id)s, %(user_id)s,
                             'HAS_IMAGERY', 'Images matched to task area', NOW(), NOW())
                        """,
                        {
                            "project_id": str(project_id),
                            "task_id": str(task_id),
                            "user_id": str(user_id),
                        },
                    )
                log.info(f"Transitioned task {task_id} to HAS_IMAGERY")

    @staticmethod
    async def accept_image(
        db: Connection,
        image_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        # Get image location
        query = """
            SELECT
                ST_X(location::geometry) as longitude,
                ST_Y(location::geometry) as latitude
            FROM project_images
            WHERE id = %(image_id)s
            AND project_id = %(project_id)s
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query, {"image_id": str(image_id), "project_id": str(project_id)}
            )
            result = await cur.fetchone()

        if not result:
            raise ValueError("Image not found")

        latitude = result.get("latitude")
        longitude = result.get("longitude")

        if latitude is None or longitude is None:
            raise ValueError("Image has no GPS coordinates")

        # Find matching task
        task_id = await ImageClassifier.find_matching_task(
            db, project_id, latitude, longitude
        )

        if not task_id:
            # Update status to unmatched instead of throwing an error
            await ImageClassifier._update_image_status(
                db,
                image_id,
                ImageStatus.UNMATCHED,
                "Image location is outside of all task areas",
            )
            return {
                "message": "Image does not fall within any task boundary",
                "image_id": str(image_id),
                "status": "unmatched",
                "task_id": None,
            }

        # Update image status to assigned
        await ImageClassifier._assign_image_to_task(db, image_id, task_id)
        await ImageClassifier._maybe_transition_task_to_has_imagery(
            db, task_id, project_id
        )

        return {
            "message": "Image accepted successfully",
            "image_id": str(image_id),
            "status": "assigned",
            "task_id": str(task_id),
        }

    @staticmethod
    async def reject_image(
        db: Connection,
        image_id: uuid.UUID,
        project_id: uuid.UUID,
        reason: str = "Manually rejected by project manager",
    ) -> dict:
        """Manually reject an assigned image so it is excluded from task acceptance."""
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """SELECT id, status FROM project_images
                   WHERE id = %(image_id)s AND project_id = %(project_id)s""",
                {"image_id": str(image_id), "project_id": str(project_id)},
            )
            image = await cur.fetchone()

        if not image:
            raise ValueError(f"Image {image_id} not found in project {project_id}")

        if image["status"] != ImageStatus.ASSIGNED.value:
            raise ValueError("Only assigned images can be manually rejected")

        await ImageClassifier._update_image_status(
            db, image_id, ImageStatus.REJECTED, rejection_reason=reason
        )

        return {
            "message": "Image rejected successfully",
            "image_id": str(image_id),
            "status": "rejected",
        }

    @staticmethod
    async def manual_assign_to_task(
        db: Connection,
        image_id: uuid.UUID,
        task_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        """Manually assign an image to a task, bypassing GPS matching."""
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """SELECT id, status FROM project_images
                   WHERE id = %(image_id)s AND project_id = %(project_id)s""",
                {"image_id": str(image_id), "project_id": str(project_id)},
            )
            image = await cur.fetchone()

        if not image:
            raise ValueError(f"Image {image_id} not found in project {project_id}")

        if image["status"] == "assigned":
            raise ValueError("Image is already assigned to a task")
        if image["status"] != "unmatched":
            raise ValueError("Only unmatched images can be manually assigned to a task")

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """SELECT id FROM tasks
                   WHERE id = %(task_id)s AND project_id = %(project_id)s""",
                {"task_id": str(task_id), "project_id": str(project_id)},
            )
            task = await cur.fetchone()

        if not task:
            raise ValueError(f"Task {task_id} not found in project {project_id}")

        await ImageClassifier._assign_image_to_task(db, image_id, task_id)
        await ImageClassifier._maybe_transition_task_to_has_imagery(
            db, task_id, project_id
        )

        return {
            "message": "Image manually assigned to task",
            "image_id": str(image_id),
            "status": "assigned",
            "task_id": str(task_id),
        }

    @staticmethod
    async def delete_batch(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        keys_query = """
            SELECT s3_key, thumbnail_url, status
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                keys_query,
                {"batch_id": str(batch_id), "project_id": str(project_id)},
            )
            rows = await cur.fetchall()

        # Duplicates share the same S3 key as the original image, so
        # deleting the S3 object would destroy the original's file.
        s3_keys_to_delete: list[str] = []
        for row in rows:
            if row["status"] == ImageStatus.DUPLICATE.value:
                continue
            if row["s3_key"]:
                s3_keys_to_delete.append(str(row["s3_key"]).lstrip("/"))
            if row["thumbnail_url"]:
                s3_keys_to_delete.append(str(row["thumbnail_url"]).lstrip("/"))

        deleted_s3_count = 0
        if s3_keys_to_delete:
            client = s3_client()
            for key in s3_keys_to_delete:
                try:
                    client.remove_object(settings.S3_BUCKET_NAME, key)
                    deleted_s3_count += 1
                except Exception as e:
                    log.warning(f"Failed to delete S3 object {key}: {e}")

        delete_query = """
            DELETE FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
        """

        async with db.cursor() as cur:
            await cur.execute(
                delete_query,
                {"batch_id": str(batch_id), "project_id": str(project_id)},
            )

        await db.commit()

        image_count = len(rows)
        log.info(
            f"Deleted {image_count} images and {deleted_s3_count} S3 objects "
            f"from batch {batch_id} in project {project_id}"
        )

        return {
            "message": "Batch deleted successfully",
            "batch_id": str(batch_id),
            "deleted_count": image_count,
            "deleted_s3_count": deleted_s3_count,
        }

    @staticmethod
    async def delete_invalid_images(
        db: Connection,
        project_id: uuid.UUID,
    ) -> dict:
        """Delete unassigned invalid/unmatched images for a project from DB and S3.

        Only targets images that are NOT linked to a task (task_id IS NULL),
        matching the "Unassigned Images" section shown in the review UI.
        Task-linked rejected images (e.g. from flight-tail detection) are
        intentionally preserved.

        Targets statuses: rejected, invalid_exif, unmatched, duplicate.
        """
        invalid_statuses = ("rejected", "invalid_exif", "unmatched", "duplicate")

        keys_query = """
            SELECT id, s3_key, thumbnail_url, status
            FROM project_images
            WHERE project_id = %(project_id)s
            AND task_id IS NULL
            AND status = ANY(%(statuses)s)
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                keys_query,
                {
                    "project_id": str(project_id),
                    "statuses": list(invalid_statuses),
                },
            )
            rows = await cur.fetchall()

        if not rows:
            return {
                "message": "No invalid images to delete",
                "project_id": str(project_id),
                "deleted_count": 0,
                "deleted_s3_count": 0,
            }

        # Delete S3 objects per-image, tracking which images fully succeeded
        # so we only remove DB rows whose storage is actually gone.
        client = s3_client()
        deleted_s3_count = 0
        succeeded_image_ids: list[str] = []
        failed_image_ids: list[str] = []

        for row in rows:
            # Duplicates share the same S3 key as the original image, so
            # deleting the S3 object would destroy the original's file.
            # Only remove the DB row for duplicates; skip S3 deletion.
            if row["status"] == ImageStatus.DUPLICATE.value:
                succeeded_image_ids.append(row["id"])
                continue

            s3_key = str(row["s3_key"]).lstrip("/") if row["s3_key"] else None
            thumb_key = (
                str(row["thumbnail_url"]).lstrip("/") if row["thumbnail_url"] else None
            )

            image_ok = True
            for key in (s3_key, thumb_key):
                if not key:
                    continue
                try:
                    client.remove_object(settings.S3_BUCKET_NAME, key)
                    deleted_s3_count += 1
                except Exception as e:
                    log.warning(f"Failed to delete S3 object {key}: {e}")
                    image_ok = False

            if image_ok:
                succeeded_image_ids.append(row["id"])
            else:
                failed_image_ids.append(row["id"])

        # Only delete DB rows for images whose S3 objects were fully removed.
        if succeeded_image_ids:
            delete_query = """
                DELETE FROM project_images
                WHERE id = ANY(%(ids)s)
            """
            async with db.cursor() as cur:
                await cur.execute(delete_query, {"ids": succeeded_image_ids})
            await db.commit()

        deleted_count = len(succeeded_image_ids)
        failed_count = len(failed_image_ids)

        if failed_count:
            log.error(
                f"Partial cleanup for project {project_id}: "
                f"{deleted_count} images fully deleted, "
                f"{failed_count} images kept due to S3 failures"
            )
            return {
                "message": (
                    f"Partially completed: {deleted_count} image(s) deleted, "
                    f"but {failed_count} could not be fully removed from storage. "
                    f"Please retry."
                ),
                "project_id": str(project_id),
                "deleted_count": deleted_count,
                "deleted_s3_count": deleted_s3_count,
                "failed_count": failed_count,
            }

        log.info(
            f"Deleted {deleted_count} invalid images and {deleted_s3_count} S3 objects "
            f"from project {project_id}"
        )

        return {
            "message": "Invalid images deleted successfully",
            "project_id": str(project_id),
            "deleted_count": deleted_count,
            "deleted_s3_count": deleted_s3_count,
        }

    @staticmethod
    async def get_task_pending_transfer_count(
        db: Connection,
        project_id: uuid.UUID,
        task_id: uuid.UUID,
    ) -> int:
        """Count assigned task images that still point to user-uploads staging keys."""
        query = """
            SELECT COUNT(*)
            FROM project_images
            WHERE project_id = %(project_id)s
              AND task_id = %(task_id)s
              AND status = %(status)s
              AND s3_key LIKE '%%user-uploads%%'
        """

        async with db.cursor() as cur:
            await cur.execute(
                query,
                {
                    "project_id": str(project_id),
                    "task_id": str(task_id),
                    "status": ImageStatus.ASSIGNED.value,
                },
            )
            row = await cur.fetchone()

        return int(row[0]) if row else 0

    @staticmethod
    async def move_task_images_to_folder(
        db: Connection,
        project_id: uuid.UUID,
        task_id: uuid.UUID,
    ) -> dict:
        """Move all assigned images for a specific task from staging to the task folder.

        Copies images from user-uploads staging area to:
            projects/{project_id}/{task_id}/images/{filename}

        This is called after marking a task as verified/fully flown so that
        the images are in the expected location for ODM processing.
        """
        query = """
            SELECT
                pi.id,
                pi.filename,
                pi.s3_key,
                pi.thumbnail_url
            FROM project_images pi
            WHERE pi.project_id = %(project_id)s
            AND pi.task_id = %(task_id)s
            AND pi.status = %(status)s
            AND pi.s3_key LIKE '%%user-uploads%%'
            ORDER BY pi.uploaded_at
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query,
                {
                    "project_id": str(project_id),
                    "task_id": str(task_id),
                    "status": ImageStatus.ASSIGNED.value,
                },
            )
            images = await cur.fetchall()

        if not images:
            return {"moved_count": 0, "failed_count": 0}

        moved_count = 0
        failed_count = 0

        for image in images:
            filename = image["filename"]
            source_key = image["s3_key"]
            # Use the image's unique DB id as prefix to guarantee no collisions
            # (across batches, within a batch, or from duplicate filenames).
            image_id_prefix = str(image["id"])[:8]
            dest_key = (
                f"projects/{project_id}/{task_id}/images/{image_id_prefix}_{filename}"
            )

            success = await run_in_threadpool(
                move_file_within_bucket,
                settings.S3_BUCKET_NAME,
                source_key,
                dest_key,
            )

            if not success:
                dest_exists = await run_in_threadpool(
                    s3_object_exists,
                    settings.S3_BUCKET_NAME,
                    dest_key,
                )
                if dest_exists:
                    log.warning(
                        "Recovered image move by reconciling DB because destination "
                        f"already exists: {dest_key}"
                    )
                else:
                    failed_count += 1
                    log.error(f"Failed to move image {filename} to task {task_id}")
                    continue

            # Move thumbnail alongside the image so URLs stay valid
            # after user-uploads/ is cleaned up.
            new_thumb_key = None
            old_thumb = image.get("thumbnail_url")
            if old_thumb and "user-uploads" in old_thumb:
                new_thumb_key = (
                    f"projects/{project_id}/{task_id}/images/thumbs/"
                    f"{image_id_prefix}_{filename}"
                )
                thumb_ok = await run_in_threadpool(
                    move_file_within_bucket,
                    settings.S3_BUCKET_NAME,
                    old_thumb,
                    new_thumb_key,
                )
                if not thumb_ok:
                    thumb_dest_exists = await run_in_threadpool(
                        s3_object_exists,
                        settings.S3_BUCKET_NAME,
                        new_thumb_key,
                    )
                    if thumb_dest_exists:
                        log.warning(
                            "Recovered thumbnail move by reconciling DB because destination "
                            f"already exists: {new_thumb_key}"
                        )
                    else:
                        # Non-fatal: image itself moved fine, just log the thumbnail failure.
                        log.warning(
                            f"Thumbnail move failed for {filename} - "
                            f"keeping old thumbnail_url"
                        )
                        new_thumb_key = None

            update_fields = "SET s3_key = %(new_s3_key)s"
            update_params: dict[str, Any] = {
                "new_s3_key": dest_key,
                "image_id": str(image["id"]),
            }
            if new_thumb_key:
                update_fields += ", thumbnail_url = %(new_thumb)s"
                update_params["new_thumb"] = new_thumb_key

            async with db.cursor() as update_cur:
                await update_cur.execute(
                    f"UPDATE project_images {update_fields} WHERE id = %(image_id)s",
                    update_params,
                )
            moved_count += 1
            log.info(f"Moved image {filename} to task {task_id}")

        # NOTE: caller is responsible for commit/rollback so that the task
        # state event and the image moves are in the same transaction.

        log.info(f"Task {task_id}: Moved {moved_count} images, {failed_count} failed")

        return {"moved_count": moved_count, "failed_count": failed_count}

    # ─── Project-level (task-centric) methods ─────────────────────────────

    @staticmethod
    async def get_project_task_imagery_summary(
        db: Connection,
        project_id: uuid.UUID,
    ) -> list[dict]:
        """Get per-task imagery summary aggregated across ALL batches.

        Returns one row per task with counts, status breakdown, and task state.
        This is the single source of truth for "what imagery exists for each task".
        """
        query = """
            WITH latest_task_state AS (
                SELECT DISTINCT ON (task_id)
                    task_id,
                    state,
                    comment
                FROM task_events
                WHERE project_id = %(project_id)s
                ORDER BY task_id, created_at DESC
            )
            SELECT
                t.id as task_id,
                t.project_task_index,
                COALESCE(lts.state::text, 'LOCKED') as task_state,
                lts.comment as state_comment,
                COALESCE(img.total, 0) as total_images,
                COALESCE(img.assigned, 0) as assigned_images,
                COALESCE(img.rejected, 0) as rejected_images,
                COALESCE(img.invalid_exif, 0) as invalid_exif_images,
                COALESCE(img.duplicate, 0) as duplicate_images,
                COALESCE(img.unmatched, 0) as unmatched_images,
                COALESCE(img.pending_transfer, 0) as pending_transfer_count,
                img.latest_upload
            FROM tasks t
            LEFT JOIN latest_task_state lts ON t.id = lts.task_id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
                    COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
                    COUNT(*) FILTER (WHERE status = 'invalid_exif') as invalid_exif,
                    COUNT(*) FILTER (WHERE status = 'duplicate') as duplicate,
                    COUNT(*) FILTER (WHERE status = 'unmatched') as unmatched,
                    COUNT(*) FILTER (
                        WHERE status = 'assigned' AND s3_key LIKE '%%user-uploads%%'
                    ) as pending_transfer,
                    MAX(uploaded_at) as latest_upload
                FROM project_images
                WHERE task_id = t.id AND project_id = %(project_id)s
            ) img ON true
            WHERE t.project_id = %(project_id)s
            ORDER BY t.project_task_index
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, {"project_id": str(project_id)})
            rows = await cur.fetchall()

        result = []
        for row in rows:
            has_ready_imagery = (
                row["task_state"] in VERIFIED_TASK_STATES
                and row["assigned_images"] > 0
                and row["pending_transfer_count"] == 0
            )
            result.append(
                {
                    "task_id": str(row["task_id"]),
                    "project_task_index": row["project_task_index"],
                    "task_state": row["task_state"],
                    "total_images": row["total_images"],
                    "assigned_images": row["assigned_images"],
                    "rejected_images": row["rejected_images"],
                    "invalid_exif_images": row["invalid_exif_images"],
                    "duplicate_images": row["duplicate_images"],
                    "unmatched_images": row["unmatched_images"],
                    "latest_upload": (
                        row["latest_upload"].isoformat()
                        if row["latest_upload"]
                        else None
                    ),
                    "pending_transfer_count": row["pending_transfer_count"],
                    "imagery_transfer_pending": row["pending_transfer_count"] > 0,
                    "failure_reason": (
                        row["state_comment"]
                        if row["task_state"] == "IMAGE_PROCESSING_FAILED"
                        else None
                    ),
                    "has_ready_imagery": has_ready_imagery,
                }
            )

        return result

    @staticmethod
    async def get_project_review_data(
        db: Connection,
        project_id: uuid.UUID,
    ) -> dict:
        """Project-level review: images grouped by task across ALL batches.

        TODO: At ~30k+ images for a project this aggregates every image into
        one response. Add cursor-based pagination (per-task or global) if
        payload size becomes a bottleneck. See also get_project_map_data().
        """
        query = """
            WITH latest_task_state AS (
                SELECT DISTINCT ON (task_id)
                    task_id,
                    state
                FROM task_events
                WHERE project_id = %(project_id)s
                ORDER BY task_id, created_at DESC
            )
            SELECT
                pi.task_id,
                t.project_task_index,
                COUNT(*) as image_count,
                COALESCE(lts.state::text IN ('READY_FOR_PROCESSING', 'IMAGE_PROCESSING_STARTED', 'IMAGE_PROCESSING_FINISHED', 'IMAGE_PROCESSING_FAILED'), false) as is_verified,
                json_agg(
                    json_build_object(
                        'id', pi.id,
                        'filename', pi.filename,
                        'status', pi.status,
                        'rejection_reason', pi.rejection_reason,
                        'uploaded_at', pi.uploaded_at,
                        'terrain_type', pi.terrain_type
                    ) ORDER BY pi.uploaded_at
                ) as images
            FROM project_images pi
            LEFT JOIN tasks t ON pi.task_id = t.id
            LEFT JOIN latest_task_state lts ON pi.task_id = lts.task_id
            WHERE pi.project_id = %(project_id)s
            AND pi.status IN ('assigned', 'rejected', 'invalid_exif', 'duplicate', 'unmatched')
            GROUP BY pi.task_id, t.project_task_index, lts.state
            ORDER BY t.project_task_index NULLS LAST
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, {"project_id": str(project_id)})
            task_groups = await cur.fetchall()

        return {
            "project_id": str(project_id),
            "task_groups": task_groups,
            "total_tasks": len(task_groups),
            "total_images": sum(group["image_count"] for group in task_groups),
        }

    @staticmethod
    async def get_project_map_data(
        db: Connection,
        project_id: uuid.UUID,
    ) -> dict:
        """Project-level map data: task geometries + ALL image points across batches.

        TODO: At 30k+ images this loads every image point into one GeoJSON
        payload. Consider server-side spatial filtering, vector tiles, or
        pagination if scale requires it. See also get_project_review_data().
        """
        # Get all tasks for the project (needed for manual task matching)
        tasks_query = """
            SELECT
                t.id,
                t.project_task_index,
                ST_AsGeoJSON(t.outline)::json as geometry,
                EXISTS (
                    SELECT 1 FROM project_images pi
                    WHERE pi.task_id = t.id
                    AND pi.project_id = %(project_id)s
                    AND pi.status = 'assigned'
                ) as has_imagery
            FROM tasks t
            WHERE t.project_id = %(project_id)s
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(tasks_query, {"project_id": str(project_id)})
            tasks = await cur.fetchall()

        tasks_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": task["geometry"],
                    "properties": {
                        "id": str(task["id"]),
                        "task_index": task["project_task_index"],
                        "has_imagery": task["has_imagery"],
                    },
                }
                for task in tasks
            ],
        }

        # Get all classified images across all batches (metadata only, no URLs)
        images_query = """
            SELECT
                id,
                filename,
                status,
                rejection_reason,
                task_id,
                terrain_type,
                ST_X(location::geometry) as longitude,
                ST_Y(location::geometry) as latitude
            FROM project_images
            WHERE project_id = %(project_id)s
            AND status IN ('assigned', 'rejected', 'invalid_exif', 'duplicate', 'unmatched')
            ORDER BY uploaded_at DESC
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(images_query, {"project_id": str(project_id)})
            all_images = await cur.fetchall()

        images_features = []
        located_count = 0
        unlocated_count = 0

        for img in all_images:
            properties = {
                "id": str(img["id"]),
                "filename": img["filename"],
                "status": img["status"],
                "task_id": str(img["task_id"]) if img["task_id"] else None,
                "rejection_reason": img["rejection_reason"],
                "terrain_type": img.get("terrain_type"),
            }

            if img["longitude"] is not None and img["latitude"] is not None:
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [img["longitude"], img["latitude"]],
                    },
                    "properties": properties,
                }
                located_count += 1
            else:
                feature = {
                    "type": "Feature",
                    "geometry": None,
                    "properties": properties,
                }
                unlocated_count += 1

            images_features.append(feature)

        return {
            "project_id": str(project_id),
            "tasks": tasks_geojson,
            "images": {
                "type": "FeatureCollection",
                "features": images_features,
            },
            "total_tasks": len(tasks_geojson["features"]),
            "total_images": len(images_features),
            "total_images_with_gps": located_count,
            "total_images_without_gps": unlocated_count,
        }

    @staticmethod
    async def get_task_verification_data_project(
        db: Connection,
        task_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        """Project-level task verification: ALL assigned images for this task
        across all batches.
        """
        # Get task geometry and index
        task_query = """
            SELECT
                id,
                project_task_index,
                ST_AsGeoJSON(outline)::json as geometry
            FROM tasks
            WHERE id = %(task_id)s
            AND project_id = %(project_id)s
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                task_query,
                {"task_id": str(task_id), "project_id": str(project_id)},
            )
            task = await cur.fetchone()

        if not task:
            raise ValueError(f"Task {task_id} not found in project {project_id}")

        # Get ALL assigned images for this task across all batches
        images_query = """
            SELECT
                id,
                filename,
                s3_key,
                thumbnail_url,
                status,
                rejection_reason,
                ST_AsGeoJSON(location)::json as location
            FROM project_images
            WHERE task_id = %(task_id)s
            AND project_id = %(project_id)s
            AND status = %(status)s
            ORDER BY uploaded_at
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                images_query,
                {
                    "task_id": str(task_id),
                    "project_id": str(project_id),
                    "status": ImageStatus.ASSIGNED.value,
                },
            )
            images = await cur.fetchall()

        # Calculate coverage using PostGIS (same logic, no batch filter)
        coverage_query = """
            WITH image_points AS (
                SELECT location
                FROM project_images
                WHERE task_id = %(task_id)s
                AND project_id = %(project_id)s
                AND status = %(status)s
                AND location IS NOT NULL
            ),
            task_polygon AS (
                SELECT outline
                FROM tasks
                WHERE id = %(task_id)s
            ),
            buffered_points AS (
                SELECT ST_Union(ST_Buffer(location::geography, 20)::geometry) as coverage
                FROM image_points
            )
            SELECT
                CASE
                    WHEN (SELECT COUNT(*) FROM image_points) = 0 THEN 0
                    ELSE LEAST(100, (
                        ST_Area(
                            ST_Intersection(
                                (SELECT coverage FROM buffered_points),
                                (SELECT outline FROM task_polygon)
                            )::geography
                        ) /
                        NULLIF(ST_Area((SELECT outline FROM task_polygon)::geography), 0)
                    ) * 100)
                END as coverage_percentage
        """

        coverage_percentage = 0
        try:
            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    coverage_query,
                    {
                        "task_id": str(task_id),
                        "project_id": str(project_id),
                        "status": ImageStatus.ASSIGNED.value,
                    },
                )
                coverage_result = await cur.fetchone()
                if coverage_result and coverage_result.get("coverage_percentage"):
                    coverage_percentage = float(coverage_result["coverage_percentage"])
        except Exception as e:
            log.warning(f"Could not calculate coverage: {e}")

        # Check if task is verified (any post-verification state counts)
        is_verified = False
        async with db.cursor() as cur:
            await cur.execute(
                """
                SELECT state FROM task_events
                WHERE task_id = %(task_id)s AND project_id = %(project_id)s
                ORDER BY created_at DESC LIMIT 1
                """,
                {"task_id": str(task_id), "project_id": str(project_id)},
            )
            row = await cur.fetchone()
            if row and row[0] in VERIFIED_TASK_STATES:
                is_verified = True

        return {
            "task_id": str(task_id),
            "project_task_index": task["project_task_index"],
            "image_count": len(images),
            "images": [
                {
                    "id": str(img["id"]),
                    "filename": img["filename"],
                    "s3_key": img["s3_key"],
                    "thumbnail_url": img.get("thumbnail_url"),
                    "url": img.get("url"),
                    "status": img["status"],
                    "rejection_reason": img.get("rejection_reason"),
                    "location": img.get("location"),
                }
                for img in images
            ],
            "task_geometry": {
                "type": "Feature",
                "geometry": task["geometry"],
                "properties": {
                    "id": str(task["id"]),
                    "task_index": task["project_task_index"],
                },
            },
            "coverage_percentage": coverage_percentage,
            "is_verified": is_verified,
        }

    @staticmethod
    def _presign_row(row: dict, variant: ImageUrlVariant = "thumb") -> dict:
        """Presign a row's S3 keys based on variant (thumb|full|both)."""
        result: dict = {"id": str(row["id"])}
        if variant in ("thumb", "both"):
            result["thumbnail_url"] = (
                maybe_presign_s3_key(row["thumbnail_url"], expires_hours=1)
                if row.get("thumbnail_url")
                else None
            )
        if variant in ("full", "both"):
            result["url"] = (
                maybe_presign_s3_key(row["s3_key"], expires_hours=1)
                if row.get("s3_key")
                else None
            )
        return result

    @staticmethod
    async def get_task_image_urls(
        db: Connection,
        task_id: uuid.UUID,
        project_id: uuid.UUID,
        variant: ImageUrlVariant = "thumb",
    ) -> list[dict]:
        """Return presigned URLs for all images in a task.

        Called on-demand when a user opens a task accordion or verification modal.
        variant: 'thumb' for grid display, 'full' for inspect, 'both' for all.
        """
        query = """
            SELECT id, s3_key, thumbnail_url
            FROM project_images
            WHERE task_id = %(task_id)s
            AND project_id = %(project_id)s
            AND status IN ('assigned', 'rejected', 'invalid_exif', 'duplicate', 'unmatched')
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query,
                {"task_id": str(task_id), "project_id": str(project_id)},
            )
            rows = await cur.fetchall()

        return [ImageClassifier._presign_row(row, variant) for row in rows]

    @staticmethod
    async def get_bulk_image_urls(
        db: Connection,
        image_ids: list[uuid.UUID],
        project_id: uuid.UUID,
        variant: ImageUrlVariant = "thumb",
    ) -> list[dict]:
        """Return presigned URLs for a list of image IDs (for unassigned images)."""
        if not image_ids:
            return []

        query = """
            SELECT id, s3_key, thumbnail_url
            FROM project_images
            WHERE id = ANY(%(image_ids)s)
            AND project_id = %(project_id)s
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query,
                {
                    "image_ids": [str(i) for i in image_ids],
                    "project_id": str(project_id),
                },
            )
            rows = await cur.fetchall()

        return [ImageClassifier._presign_row(row, variant) for row in rows]

    @staticmethod
    async def get_single_image_url(
        db: Connection,
        image_id: uuid.UUID,
        project_id: uuid.UUID,
        variant: ImageUrlVariant = "both",
    ) -> dict:
        """Return presigned URLs for a single image (for map popup on-click)."""
        query = """
            SELECT id, s3_key, thumbnail_url
            FROM project_images
            WHERE id = %(image_id)s AND project_id = %(project_id)s
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query,
                {"image_id": str(image_id), "project_id": str(project_id)},
            )
            row = await cur.fetchone()

        if not row:
            raise ValueError(f"Image {image_id} not found in project {project_id}")

        return ImageClassifier._presign_row(row, variant)
