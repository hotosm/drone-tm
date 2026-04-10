import os
from datetime import datetime
from typing import Annotated, Optional
from uuid import UUID

from arq import ArqRedis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from loguru import logger as log
from psycopg import Connection
from pydantic import BaseModel

from drone_flightplan.drone_type import DroneType

from app.arq.tasks import get_redis_pool
from app.db import database
from app.models.enums import HTTPStatus, State
from app.images.image_classification import ImageClassifier
from app.images.flight_gap_identification import identify_flight_gaps
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.waypoints.flightplan_output import (
    build_flightplan_download_response,
    get_flightplan_output_config,
)


router = APIRouter(
    prefix="/projects",
    responses={404: {"description": "Not found"}},
)


class FlightGapDetectionRequest(BaseModel):
    manual_gap_polygons: dict | None = None
    drone_type: DroneType | None = None


class FlightGapDownloadPlanRequest(BaseModel):
    manual_gap_polygons: dict | None = None
    gap_type: str | None = None
    drone_type: DroneType | None = None
    altitude: float | None = None
    rotation: float | None = None
    overlap: float | None = None


@router.post("/{project_id}/classify/", tags=["Image Classification"])
async def start_project_classification(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Classify all staged/uploaded images in a project (across all batches).

    Also reclaims 'classifying' rows stranded by a crashed worker (stale > 10 min).
    """
    log.info(f"Received project classification request: project_id={project_id}")

    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*) as count
            FROM project_images
            WHERE project_id = %(project_id)s
            AND (
                status IN ('staged', 'uploaded')
                OR (
                    status = 'classifying'
                    AND classified_at < NOW() - interval '10 minutes'
                )
            )
            """,
            {"project_id": str(project_id)},
        )
        result = await cur.fetchone()
        image_count = result[0] if result else 0

    log.info(f"Found {image_count} classifiable images for project_id={project_id}")

    if image_count == 0:
        return {
            "message": "No images available for classification",
            "project_id": str(project_id),
            "image_count": 0,
        }

    job = await redis.enqueue_job(
        "classify_project_images",
        str(project_id),
        _queue_name="default_queue",
    )

    log.info(
        f"Queued project classification job: {job.job_id} for project: {project_id} ({image_count} images)"
    )

    return {
        "message": "Project classification started",
        "job_id": job.job_id,
        "project_id": str(project_id),
        "image_count": image_count,
    }


