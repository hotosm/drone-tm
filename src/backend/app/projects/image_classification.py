import uuid
from datetime import datetime
from typing import Literal, Optional

from geoalchemy2.functions import ST_Intersects, ST_SetSRID, ST_Point
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from shapely import wkb
from shapely.geometry import Point, shape

from app.db.db_models import DbTask
from app.models.enums import ImageStatus


MIN_GIMBAL_ANGLE = -30.0
MIN_QUALITY_SCORE = 100.0


class ImageClassifier:

    @staticmethod
    async def check_image_quality(exif_data: dict) -> tuple[bool, Optional[str]]:
        gimbal_angle = exif_data.get("pitch")
        if gimbal_angle is not None and gimbal_angle > MIN_GIMBAL_ANGLE:
            return False, f"Gimbal angle {gimbal_angle:.1f}° too shallow (must be < {MIN_GIMBAL_ANGLE}°)"

        return True, None

    @staticmethod
    async def find_matching_task(
        db: Connection,
        project_id: uuid.UUID,
        latitude: float,
        longitude: float
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
                }
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
                SELECT id, exif, location, status
                FROM project_images
                WHERE id = %(image_id)s AND project_id = %(project_id)s
                """,
                {"image_id": str(image_id), "project_id": str(project_id)}
            )
            image = await cur.fetchone()

            if not image:
                return {
                    "image_id": str(image_id),
                    "status": "error",
                    "message": "Image not found"
                }

        logs = []
        exif_data = image.get("exif") or {}

        logs.append({
            "action": "EXIF Extraction",
            "details": "Reading metadata...",
            "status": "info"
        })

        if not exif_data:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.INVALID_EXIF, "No EXIF data found"
            )
            logs.append({
                "action": "REJECTED",
                "details": "No EXIF data found",
                "status": "error"
            })
            return {
                "image_id": str(image_id),
                "status": ImageStatus.INVALID_EXIF,
                "logs": logs
            }

        latitude = exif_data.get("latitude")
        longitude = exif_data.get("longitude")

        if latitude is None or longitude is None:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.INVALID_EXIF, "No GPS coordinates in EXIF"
            )
            logs.append({
                "action": "REJECTED",
                "details": "No GPS coordinates found",
                "status": "error"
            })
            return {
                "image_id": str(image_id),
                "status": ImageStatus.INVALID_EXIF,
                "logs": logs
            }

        logs.append({
            "action": "GPS Check",
            "details": f"Location: {latitude:.4f}, {longitude:.4f}",
            "status": "success"
        })

        quality_passed, quality_reason = await ImageClassifier.check_image_quality(exif_data)
        if not quality_passed:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.REJECTED, quality_reason
            )
            logs.append({
                "action": "REJECTED",
                "details": quality_reason,
                "status": "error"
            })
            return {
                "image_id": str(image_id),
                "status": ImageStatus.REJECTED,
                "reason": quality_reason,
                "logs": logs
            }

        gimbal_angle = exif_data.get("pitch")
        logs.append({
            "action": "Quality Check",
            "details": f"Gimbal: {gimbal_angle:.1f}° - Passed",
            "status": "success"
        })

        task_id = await ImageClassifier.find_matching_task(
            db, project_id, latitude, longitude
        )

        if not task_id:
            await ImageClassifier._update_image_status(
                db, image_id, ImageStatus.UNMATCHED, "No matching task boundary"
            )
            logs.append({
                "action": "UNMATCHED",
                "details": "No matching task boundary found",
                "status": "warning"
            })
            return {
                "image_id": str(image_id),
                "status": ImageStatus.UNMATCHED,
                "logs": logs
            }

        await ImageClassifier._assign_image_to_task(
            db, image_id, task_id
        )

        logs.append({
            "action": "ASSIGNED",
            "details": f"Matched to task {str(task_id)[:8]}...",
            "status": "success"
        })

        return {
            "image_id": str(image_id),
            "status": ImageStatus.ASSIGNED,
            "task_id": str(task_id),
            "logs": logs
        }

    @staticmethod
    async def _update_image_status(
        db: Connection,
        image_id: uuid.UUID,
        status: ImageStatus,
        rejection_reason: Optional[str] = None
    ):
        query = """
            UPDATE project_images
            SET status = %(status)s,
                rejection_reason = %(rejection_reason)s,
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
                    "classified_at": datetime.utcnow()
                }
            )

    @staticmethod
    async def _assign_image_to_task(
        db: Connection,
        image_id: uuid.UUID,
        task_id: uuid.UUID
    ):
        query = """
            UPDATE project_images
            SET status = %(status)s,
                task_id = %(task_id)s,
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
                    "classified_at": datetime.utcnow()
                }
            )

    @staticmethod
    async def classify_batch(
        db: Connection,
        batch_id: uuid.UUID,
        project_id: uuid.UUID
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
                    "status": ImageStatus.UPLOADED.value
                }
            )
            images = await cur.fetchall()

        if not images:
            return {
                "batch_id": str(batch_id),
                "message": "No images to classify",
                "total": 0
            }

        results = {
            "batch_id": str(batch_id),
            "total": len(images),
            "assigned": 0,
            "rejected": 0,
            "unmatched": 0,
            "invalid": 0,
            "images": []
        }

        for image in images:
            image_id = uuid.UUID(image["id"])

            async with db.cursor() as cur:
                await cur.execute(
                    "UPDATE project_images SET status = %(status)s WHERE id = %(image_id)s",
                    {"status": ImageStatus.CLASSIFYING.value, "image_id": str(image_id)}
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
        last_timestamp: Optional[datetime] = None
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

        params = {
            "batch_id": str(batch_id),
            "project_id": str(project_id)
        }

        if last_timestamp:
            query += " AND classified_at > %(last_timestamp)s"
            params["last_timestamp"] = last_timestamp

        query += " ORDER BY uploaded_at"

        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, params)
            return await cur.fetchall()
