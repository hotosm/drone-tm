import asyncio
import json
import uuid
from datetime import datetime, timedelta
from typing import Optional

import cv2
import numpy as np
from fastapi.concurrency import run_in_threadpool
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import settings
from app.models.enums import ImageStatus
from app.s3 import get_obj_from_bucket, s3_client
from app.utils import strip_presigned_url_for_local_dev

# Number of concurrent workers for parallel classification
CLASSIFICATION_CONCURRENCY = 10


MIN_GIMBAL_ANGLE = 10.0
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
        issues = []
        exif_data = image.get("exif") or {}
        s3_key = image.get("s3_key")
        sharpness_score = None

        # Download image first for quality analysis
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
                    "details": f"Downloaded {len(image_bytes) / 1024 / 1024:.2f} MB",
                    "status": "success",
                }
            )
        except Exception as e:
            log.error(f"Failed to download image from S3: {e}")
            logs.append(
                {
                    "action": "Image Download",
                    "details": f"Failed to download: {str(e)}",
                    "status": "warning",
                }
            )

        # Check sharpness first (if image bytes available)
        if image_bytes:
            try:
                sharpness_score = ImageClassifier.calculate_sharpness(image_bytes)
                if sharpness_score < MIN_SHARPNESS_SCORE:
                    issues.append(
                        f"Blurry (sharpness: {sharpness_score:.1f}, min: {MIN_SHARPNESS_SCORE})"
                    )
                    logs.append(
                        {
                            "action": "Sharpness Check",
                            "details": f"Score: {sharpness_score:.1f} - FAILED",
                            "status": "error",
                        }
                    )
                else:
                    logs.append(
                        {
                            "action": "Sharpness Check",
                            "details": f"Score: {sharpness_score:.1f} - Passed",
                            "status": "success",
                        }
                    )
            except Exception as e:
                log.warning(f"Could not calculate sharpness: {e}")
                logs.append(
                    {
                        "action": "Sharpness Check",
                        "details": f"Could not analyze: {str(e)}",
                        "status": "warning",
                    }
                )

        # Check EXIF data
        if not exif_data:
            issues.append("Image is missing camera information (EXIF data)")
            logs.append(
                {"action": "EXIF Check", "details": "No EXIF data", "status": "error"}
            )
        else:
            logs.append(
                {
                    "action": "EXIF Check",
                    "details": "EXIF data present",
                    "status": "success",
                }
            )

        # Extract GPS coordinates from stored EXIF data
        latitude = exif_data.get("GPSLatitude")
        longitude = exif_data.get("GPSLongitude")

        if latitude is None or longitude is None:
            issues.append("Image is missing GPS location data")
            logs.append(
                {
                    "action": "GPS Check",
                    "details": "No coordinates found",
                    "status": "error",
                }
            )
        else:
            logs.append(
                {
                    "action": "GPS Check",
                    "details": f"Location: {latitude:.4f}, {longitude:.4f}",
                    "status": "success",
                }
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

        # Check gimbal angle - look for DJI XMP field or UserComment pitch
        gimbal_angle = (
            quality_check_data.get("GimbalPitchDegree")
            or quality_check_data.get("FlightPitchDegree")
            or quality_check_data.get("pitch")
        )
        if gimbal_angle is not None and gimbal_angle > MIN_GIMBAL_ANGLE:
            issues.append(
                f"Camera angle is too tilted ({gimbal_angle:.0f}°). Please capture images pointing straight down."
            )
            logs.append(
                {
                    "action": "Gimbal Check",
                    "details": f"Angle: {gimbal_angle:.1f}° - FAILED",
                    "status": "error",
                }
            )
        elif gimbal_angle is not None:
            logs.append(
                {
                    "action": "Gimbal Check",
                    "details": f"Angle: {gimbal_angle:.1f}° - Passed",
                    "status": "success",
                }
            )

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
            logs.append(
                {"action": "REJECTED", "details": rejection_reason, "status": "error"}
            )
            return {
                "image_id": str(image_id),
                "status": status,
                "reason": rejection_reason,
                "sharpness_score": sharpness_score,
                "logs": logs,
            }

        # All checks passed
        quality_details = (
            f"Gimbal: {gimbal_angle:.1f}°" if gimbal_angle else "Gimbal: N/A"
        )
        if sharpness_score is not None:
            quality_details += f", Sharpness: {sharpness_score:.1f}"
        quality_details += " - All checks passed"

        logs.append(
            {"action": "Quality Check", "details": quality_details, "status": "success"}
        )

        task_id = await ImageClassifier.find_matching_task(
            db, project_id, latitude, longitude
        )

        if not task_id:
            await ImageClassifier._update_image_status(
                db,
                image_id,
                ImageStatus.UNMATCHED,
                "Image location is outside of all task areas",
            )
            logs.append(
                {
                    "action": "UNMATCHED",
                    "details": "Image location is outside of all task areas",
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
        db_pool: AsyncConnectionPool, batch_id: uuid.UUID, project_id: uuid.UUID
    ) -> dict:
        # Use a connection just to fetch the list of images
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

        # Use a semaphore to limit concurrency
        semaphore = asyncio.Semaphore(CLASSIFICATION_CONCURRENCY)
        # Lock for thread-safe counter updates
        results_lock = asyncio.Lock()

        async def classify_with_commit(image_record: dict) -> dict:
            """Classify a single image with its own connection for proper isolation."""
            async with semaphore:
                image_id = (
                    image_record["id"]
                    if isinstance(image_record["id"], uuid.UUID)
                    else uuid.UUID(image_record["id"])
                )

                # Each worker gets its own connection from the pool
                async with db_pool.connection() as conn:
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

                    # Perform classification
                    result = await ImageClassifier.classify_single_image(
                        conn, image_id, project_id
                    )

                    # Commit the classification result immediately
                    await conn.commit()

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

        # Generate presigned URLs for each image (keep signature for authentication)
        for image in images:
            if image.get("s3_key"):
                client = s3_client()
                url = client.presigned_get_object(
                    settings.S3_BUCKET_NAME, image["s3_key"], expires=timedelta(hours=1)
                )
                # Keep presigned params (strip_presign=False) so signature is preserved
                image["url"] = strip_presigned_url_for_local_dev(
                    url, strip_presign=False
                )

            # Generate presigned URL for thumbnail if available
            if image.get("thumbnail_url"):
                client = s3_client()
                thumbnail_presigned = client.presigned_get_object(
                    settings.S3_BUCKET_NAME,
                    image["thumbnail_url"],
                    expires=timedelta(hours=1),
                )
                image["thumbnail_url"] = strip_presigned_url_for_local_dev(
                    thumbnail_presigned, strip_presign=False
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
        query = """
            SELECT
                pi.task_id,
                t.project_task_index,
                COUNT(*) as image_count,
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
            WHERE pi.batch_id = %(batch_id)s
            AND pi.project_id = %(project_id)s
            AND pi.status IN ('assigned', 'rejected', 'invalid_exif')
            GROUP BY pi.task_id, t.project_task_index
            ORDER BY t.project_task_index NULLS LAST
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                query, {"batch_id": str(batch_id), "project_id": str(project_id)}
            )
            task_groups = await cur.fetchall()

        # Generate presigned URLs for thumbnails
        for group in task_groups:
            for image in group["images"]:
                if image.get("thumbnail_url"):
                    client = s3_client()
                    thumbnail_presigned = client.presigned_get_object(
                        settings.S3_BUCKET_NAME,
                        image["thumbnail_url"],
                        expires=timedelta(hours=1),
                    )
                    image["thumbnail_url"] = strip_presigned_url_for_local_dev(
                        thumbnail_presigned, strip_presign=False
                    )

                # Generate presigned URL for full image
                if image.get("s3_key"):
                    client = s3_client()
                    url = client.presigned_get_object(
                        settings.S3_BUCKET_NAME,
                        image["s3_key"],
                        expires=timedelta(hours=1),
                    )
                    image["url"] = strip_presigned_url_for_local_dev(
                        url, strip_presign=False
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
        # Get count of images to be deleted
        count_query = """
            SELECT COUNT(*) as count
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                count_query,
                {"batch_id": str(batch_id), "project_id": str(project_id)},
            )
            result = await cur.fetchone()
            image_count = result["count"] if result else 0

        # Delete all images in the batch
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

        log.info(
            f"Deleted {image_count} images from batch {batch_id} in project {project_id}"
        )

        return {
            "message": "Batch deleted successfully",
            "batch_id": str(batch_id),
            "deleted_count": image_count,
        }

    @staticmethod
    async def get_batch_map_data(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> dict:
        """Get map data for batch review visualization.

        Returns task geometries and image point locations as GeoJSON.
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

        # Get image locations as GeoJSON points
        images_query = """
            SELECT
                id,
                filename,
                status,
                task_id,
                ST_X(location::geometry) as longitude,
                ST_Y(location::geometry) as latitude
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
            AND location IS NOT NULL
        """

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                images_query,
                {"batch_id": str(batch_id), "project_id": str(project_id)},
            )
            images = await cur.fetchall()

        images_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [img["longitude"], img["latitude"]],
                    },
                    "properties": {
                        "id": str(img["id"]),
                        "filename": img["filename"],
                        "status": img["status"],
                        "task_id": str(img["task_id"]) if img["task_id"] else None,
                    },
                }
                for img in images
                if img["longitude"] is not None and img["latitude"] is not None
            ],
        }

        return {
            "batch_id": str(batch_id),
            "tasks": tasks_geojson,
            "images": images_geojson,
            "total_tasks": len(tasks_geojson["features"]),
            "total_images": len(images_geojson["features"]),
        }