@router.post("/{project_id}/ingest-uploads/", tags=["Image Classification"])
async def ingest_existing_uploads(
    project_id: UUID,
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Enqueue a background job to scan user-uploads/ and ingest untracked files.

    The actual S3 scan and per-file enqueue happens in an ARQ worker so the
    request returns immediately regardless of how many objects exist.

    Uses a stable _job_id so ARQ deduplicates concurrent/retry requests for
    the same project - a second call while the first is queued or running is
    a no-op.
    """
    import uuid as _uuid

    batch_id = str(_uuid.uuid4())
    stable_job_id = f"ingest-uploads:{project_id}"
    job = await redis.enqueue_job(
        "ingest_existing_uploads",
        str(project_id),
        user.id,
        batch_id,
        _queue_name="default_queue",
        _job_id=stable_job_id,
    )

    if job is None:
        log.info(
            f"Ingest-uploads: job already queued/running for project {project_id} "
            f"(job_id {stable_job_id})"
        )
        return {
            "message": "Ingestion job already queued",
            "job_id": stable_job_id,
            "project_id": str(project_id),
            "batch_id": batch_id,
        }

    log.info(
        f"Ingest-uploads: queued job {job.job_id} for project {project_id} "
        f"(batch {batch_id})"
    )
    return {
        "message": "Ingestion job queued",
        "job_id": job.job_id,
        "project_id": str(project_id),
        "batch_id": batch_id,
    }


@router.get("/{project_id}/imagery/status/", tags=["Image Classification"])
async def get_project_imagery_status(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Get imagery status summary for a project across all batches."""
    try:
        query = """
            SELECT
                status,
                COUNT(*) as count
            FROM project_images
            WHERE project_id = %(project_id)s
            GROUP BY status
        """

        async with db.cursor() as cur:
            await cur.execute(query, {"project_id": str(project_id)})
            results = await cur.fetchall()

        status_counts = {status: count for status, count in results}

        return {
            "project_id": str(project_id),
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
        log.error(f"Failed to get project imagery status: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve project imagery status: {e}",
        )


@router.get("/{project_id}/imagery/images/", tags=["Image Classification"])
async def get_project_images(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    last_timestamp: Optional[str] = Query(
        None, description="ISO 8601 timestamp to get updates since"
    ),
    status: Optional[list[str]] = Query(
        None, description="Filter by status(es), e.g. ?status=staged&status=uploaded"
    ),
):
    """Get images for a project across all batches, with optional status filter."""
    try:
        timestamp = datetime.fromisoformat(last_timestamp) if last_timestamp else None

        images = await ImageClassifier.get_project_images(
            db, project_id, timestamp, status_filter=status
        )

        return {"project_id": str(project_id), "images": images, "count": len(images)}

    except Exception as e:
        log.error(f"Failed to get project images: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to retrieve project images: {e}",
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
        await db.commit()
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


class ManualTaskAssignRequest(BaseModel):
    task_id: UUID


@router.post(
    "/{project_id}/images/{image_id}/assign-task/",
    tags=["Image Classification"],
)
async def assign_image_to_task(
    project_id: UUID,
    image_id: UUID,
    body: ManualTaskAssignRequest,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Manually assign an image to a task, bypassing GPS-based matching."""
    try:
        result = await ImageClassifier.manual_assign_to_task(
            db, image_id, body.task_id, project_id
        )
        await db.commit()
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        log.error(f"Failed to manually assign image to task: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to assign image to task: {e}",
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

        await db.commit()
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


@router.delete("/{project_id}/imagery/invalid/", tags=["Image Classification"])
async def delete_invalid_images(
    project_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
):
    """Delete all invalid/unmatched images for a project (rejected, invalid_exif, unmatched, duplicate)."""
    try:
        return await ImageClassifier.delete_invalid_images(db, project_id)
    except Exception as e:
        log.error(f"Failed to delete invalid images: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to delete invalid images: {e}",
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
    "/{project_id}/imagery/task/{task_id}/find-gaps/",
    tags=["Image Classification"],
)
async def detect_task_flight_gaps(
    project_id: UUID,
    task_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    request: FlightGapDetectionRequest | None = None,
):
    """Conduct flight gap analysis across all uploaded imagery for a task."""
    drone_type_override = request.drone_type if request else None
    result = await identify_flight_gaps(
        db,
        project_id,
        task_id,
        drone_type_override=drone_type_override,
    )

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Could not perform flight gap analysis for this task.",
        )

    drone_type = result.get("drone_type")
    drone_type_value = drone_type.value if isinstance(drone_type, DroneType) else None

    return {
        "task_id": str(task_id),
        "message": result.get("message"),
        "task_geometry": result.get("task_geometry"),
        "gap_polygons": result.get("gap_polygons"),
        "gap_type": result.get("gap_type"),
        "drone_type": drone_type_value,
        "images": result.get("images"),
        "altitude": result.get("altitude"),
        "rotation": result.get("rotation"),
        "overlap": result.get("overlap"),
    }


@router.post(
    "/{project_id}/imagery/task/{task_id}/generate-flightplan/",
    tags=["Image Classification"],
)
async def download_reflight_plan(
    project_id: UUID,
    task_id: UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    background_tasks: BackgroundTasks,
    request: FlightGapDownloadPlanRequest | None = None,
):
    """Download a reconstructed flight plan based on identified flight gaps."""
    manual_gap_polygons = request.manual_gap_polygons if request else None
    gap_type = request.gap_type
    drone_type_override = request.drone_type
    altitude_override = request.altitude
    rotation_override = request.rotation
    overlap_override = request.overlap

    if not drone_type_override:
        raise HTTPException(
            status_code=400, detail="Drone type is required to generate a flightplan."
        )
    flight_drone_type = drone_type_override

    result = await identify_flight_gaps(
        db,
        project_id,
        task_id,
        manual_gap_polygons,
        gap_type=gap_type,
        drone_type_override=drone_type_override,
        altitude_override=altitude_override,
        rotation_override=rotation_override,
        overlap_override=overlap_override,
    )

    if not result:
        raise HTTPException(
            status_code=400,
            detail="Could not generate a flightplan with the provided parameters.",
        )

    kmz_bytes = result.get("kmz_bytes")

    if not kmz_bytes:
        raise HTTPException(
            status_code=400,
            detail="The flightplan generator could not produce a file with the provided data.",
        )

    flightplan_config = get_flightplan_output_config(flight_drone_type)
    file_path = f"/tmp/reflight_{task_id}{flightplan_config['suffix']}"

    with open(file_path, "wb") as f:
        f.write(result["kmz_bytes"])

    background_tasks.add_task(os.remove, file_path)

    return build_flightplan_download_response(
        file_path,
        drone_type=flight_drone_type,
        filename_stem=f"reflight_task_{task_id}_{flight_drone_type}_project_{project_id}",
    )
