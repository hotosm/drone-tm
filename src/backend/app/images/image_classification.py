import asyncio
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from math import cos, radians, sqrt
from typing import Optional, Any
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
    copy_file_within_bucket,
    get_obj_from_bucket,
    maybe_presign_s3_key,
    s3_client,
)


# Number of concurrent workers for parallel classification
CLASSIFICATION_CONCURRENCY = 6

# Hard timeout per image to avoid a single stuck S3 read / decode hanging the whole batch.
# If exceeded, the image is marked as REJECTED with a generic "Classification failed".
CLASSIFICATION_PER_IMAGE_TIMEOUT_SECONDS = 120

# Buffer radius in meters for coverage calculation
COVERAGE_BUFFER_METERS = 20.0


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

    @staticmethod
    def calculate_sharpness(image_bytes: bytes) -> float:
        """Calculate image sharpness using Laplacian variance method.

        The Laplacian variance method detects blur by computing the variance
        of the Laplacian (second derivative) of the image. A low variance
        indicates a blurry image, while a high variance indicates a sharp image.

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
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_bytes, np.uint8)

            # Decode image
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                raise ValueError("Failed to decode image")

            # Convert to grayscale for better edge detection
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

            # Calculate Laplacian variance
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            variance = laplacian.var()

            log.debug(f"Calculated sharpness score: {variance:.2f}")

            return float(variance)

        except Exception as e:
            log.error(f"Error calculating sharpness: {e}")
            raise ValueError(f"Failed to calculate sharpness: {e}") from e

    @staticmethod
    def _decode_gray(image_bytes: bytes) -> np.ndarray:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    @staticmethod
    def analyze_exposure(image_bytes: bytes) -> dict[str, float]:
        """Return simple exposure stats to detect junk frames."""
        gray = ImageClassifier._decode_gray(image_bytes)
        p5, p95 = np.percentile(gray, [5, 95])
        dynamic_range = float(p95 - p5)
        black_ratio = float(np.mean(gray < Q.black_pixel_threshold))
        white_ratio = float(np.mean(gray > Q.white_pixel_threshold))
        return {
            "dynamic_range": dynamic_range,
            "black_ratio": black_ratio,
            "white_ratio": white_ratio,
        }

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
                f"Camera must point down (gimbal pitch <= {Q.max_gimbal_pitch_deg:.0f}°), got {gimbal_angle:.0f}°"
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
                # Use the calculate_sharpness method
                sharpness_score = ImageClassifier.calculate_sharpness(image_bytes)
                if sharpness_score < Q.min_sharpness:
                    issues.append(
                        f"Blurry (sharpness: {sharpness_score:.1f}, min: {Q.min_sharpness})"
                    )
                    log.debug(
                        f"Sharpness check FAILED: image_id={image_id} score={sharpness_score:.1f} min={Q.min_sharpness}"
                    )
                else:
                    log.debug(
                        f"Sharpness check passed: image_id={image_id} score={sharpness_score:.1f}"
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
                db, image_id, status, rejection_reason, sharpness_score
            )
            log.info(
                f"Image rejected: image_id={image_id} status={status.value} reason={rejection_reason}"
            )
            return {
                "image_id": str(image_id),
                "status": status,
                "reason": rejection_reason,
                "sharpness_score": sharpness_score,
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
            db, image_id, task_id, sharpness_score
        )
        log.info(f"Image assigned: image_id={image_id} task_id={task_id}")

        return {
            "image_id": str(image_id),
            "status": ImageStatus.ASSIGNED,
            "task_id": str(task_id),
            "sharpness_score": sharpness_score,
        }

    @staticmethod
    async def _update_image_status(
        db: Connection,
        image_id: uuid.UUID,
        status: ImageStatus,
        rejection_reason: Optional[str] = None,
        sharpness_score: Optional[float] = None,
    ) -> None:
        query = """
            UPDATE project_images
            SET status = %(status)s,
                rejection_reason = %(rejection_reason)s,
                sharpness_score = %(sharpness_score)s,
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
                    "classified_at": datetime.utcnow(),
                },
            )

    @staticmethod
    async def _assign_image_to_task(
        db: Connection,
        image_id: uuid.UUID,
        task_id: uuid.UUID,
        sharpness_score: Optional[float] = None,
    ) -> None:
        query = """
            UPDATE project_images
            SET status = %(status)s,
                task_id = %(task_id)s,
                sharpness_score = %(sharpness_score)s,
                classified_at = %(classified_at)s
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
                    "classified_at": datetime.utcnow(),
                },
            )

    @staticmethod
    async def classify_batch(
        db_pool: AsyncConnectionPool, batch_id: uuid.UUID, project_id: uuid.UUID
    ) -> dict[str, Any]:
        # Use UPDATE SKIP LOCKED to ensure no race conditions
        async with db_pool.connection() as db:
            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    """
                    SELECT id
                    FROM project_images
                    WHERE batch_id = %(batch_id)s
                    AND project_id = %(project_id)s
                    AND status = %(status)s
                    ORDER BY uploaded_at
                    FOR UPDATE SKIP LOCKED
                    """,
                    {
                        "batch_id": str(batch_id),
                        "project_id": str(project_id),
                        "status": ImageStatus.STAGED.value,
                    },
                )
                images = await cur.fetchall()

        if not images:
            return {
                "batch_id": str(batch_id),
                "message": "No images to classify",
                "total": 0,
                "assigned": 0,
                "rejected": 0,
                "unmatched": 0,
                "invalid": 0,
                "images": [],
            }

        results: dict[str, Any] = {
            "batch_id": str(batch_id),
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
                msg = msg[:240].rsplit(" ", 1)[0] + "…"
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
                async with db_pool.connection() as conn:
                    try:
                        # Update status to classifying
                        async with conn.cursor() as cur:
                            await cur.execute(
                                "UPDATE project_images SET status = %(status)s WHERE id = %(image_id)s",
                                {
                                    "status": ImageStatus.CLASSIFYING.value,
                                    "image_id": str(image_id),
                                },
                            )
                        # Commit the classifying status so frontend can see progress
                        await conn.commit()

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

        # Process all images in parallel with controlled concurrency
        tasks = [classify_with_commit(image) for image in images]
        await asyncio.gather(*tasks, return_exceptions=True)

        log.info(
            f"Parallel classification complete for batch {batch_id}: "
            f"{results['assigned']} assigned, {results['rejected']} rejected, "
            f"{results['unmatched']} unmatched, {results['invalid']} invalid"
        )

        return results

    @staticmethod
    async def get_batch_images(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
        last_timestamp: Optional[datetime] = None,
    ) -> list[dict]:
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
                ST_X(location::geometry) as longitude,
                ST_Y(location::geometry) as latitude
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
        """

        params = {"batch_id": str(batch_id), "project_id": str(project_id)}

        if last_timestamp:
            query += " AND classified_at > %(last_timestamp)s"
            params["last_timestamp"] = last_timestamp

        query += " ORDER BY uploaded_at"

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, params)
            images = await cur.fetchall()

        # Generate browser-facing URLs for each image (CloudFront-friendly if configured)
        for image in images:
            if image.get("s3_key"):
                image["url"] = maybe_presign_s3_key(image["s3_key"], expires_hours=1)

            # Generate presigned URL for thumbnail if available
            if image.get("thumbnail_url"):
                image["thumbnail_url"] = maybe_presign_s3_key(
                    image["thumbnail_url"], expires_hours=1
                )

            # Add has_gps field for frontend display
            image["has_gps"] = (
                image.get("latitude") is not None and image.get("longitude") is not None
            )

        return images

    @staticmethod
    async def get_batch_review_data(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        # Query includes is_verified by checking if task has IMAGE_UPLOADED state
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
                COALESCE(lts.state = 'IMAGE_UPLOADED', false) as is_verified,
                json_agg(
                    json_build_object(
                        'id', pi.id,
                        'filename', pi.filename,
                        's3_key', pi.s3_key,
                        'thumbnail_url', pi.thumbnail_url,
                        'status', pi.status,
                        'rejection_reason', pi.rejection_reason,
                        'uploaded_at', pi.uploaded_at
                    ) ORDER BY pi.uploaded_at
                ) as images
            FROM project_images pi
            LEFT JOIN tasks t ON pi.task_id = t.id
            LEFT JOIN latest_task_state lts ON pi.task_id = lts.task_id
            WHERE pi.batch_id = %(batch_id)s
            AND pi.project_id = %(project_id)s
            AND pi.status IN ('assigned', 'rejected', 'invalid_exif', 'duplicate')
            GROUP BY pi.task_id, t.project_task_index, lts.state
            ORDER BY t.project_task_index NULLS LAST
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query, {"batch_id": str(batch_id), "project_id": str(project_id)}
            )
            task_groups = await cur.fetchall()

        # Generate browser-facing URLs for thumbnails (CloudFront-friendly if configured)
        for group in task_groups:
            for image in group["images"]:
                if image.get("thumbnail_url"):
                    image["thumbnail_url"] = maybe_presign_s3_key(
                        image["thumbnail_url"], expires_hours=1
                    )

                # Generate presigned URL for full image
                if image.get("s3_key"):
                    image["url"] = maybe_presign_s3_key(
                        image["s3_key"], expires_hours=1
                    )

        return {
            "batch_id": str(batch_id),
            "task_groups": task_groups,
            "total_tasks": len(task_groups),
            "total_images": sum(group["image_count"] for group in task_groups),
        }

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

        return {
            "message": "Image accepted successfully",
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
            SELECT s3_key, thumbnail_url
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

        s3_keys_to_delete: list[str] = []
        for row in rows:
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
    async def get_batch_map_data(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        """Get map data for batch review visualization.

        Returns task geometries and all images as GeoJSON (with/without GPS coordinates).
        """
        # Get all task IDs that have images in this batch
        task_ids_query = """
            SELECT DISTINCT task_id
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
            AND task_id IS NOT NULL
        """

        async with db.cursor() as cur:
            await cur.execute(
                task_ids_query,
                {"batch_id": str(batch_id), "project_id": str(project_id)},
            )
            task_rows = await cur.fetchall()

        task_ids = [str(row[0]) for row in task_rows if row[0]]

        # Get task geometries as GeoJSON
        tasks_geojson = {"type": "FeatureCollection", "features": []}
        if task_ids:
            tasks_query = """
                SELECT
                    id,
                    project_task_index,
                    ST_AsGeoJSON(outline)::json as geometry
                FROM tasks
                WHERE id = ANY(%(task_ids)s::uuid[])
            """

            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(tasks_query, {"task_ids": task_ids})
                tasks = await cur.fetchall()

            for task in tasks:
                tasks_geojson["features"].append(
                    {
                        "type": "Feature",
                        "geometry": task["geometry"],
                        "properties": {
                            "id": str(task["id"]),
                            "task_index": task["project_task_index"],
                        },
                    }
                )

        # Get all images with or without GPS data
        all_images_query = """
            SELECT
                id,
                filename,
                status,
                rejection_reason,
                task_id,
                s3_key,
                thumbnail_url,
                ST_X(location::geometry) as longitude,
                ST_Y(location::geometry) as latitude
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
            ORDER BY uploaded_at DESC
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                all_images_query,
                {"batch_id": str(batch_id), "project_id": str(project_id)},
            )
            all_images = await cur.fetchall()

        # Build GeoJSON features for each image
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
                "thumbnail_url": maybe_presign_s3_key(
                    img["thumbnail_url"], expires_hours=1
                )
                if img.get("thumbnail_url")
                else None,
                "url": maybe_presign_s3_key(img["s3_key"], expires_hours=1)
                if img.get("s3_key")
                else None,
            }

            # Add Point geometry if GPS data exists
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
                # Add feature with null geometry for images without GPS
                feature = {
                    "type": "Feature",
                    "geometry": None,
                    "properties": properties,
                }
                unlocated_count += 1

            images_features.append(feature)

        images_geojson = {
            "type": "FeatureCollection",
            "features": images_features,
        }

        return {
            "batch_id": str(batch_id),
            "tasks": tasks_geojson,
            "images": images_geojson,
            "total_tasks": len(tasks_geojson["features"]),
            "total_images": len(images_geojson["features"]),
            "total_images_with_gps": located_count,
            "total_images_without_gps": unlocated_count,
        }

    @staticmethod
    async def move_batch_images_to_tasks(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        """Move assigned images from batch storage to their respective task folders.

        After classification and review, images need to be moved from:
        - Source: projects/{project_id}/user-uploads/{filename}
        - Destination: projects/{project_id}/{task_id}/images/{filename}

        This prepares the images for ODM processing.
        Only moves images for tasks that have been marked as fully flown (IMAGE_UPLOADED).

        Args:
            db: Database connection
            batch_id: The batch ID to process
            project_id: The project ID

        Returns:
            dict: Summary of moved images per task
        """
        # Get all assigned images in this batch grouped by task
        # Only include images for tasks with IMAGE_UPLOADED state
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
                pi.id,
                pi.filename,
                pi.s3_key,
                pi.task_id
            FROM project_images pi
            JOIN latest_task_state lts ON pi.task_id = lts.task_id
            WHERE pi.batch_id = %(batch_id)s
            AND pi.project_id = %(project_id)s
            AND pi.status = %(status)s
            AND pi.task_id IS NOT NULL
            AND lts.state = 'IMAGE_UPLOADED'
            ORDER BY pi.task_id, pi.uploaded_at
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query,
                {
                    "batch_id": str(batch_id),
                    "project_id": str(project_id),
                    "status": ImageStatus.ASSIGNED.value,
                },
            )
            images = await cur.fetchall()

        if not images:
            return {
                "batch_id": str(batch_id),
                "message": "No assigned images to move",
                "total_moved": 0,
                "total_failed": 0,
                "task_count": 0,
                "tasks": {},
            }

        # Group images by task
        tasks_summary = {}
        moved_count = 0
        failed_count = 0

        for image in images:
            task_id = str(image["task_id"])
            filename = image["filename"]
            source_key = image["s3_key"]

            # Construct destination path: projects/{project_id}/{task_id}/images/{filename}
            dest_key = f"projects/{project_id}/{task_id}/images/{filename}"

            # Copy file to task folder
            success = await run_in_threadpool(
                copy_file_within_bucket,
                settings.S3_BUCKET_NAME,
                source_key,
                dest_key,
            )

            if success:
                # Update the s3_key in database to point to new location
                async with db.cursor() as update_cur:
                    await update_cur.execute(
                        """
                        UPDATE project_images
                        SET s3_key = %(new_s3_key)s
                        WHERE id = %(image_id)s
                        """,
                        {
                            "new_s3_key": dest_key,
                            "image_id": str(image["id"]),
                        },
                    )

                moved_count += 1

                if task_id not in tasks_summary:
                    tasks_summary[task_id] = {
                        "task_id": task_id,
                        "image_count": 0,
                        "images": [],
                    }
                tasks_summary[task_id]["image_count"] += 1
                tasks_summary[task_id]["images"].append(filename)

                log.info(f"Moved image {filename} to task {task_id}")
            else:
                failed_count += 1
                log.error(f"Failed to move image {filename} to task {task_id}")

        log.info(
            f"Batch {batch_id}: Moved {moved_count} images to {len(tasks_summary)} tasks, "
            f"{failed_count} failed"
        )

        return {
            "batch_id": str(batch_id),
            "total_moved": moved_count,
            "total_failed": failed_count,
            "task_count": len(tasks_summary),
            "tasks": tasks_summary,
        }

    @staticmethod
    async def get_batch_processing_summary(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        """Get a summary of assigned images for processing.

        Returns task-grouped summary suitable for the Processing step UI.
        Only includes tasks that have been marked as fully flown (IMAGE_UPLOADED state
        or later processing states).

        Args:
            db: Database connection
            batch_id: The batch ID
            project_id: The project ID

        Returns:
            dict: Summary with tasks, image counts, and processing status
        """
        # Query includes tasks with IMAGE_UPLOADED or processing states
        # This allows tracking processing progress
        # Also includes the comment field for failure reasons
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
                pi.task_id,
                t.project_task_index,
                lts.state as task_state,
                lts.comment as state_comment,
                COUNT(*) as image_count
            FROM project_images pi
            JOIN tasks t ON pi.task_id = t.id
            JOIN latest_task_state lts ON pi.task_id = lts.task_id
            WHERE pi.batch_id = %(batch_id)s
            AND pi.project_id = %(project_id)s
            AND pi.status = %(status)s
            AND pi.task_id IS NOT NULL
            AND lts.state IN (
                'IMAGE_UPLOADED',
                'IMAGE_PROCESSING_STARTED',
                'IMAGE_PROCESSING_FINISHED',
                'IMAGE_PROCESSING_FAILED'
            )
            GROUP BY pi.task_id, t.project_task_index, lts.state, lts.comment
            ORDER BY t.project_task_index
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query,
                {
                    "batch_id": str(batch_id),
                    "project_id": str(project_id),
                    "status": ImageStatus.ASSIGNED.value,
                },
            )
            task_groups = await cur.fetchall()

        total_images = sum(group["image_count"] for group in task_groups)

        return {
            "batch_id": str(batch_id),
            "total_tasks": len(task_groups),
            "total_images": total_images,
            "tasks": [
                {
                    "task_id": str(group["task_id"]),
                    "task_index": group["project_task_index"],
                    "image_count": group["image_count"],
                    "state": group["task_state"],
                    "failure_reason": group["state_comment"]
                    if group["task_state"] == "IMAGE_PROCESSING_FAILED"
                    else None,
                }
                for group in task_groups
            ],
        }

    @staticmethod
    async def get_task_verification_data(
        db: Connection,
        task_id: uuid.UUID,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        """Get task images and geometry for verification modal.

        Args:
            db: Database connection
            task_id: The task ID to get data for
            batch_id: The batch ID
            project_id: The project ID

        Returns:
            dict: Task verification data including images, geometry, and coverage
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

        # Get all assigned images for this task in the batch
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
            AND batch_id = %(batch_id)s
            AND project_id = %(project_id)s
            AND status = %(status)s
            ORDER BY uploaded_at
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                images_query,
                {
                    "task_id": str(task_id),
                    "batch_id": str(batch_id),
                    "project_id": str(project_id),
                    "status": ImageStatus.ASSIGNED.value,
                },
            )
            images = await cur.fetchall()

        # Generate browser-facing URLs (CloudFront-friendly if configured)
        for image in images:
            if image.get("thumbnail_url"):
                image["thumbnail_url"] = maybe_presign_s3_key(
                    image["thumbnail_url"], expires_hours=1
                )

            if image.get("s3_key"):
                image["url"] = maybe_presign_s3_key(image["s3_key"], expires_hours=1)

        # Calculate coverage percentage using PostGIS
        # Buffer each image point and calculate intersection with task polygon
        coverage_query = """
            WITH image_points AS (
                SELECT location
                FROM project_images
                WHERE task_id = %(task_id)s
                AND batch_id = %(batch_id)s
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
                        "batch_id": str(batch_id),
                        "project_id": str(project_id),
                        "status": ImageStatus.ASSIGNED.value,
                    },
                )
                coverage_result = await cur.fetchone()
                if coverage_result and coverage_result.get("coverage_percentage"):
                    coverage_percentage = float(coverage_result["coverage_percentage"])
        except Exception as e:
            log.warning(f"Could not calculate coverage: {e}")
            coverage_percentage = 0

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
            "is_verified": False,  # TODO: Add verified_at field to tasks table
        }
