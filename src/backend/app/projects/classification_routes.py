from datetime import datetime
from typing import Annotated, Optional
from uuid import UUID

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger as log
from psycopg import Connection
from pydantic import BaseModel

from app.arq.tasks import get_redis_pool
from app.config import settings
from app.db import database
from app.models.enums import HTTPStatus
from app.projects.image_classification import ImageClassifier
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/projects",
    responses={404: {"description": "Not found"}},
)


class StartClassificationRequest(BaseModel):
    batch_id: UUID
    project_id: UUID


class ClassificationStatusResponse(BaseModel):
    batch_id: str
    total: int
    assigned: int
    rejected: int
    unmatched: int
    invalid: int
    images: list[dict]


@router.post("/{project_id}/classify-batch/", tags=["Image Classification"])
async def start_batch_classification(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    # First check if there are any images in the batch with status 'uploaded'
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*) as count
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
            AND status = 'uploaded'
            """,
            {
                "batch_id": str(batch_id),
                "project_id": str(project_id)
            }
        )
        result = await cur.fetchone()
        image_count = result[0] if result else 0

    # If no images to classify, return early without creating a job
    if image_count == 0:
        log.info(f"No images to classify for batch: {batch_id}")
        return {
            "message": "No images available for classification",
            "batch_id": str(batch_id),
            "image_count": 0,
        }

    # Enqueue the classification job
    job = await redis.enqueue_job(
        "classify_image_batch",
        str(project_id),
        str(batch_id),
        _queue_name="default_queue",
    )

    log.info(f"Queued batch classification job: {job.job_id} for batch: {batch_id} ({image_count} images)")

    return {
        "message": "Batch classification started",
        "job_id": job.job_id,
        "batch_id": str(batch_id),
        "image_count": image_count,
    }


@router.get("/{project_id}/batch/{batch_id}/images/", tags=["Image Classification"])
async def get_batch_images(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    last_timestamp: Optional[str] = Query(None, description="ISO 8601 timestamp to get updates since"),
):
    try:
        timestamp = datetime.fromisoformat(last_timestamp) if last_timestamp else None

        images = await ImageClassifier.get_batch_images(
            db, batch_id, project_id, timestamp
        )

        return {
            "batch_id": str(batch_id),
            "images": images,
            "count": len(images)
        }

    except Exception as e:
        log.error(f"Failed to get batch images: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve batch images: {e}"
        )


@router.get("/{project_id}/batch/{batch_id}/status/", tags=["Image Classification"])
async def get_batch_status(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    try:
        query = """
            SELECT
                status,
                COUNT(*) as count
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
            GROUP BY status
        """

        async with db.cursor() as cur:
            await cur.execute(
                query,
                {
                    "batch_id": str(batch_id),
                    "project_id": str(project_id)
                }
            )
            results = await cur.fetchall()

        status_counts = {status: count for status, count in results}

        return {
            "batch_id": str(batch_id),
            "total": sum(status_counts.values()),
            "uploaded": status_counts.get("uploaded", 0),
            "classifying": status_counts.get("classifying", 0),
            "assigned": status_counts.get("assigned", 0),
            "rejected": status_counts.get("rejected", 0),
            "unmatched": status_counts.get("unmatched", 0),
            "invalid_exif": status_counts.get("invalid_exif", 0),
        }

    except Exception as e:
        log.error(f"Failed to get batch status: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve batch status: {e}"
        )
