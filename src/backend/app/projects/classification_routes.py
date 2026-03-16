import os
from datetime import datetime
from typing import Annotated, Optional
from uuid import UUID

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger as log
from psycopg import Connection
from pydantic import BaseModel

from drone_flightplan.drone_type import DRONE_PARAMS, DroneType

from app.arq.tasks import get_redis_pool
from app.db import database
from app.models.enums import HTTPStatus, State
from app.images.image_classification import ImageClassifier
from app.images.flight_gap_identification import identify_flight_gaps
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from fastapi.responses import FileResponse


router = APIRouter(
    prefix="/projects",
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


@router.get("/{project_id}/latest-batch/", tags=["Image Classification"])
async def get_latest_batch(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Get the most recent batch ID for a project."""
    try:
        async with db.cursor() as cur:
            await cur.execute(
                """
                SELECT batch_id
                FROM project_images
                WHERE project_id = %(project_id)s
                AND batch_id IS NOT NULL
                GROUP BY batch_id
                ORDER BY MAX(uploaded_at) DESC
                LIMIT 1
                """,
                {"project_id": str(project_id)},
            )
            result = await cur.fetchone()

        if not result:
            raise HTTPException(
                status_code=HTTPStatus.NOT_FOUND,
                detail="No batches found for this project",
            )

        return {"batch_id": str(result[0]), "project_id": str(project_id)}

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to get latest batch: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to get latest batch: {e}",
        )


@router.post("/{project_id}/classify-batch/", tags=["Image Classification"])
async def start_batch_classification(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    log.info(
        f"Received classification request: project_id={project_id}, batch_id={batch_id}"
    )

    # First check if there are any images in the batch with status 'staged'
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*) as count
            FROM project_images
            WHERE batch_id = %(batch_id)s
            AND project_id = %(project_id)s
            AND status = 'staged'
            """,
            {"batch_id": str(batch_id), "project_id": str(project_id)},
        )
        result = await cur.fetchone()
        image_count = result[0] if result else 0

    log.info(
        f"Found {image_count} staged images for project_id={project_id}, batch_id={batch_id}"
    )

    # If no images to classify, return early without creating a job
    if image_count == 0:
        log.warning(
            f"No images to classify for batch: {batch_id}, project: {project_id}"
        )
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

    log.info(
        f"Queued batch classification job: {job.job_id} for batch: {batch_id} ({image_count} images)"
    )

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
    last_timestamp: Optional[str] = Query(
        None, description="ISO 8601 timestamp to get updates since"
    ),
):
    try:
        timestamp = datetime.fromisoformat(last_timestamp) if last_timestamp else None

        images = await ImageClassifier.get_batch_images(
            db, batch_id, project_id, timestamp
        )

        return {"batch_id": str(batch_id), "images": images, "count": len(images)}

    except Exception as e:
        log.error(f"Failed to get batch images: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve batch images: {e}",
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
                query, {"batch_id": str(batch_id), "project_id": str(project_id)}
            )
            results = await cur.fetchall()

        status_counts = {status: count for status, count in results}

        return {
            "batch_id": str(batch_id),
            "total": sum(status_counts.values()),
            "staged": status_counts.get("staged", 0),
            "uploaded": status_counts.get("uploaded", 0),
            "classifying": status_counts.get("classifying", 0),
            "assigned": status_counts.get("assigned", 0),
            "rejected": status_counts.get("rejected", 0),
            "unmatched": status_counts.get("unmatched", 0),
            "invalid_exif": status_counts.get("invalid_exif", 0),
            "duplicate": status_counts.get("duplicate", 0),
        }

    except Exception as e:
        log.error(f"Failed to get batch status: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve batch status: {e}",
        )


