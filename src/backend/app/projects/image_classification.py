import uuid
from datetime import datetime, timedelta
from typing import Optional

import cv2
import numpy as np
from fastapi.concurrency import run_in_threadpool
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

from app.config import settings
from app.models.enums import ImageStatus
from app.s3 import get_obj_from_bucket, s3_client
from app.utils import strip_presigned_url_for_local_dev


MIN_GIMBAL_ANGLE = -30.0
MIN_SHARPNESS_SCORE = 100.0


class ImageClassifier:
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
    async def check_image_quality(
        exif_data: dict, image_bytes: Optional[bytes] = None
    ) -> tuple[bool, Optional[str], Optional[float]]:
        """Check image quality based on EXIF and optionally image content.

        Args:
            exif_data: EXIF metadata dictionary
            image_bytes: Optional raw image bytes for sharpness analysis

        Returns:
            Tuple of (passed, reason, sharpness_score)
        """
        # Check gimbal angle from EXIF
        gimbal_angle = exif_data.get("pitch")
        if gimbal_angle is not None and gimbal_angle > MIN_GIMBAL_ANGLE:
            return (
                False,
                f"Gimbal angle {gimbal_angle:.1f}° too shallow (must be < {MIN_GIMBAL_ANGLE}°)",
                None,
            )

        # Check sharpness if image bytes provided
        sharpness_score = None
        if image_bytes:
            try:
                sharpness_score = ImageClassifier.calculate_sharpness(image_bytes)
                if sharpness_score < MIN_SHARPNESS_SCORE:
                    return (
                        False,
                        f"Image too blurry (sharpness: {sharpness_score:.1f}, required: {MIN_SHARPNESS_SCORE:.1f})",
                        sharpness_score,
                    )
            except Exception as e:
                log.warning(f"Could not calculate sharpness: {e}")
                # Don't fail the image if we can't calculate sharpness
                # Just continue without sharpness check

        return True, None, sharpness_score

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
            return uuid.UUID(result["id"]) if result else None

    @staticmethod
    async def classify_single_image(
        db: Connection,
        image_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, exif, location, status, s3_key
                FROM project_images
                WHERE id = %(image_id)s AND project_id = %(project_id)s
                """,
                {"image_id": str(image_id), "project_id": str(project_id)},
            )
            image = await cur.fetchone()

            if not image:
                return {
                    "image_id": str(image_id),
                    "status": "error",
                    "message": "Image not found",
                }

        logs = []
        exif_data = image.get("exif") or {}
        s3_key = image.get("s3_key")

        logs.append(
            {
                "action": "EXIF Extraction",
                "details": "Reading metadata...",
                "status": "info",
            }
        )

        if not exif_data:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.INVALID_EXIF, "No EXIF data found"
            )
            logs.append(
                {
                    "action": "REJECTED",
                    "details": "No EXIF data found",
                    "status": "error",
                }
            )
            return {
                "image_id": str(image_id),
                "status": ImageStatus.INVALID_EXIF,
                "logs": logs,
            }

        latitude = exif_data.get("latitude")
        longitude = exif_data.get("longitude")

        if latitude is None or longitude is None:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.INVALID_EXIF, "No GPS coordinates in EXIF"
            )
            logs.append(
                {
                    "action": "REJECTED",
                    "details": "No GPS coordinates found",
                    "status": "error",
                }
            )
            return {
                "image_id": str(image_id),
                "status": ImageStatus.INVALID_EXIF,
                "logs": logs,
            }

        logs.append(
            {
                "action": "GPS Check",
                "details": f"Location: {latitude:.4f}, {longitude:.4f}",
                "status": "success",
            }
        )

        # Download image for quality analysis using run_in_threadpool
        # to properly handle the sync MinIO client from async context
        image_bytes = None
        try:
            log.info(f"Downloading image from S3: {s3_key}")
            file_obj = await run_in_threadpool(
                get_obj_from_bucket, settings.S3_BUCKET_NAME, s3_key
            )
            image_bytes = file_obj.read()
            logs.append(
                {
                    "action": "Image Download",
                    "details": f"Downloaded {len(image_bytes) / 1024 / 1024:.2f} MB from S3",
                    "status": "success",
                }
            )
        except Exception as e:
            log.error(f"Failed to download image from S3: {e}")
            logs.append(
                {
                    "action": "Image Download",
                    "details": f"Failed to download from S3: {str(e)}",
                    "status": "warning",
                }
            )

        (
            quality_passed,
            quality_reason,
            sharpness_score,
        ) = await ImageClassifier.check_image_quality(exif_data, image_bytes)

        if not quality_passed:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.REJECTED, quality_reason, sharpness_score
            )
            logs.append(
                {"action": "REJECTED", "details": quality_reason, "status": "error"}
            )
            return {
                "image_id": str(image_id),
                "status": ImageStatus.REJECTED,
                "reason": quality_reason,
                "sharpness_score": sharpness_score,
                "logs": logs,
            }

        gimbal_angle = exif_data.get("pitch")
        quality_details = f"Gimbal: {gimbal_angle:.1f}°"
        if sharpness_score is not None:
            quality_details += f", Sharpness: {sharpness_score:.1f}"
        quality_details += " - Passed"

        logs.append(
            {"action": "Quality Check", "details": quality_details, "status": "success"}
        )

        task_id = await ImageClassifier.find_matching_task(
            db, project_id, latitude, longitude
        )

        if not task_id:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.UNMATCHED, "No matching task boundary"
            )
            logs.append(
                {
                    "action": "UNMATCHED",
                    "details": "No matching task boundary found",
                    "status": "warning",
                }
            )
            return {
                "image_id": str(image_id),
                "status": ImageStatus.UNMATCHED,
                "logs": logs,
            }

        await ImageClassifier._assign_image_to_task(
            db, image_id, task_id, sharpness_score
        )

        logs.append(
            {
                "action": "ASSIGNED",
                "details": f"Matched to task {str(task_id)[:8]}...",
                "status": "success",
            }
        )

        return {
            "image_id": str(image_id),
            "status": ImageStatus.ASSIGNED,
            "task_id": str(task_id),
            "sharpness_score": sharpness_score,
            "logs": logs,
        }

    @staticmethod
    async def _update_image_status(
        db: Connection,
        image_id: uuid.UUID,
        status: ImageStatus,
        rejection_reason: Optional[str] = None,
        sharpness_score: Optional[float] = None,
    ):
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
    ):
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
        db: Connection, batch_id: uuid.UUID, project_id: uuid.UUID
    ) -> dict:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id
                FROM project_images
                WHERE batch_id = %(batch_id)s
                AND project_id = %(project_id)s
                AND status = %(status)s
                ORDER BY uploaded_at
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

        results = {
            "batch_id": str(batch_id),
            "total": len(images),
            "assigned": 0,
            "rejected": 0,
            "unmatched": 0,
            "invalid": 0,
            "images": [],
        }

        for image in images:
            # image["id"] may already be a UUID object from the database
            image_id = image["id"] if isinstance(image["id"], uuid.UUID) else uuid.UUID(image["id"])

            async with db.cursor() as cur:
                await cur.execute(
                    "UPDATE project_images SET status = %(status)s WHERE id = %(image_id)s",
                    {
                        "status": ImageStatus.CLASSIFYING.value,
                        "image_id": str(image_id),
                    },
                )

            result = await ImageClassifier.classify_single_image(
                db, image_id, project_id
            )

            if result["status"] == ImageStatus.ASSIGNED:
                results["assigned"] += 1
            elif result["status"] == ImageStatus.REJECTED:
                results["rejected"] += 1
            elif result["status"] == ImageStatus.UNMATCHED:
                results["unmatched"] += 1
            elif result["status"] == ImageStatus.INVALID_EXIF:
                results["invalid"] += 1

            results["images"].append(result)

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
                status,
                rejection_reason,
                task_id,
                classified_at,
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

        # Generate presigned URLs for each image (keep signature for authentication)
        for image in images:
            if image.get("s3_key"):
                client = s3_client()
                url = client.presigned_get_object(
                    settings.S3_BUCKET_NAME,
                    image["s3_key"],
                    expires=timedelta(hours=1)
                )
                # Keep presigned params (strip_presign=False) so signature is preserved
                image["url"] = strip_presigned_url_for_local_dev(url, strip_presign=False)

        return images