@router.get("/{project_id}/batch/{batch_id}/review/", tags=["Image Classification"])
async def get_batch_review(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    try:
        review_data = await ImageClassifier.get_batch_review_data(
            db, batch_id, project_id
        )
        return review_data

    except Exception as e:
        log.error(f"Failed to get batch review data: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve batch review data: {e}",
        )


@router.post("/{project_id}/images/{image_id}/accept/", tags=["Image Classification"])
async def accept_image(
    project_id: UUID,
    image_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    try:
        result = await ImageClassifier.accept_image(db, image_id, project_id)
        return result

    except ValueError as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        log.error(f"Failed to accept image: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to accept image: {e}",
        )


@router.get("/{project_id}/batch/{batch_id}/map-data/", tags=["Image Classification"])
async def get_batch_map_data(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Get map data for batch review: task geometries and image point locations."""
    try:
        map_data = await ImageClassifier.get_batch_map_data(db, batch_id, project_id)
        return map_data

    except Exception as e:
        log.error(f"Failed to get batch map data: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve batch map data: {e}",
        )


@router.delete("/{project_id}/batch/{batch_id}/", tags=["Image Classification"])
async def delete_batch(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    user: Annotated[AuthUser, Depends(login_required)],
    wait_for_cleanup: bool = Query(
        False,
        description="Delete immediately instead of enqueueing a background job",
    ),
):
    try:
        if wait_for_cleanup:
            return await ImageClassifier.delete_batch(db, batch_id, project_id)

        # Enqueue the deletion job to run in background
        job = await redis.enqueue_job(
            "delete_batch_images",
            str(project_id),
            str(batch_id),
            _queue_name="default_queue",
        )

        log.info(f"Queued batch deletion job: {job.job_id} for batch: {batch_id}")

        return {
            "message": "Batch deletion started",
            "job_id": job.job_id,
            "batch_id": str(batch_id),
        }

    except Exception as e:
        log.error(f"Failed to queue batch deletion: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to delete batch: {e}",
        )


@router.get(
    "/{project_id}/batch/{batch_id}/processing-summary/", tags=["Image Classification"]
)
async def get_batch_processing_summary(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Get processing summary for batch - tasks and image counts ready for ODM."""
    try:
        summary = await ImageClassifier.get_batch_processing_summary(
            db, batch_id, project_id
        )
        return summary

    except Exception as e:
        log.error(f"Failed to get batch processing summary: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve batch processing summary: {e}",
        )


@router.post("/{project_id}/batch/{batch_id}/finalize/", tags=["Image Classification"])
async def finalize_batch(
    project_id: UUID,
    batch_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Finalize a batch: move images to task folders without triggering ODM processing.

    This is called when a user clicks 'Finish' without processing any tasks.
    It ensures images are stored under the correct {task_id}/images/ path.
    """
    try:
        move_result = await ImageClassifier.move_batch_images_to_tasks(
            db, batch_id, project_id
        )
        await db.commit()

        log.info(
            f"Finalized batch {batch_id}: moved {move_result['total_moved']} images "
            f"to {move_result['task_count']} tasks"
        )

        return {
            "message": "Batch finalized successfully",
            "batch_id": str(batch_id),
            "total_moved": move_result["total_moved"],
            "task_count": move_result["task_count"],
        }

    except Exception as e:
        log.error(f"Failed to finalize batch: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to finalize batch: {e}",
        )


@router.post("/{project_id}/batch/{batch_id}/process/", tags=["Image Classification"])
async def process_batch(
    project_id: UUID,
    batch_id: UUID,
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Process a batch: move images to task folders and trigger ODM processing.

    This endpoint:
    1. Moves assigned images from user-uploads to their task folders in S3
    2. Triggers ODM processing for each task with images
    """
    try:
        # Enqueue the processing job to run in background
        job = await redis.enqueue_job(
            "process_batch_images",
            str(project_id),
            str(batch_id),
            _queue_name="default_queue",
        )

        log.info(f"Queued batch processing job: {job.job_id} for batch: {batch_id}")

        return {
            "message": "Batch processing started",
            "job_id": job.job_id,
            "batch_id": str(batch_id),
        }

    except Exception as e:
        log.error(f"Failed to queue batch processing: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to start batch processing: {e}",
        )


@router.get(
    "/{project_id}/batch/{batch_id}/task/{task_id}/verification/",
    tags=["Image Classification"],
)
async def get_task_verification_data(
    project_id: UUID,
    batch_id: UUID,
    task_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Get task images and geometry for verification modal."""
    try:
        verification_data = await ImageClassifier.get_task_verification_data(
            db, task_id, batch_id, project_id
        )
        return verification_data

    except Exception as e:
        log.error(f"Failed to get task verification data: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve task verification data: {e}",
        )


@router.delete("/{project_id}/images/{image_id}/", tags=["Image Classification"])
async def delete_image(
    project_id: UUID,
    image_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Delete a single image from a project."""
    try:
        # First verify the image belongs to this project
        async with db.cursor() as cur:
            await cur.execute(
                """
                SELECT id, s3_key FROM project_images
                WHERE id = %(image_id)s AND project_id = %(project_id)s
                """,
                {"image_id": str(image_id), "project_id": str(project_id)},
            )
            image = await cur.fetchone()

            if not image:
                raise HTTPException(
                    status_code=HTTPStatus.NOT_FOUND,
                    detail="Image not found in this project",
                )

            # Delete the image record
            await cur.execute(
                "DELETE FROM project_images WHERE id = %(image_id)s",
                {"image_id": str(image_id)},
            )

        log.info(f"Deleted image {image_id} from project {project_id}")

        return {
            "message": "Image deleted successfully",
            "image_id": str(image_id),
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to delete image: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to delete image: {e}",
        )


# ─── Project-level (task-centric) endpoints ──────────────────────────────────


@router.get("/{project_id}/imagery/tasks/", tags=["Image Classification"])
async def get_project_task_imagery_summary(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Per-task imagery summary aggregated across all batches.

    Single source of truth for task readiness, image counts, and processability.
    """
    try:
        return await ImageClassifier.get_project_task_imagery_summary(db, project_id)
    except Exception as e:
        log.error(f"Failed to get project task imagery summary: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve task imagery summary: {e}",
        )


@router.get("/{project_id}/imagery/review/", tags=["Image Classification"])
async def get_project_review(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Project-level review data: images grouped by task across all batches."""
    try:
        return await ImageClassifier.get_project_review_data(db, project_id)
    except Exception as e:
        log.error(f"Failed to get project review data: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve project review data: {e}",
        )


@router.get("/{project_id}/imagery/map-data/", tags=["Image Classification"])
async def get_project_map_data(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Project-level map data: task geometries + all image points across batches."""
    try:
        return await ImageClassifier.get_project_map_data(db, project_id)
    except Exception as e:
        log.error(f"Failed to get project map data: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve project map data: {e}",
        )


@router.get(
    "/{project_id}/imagery/task/{task_id}/verification/",
    tags=["Image Classification"],
)
async def get_project_task_verification(
    project_id: UUID,
    task_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Task verification data aggregated across all batches."""
    try:
        return await ImageClassifier.get_task_verification_data_project(
            db, task_id, project_id
        )
    except ValueError as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail=str(e))
    except Exception as e:
        log.error(f"Failed to get task verification data: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve task verification data: {e}",
        )


@router.post(
    "/{project_id}/tasks/{task_id}/mark-verified/", tags=["Image Classification"]
)
async def mark_task_verified(
    project_id: UUID,
    task_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Mark a task as verified/fully flown after visual inspection.

    This inserts a new task event with READY_FOR_PROCESSING state, indicating that
    the user has verified that all required images are present and the task
    is ready for processing. After marking, it also moves the task's images
    from the upload staging area to the task's images folder so they are
    ready for ODM processing.
    """
    try:
        async with db.cursor() as cur:
            # Verify the task exists and belongs to this project
            await cur.execute(
                """
                SELECT id FROM tasks
                WHERE id = %(task_id)s AND project_id = %(project_id)s
                """,
                {"task_id": str(task_id), "project_id": str(project_id)},
            )
            task = await cur.fetchone()

            if not task:
                raise HTTPException(
                    status_code=HTTPStatus.NOT_FOUND,
                    detail="Task not found in this project",
                )

            # Insert a new task event to mark the task as READY_FOR_PROCESSING
            await cur.execute(
                """
                INSERT INTO task_events (
                    event_id, project_id, task_id, user_id, state, comment, updated_at, created_at
                )
                VALUES (
                    gen_random_uuid(),
                    %(project_id)s,
                    %(task_id)s,
                    %(user_id)s,
                    %(state)s,
                    %(comment)s,
                    NOW(),
                    NOW()
                )
                """,
                {
                    "project_id": str(project_id),
                    "task_id": str(task_id),
                    "user_id": str(user.id),
                    "state": State.READY_FOR_PROCESSING.name,
                    "comment": "Images verified and task ready for processing",
                },
            )

        # Move images BEFORE committing the state change so we don't mark
        # verified when files never made it to the task folder.
        move_result = await ImageClassifier.move_task_images_to_folder(
            db, project_id, task_id
        )

        if move_result.get("failed_count", 0) > 0:
            await db.rollback()
            raise HTTPException(
                status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                detail=(
                    f"Failed to move {move_result['failed_count']} image(s) "
                    f"to the task folder. Task was NOT marked as verified. "
                    f"Please try again."
                ),
            )

        await db.commit()

        log.info(
            f"Task {task_id} marked as verified (READY_FOR_PROCESSING) by user {user.id}, "
            f"{move_result.get('moved_count', 0)} images moved"
        )

        return {
            "message": "Task marked as fully flown",
            "task_id": str(task_id),
            "state": State.READY_FOR_PROCESSING.name,
            "images_moved": move_result.get("moved_count", 0),
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to mark task as verified: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to mark task as verified: {e}",
        )


@router.post(
    "/{project_id}/batch/{batch_id}/task/{task_id}/find-gaps/",
    tags=["Image Classification"],
)
async def detect_task_flight_gaps(
    project_id: UUID,
    batch_id: UUID,
    task_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    manual_gap_polygons: dict = None,
):
    """Conducts the flight gap analysis."""
    result = await identify_flight_gaps(
        db, project_id, batch_id, task_id, manual_gap_polygons
    )

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Could not perform flight gap analysis for this task.",
        )

    try:
        drone_type = result.get("drone_type").value
    except:
        log.error(f"Could not find drone type value {drone_type}")

    flightplan_url = None

    if result.get("kmz_bytes"):
        file_path = f"/tmp/reflight_{task_id}.kmz"
        with open(file_path, "wb") as f:
            f.write(result["kmz_bytes"])
        flightplan_url = (
            f"/api/projects/tasks/{task_id}/{drone_type}/download-reflight-plan/"
        )

    return {
        "task_id": str(task_id),
        "message": result.get("message"),
        "task_geometry": result.get("task_geometry"),
        "gap_polygons": result.get("gap_polygons"),
        "drone_type": result.get("drone_type"),
        "images": result.get("images"),
        "flightplan_url": flightplan_url,
    }


@router.get(
    "/tasks/{task_id}/{drone_type}/download-reflight-plan/",
    tags=["Image Classification"],
)
async def download_reflight_plan(project_id: UUID, task_id: UUID, drone_type: str):
    """Downloads a KMZ file of a reconstructed flight plan based on identified flight gaps."""
    file_path = f"/tmp/reflight_{task_id}.kmz"

    try:
        drone_model = drone_type.upper().replace(" ", "_")
        flight_drone_type = DroneType(drone_model)
    except:
        log.error(f"Could not find drone type {flight_drone_type}")

    output_format = DRONE_PARAMS[flight_drone_type].get("OUTPUT_FORMAT")

    if not os.path.exists(file_path):
        log.error(f"Flight plan file not found: {file_path}")
        raise HTTPException(
            status_code=404,
            detail="Flight plan file not found. Please run 'Find Gaps' again.",
        )

    if output_format == "DJI_WMPL":
        return FileResponse(
            file_path,
            media_type="application/vnd.google-earth.kmz",
            filename=(f"reflight_task_{task_id}_{drone_type}_project_{project_id}.kmz"),
        )

    elif output_format == "POTENSIC_SQLITE":
        return FileResponse(
            file_path,
            media_type="application/vnd.sqlite3",
            filename="reflight_map.db",
        )

    elif output_format == "POTENSIC_JSON":
        return FileResponse(
            file_path,
            media_type="application/zip",
            filename=(f"reflight_task_{task_id}_{drone_type}_project_{project_id}.zip"),
        )

    elif output_format == "QGROUNDCONTROL":
        return FileResponse(
            file_path,
            media_type="application/json",
            filename=(
                f"reflight_task_{task_id}_{drone_type}_project_{project_id}.plan"
            ),
        )

    elif output_format == "LITCHI":
        return FileResponse(
            file_path,
            media_type="text/csv",
            filename=(f"reflight_task_{task_id}_{drone_type}_project_{project_id}.csv"),
        )

    else:
        msg = f"Unsupported output format / drone type: {output_format}"
        log.error(msg)
        raise HTTPException(status_code=400, detail=msg)
