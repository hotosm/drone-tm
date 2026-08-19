import asyncio
import base64
import hashlib
import io
import json
import os
import shutil
import statistics
import tempfile
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
import zipfile
from enum import Enum
from pathlib import Path
from typing import Any, ClassVar, NamedTuple
from uuid import UUID

import aiohttp
from app.arq.cloudnative import (
    generate_3d_tiles,
    generate_orthophoto_cog,
)
from app.config import settings
from app.db.database import get_db_connection_pool
from app.images.flight_gimbal_deviation import mark_and_remove_off_axis_imagery
from app.images.flight_stationary_removal import mark_and_remove_stationary_imagery
from app.images.flight_tail_removal import mark_and_remove_flight_tail_imagery
from app.images.image_classification import ImageClassifier
from app.images.image_logic import (
    calculate_file_hash,
    check_duplicate_image,
    create_project_image,
    extract_exif_data,
)
from app.images.image_processing import (
    extract_and_upload_odm_assets,
)
from app.images.image_schemas import ProjectImageCreate, ProjectImageOut
from app.jaxa.upload_dem import download_and_upload_dem
from app.models.enums import HTTPStatus, ImageProcessingStatus, ImageStatus, State
from app.projects import project_logic, project_schemas
from app.projects.project_logic import (
    process_all_drone_images,
    process_drone_images,
    process_task_metrics,
)
from app.projects.s3_paths import public_qfield_zip_key
from app.s3 import (
    add_obj_to_bucket,
    async_get_obj_from_bucket,
    delete_objects_by_prefix,
    generate_presigned_get_url,
    get_file_from_bucket,
    s3_client,
    s3_object_exists,
)
from app.tasks import task_logic
from app.utils import timestamp
from arq import ArqRedis, Retry, create_pool, cron
from arq.connections import RedisSettings, log_redis_info
from arq.jobs import Job, JobStatus
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from loguru import logger as log
from PIL import Image
from psycopg.rows import dict_row

THUMBNAIL_SIZE = (200, 200)


# ── EXIF-based project creation from a remote S3-compatible bucket ────────────
#
# Pulls the first ~128KB of each JPEG in a public bucket via HTTP Range
# requests, runs exiftool to read the GPS, builds a buffered convex hull as
# the AOI, then creates a drone-tm project + 600m task split. Imagery transfer
# and ingestion are handled by separate flows (existing justfile + ingest
# endpoint) - this task only creates the project shell.
_EXIF_HEAD_BYTES = 128 * 1024
_HULL_BUFFER_METERS = 100
_TASK_SPLIT_METERS = 600
_MIN_GPS_RATIO = 0.8
_MAX_DEPTH_FROM_PREFIX = 3
_LIST_PAGE_SIZE = 1000
_FETCH_CONCURRENCY = 8


async def startup(ctx: dict[Any, Any]) -> None:
    """Initialize ARQ resources including database pool"""
    log.info("Starting ARQ worker")

    # Initialize Redis
    ctx["redis"] = await create_pool(RedisSettings.from_dsn(settings.DRAGONFLY_DSN))
    await log_redis_info(ctx["redis"], log.info)

    # Initialize Database pool
    ctx["db_pool"] = await get_db_connection_pool()
    log.info("Database pool initialized")


async def shutdown(ctx: dict[Any, Any]) -> None:
    """Cleanup ARQ resources"""
    log.info("Shutting down ARQ worker")

    # Close Redis
    if redis := ctx.get("redis"):
        await redis.close()
        log.info("Redis connection closed")

    # Close database pool
    if db_pool := ctx.get("db_pool"):
        await db_pool.close()
        log.info("Database connection pool closed")


def generate_thumbnail(
    image_bytes: bytes, size: tuple[int, int] = THUMBNAIL_SIZE
) -> bytes:
    """Generate thumbnail from image bytes.

    Args:
        image_bytes: Original image bytes
        size: Thumbnail size (width, height), defaults to 200x200

    Returns:
        Thumbnail image bytes in JPEG format

    Raises:
        ValueError: If image cannot be decoded
    """
    try:
        # Open image from bytes
        image = Image.open(io.BytesIO(image_bytes))

        # Convert RGBA to RGB if necessary (for PNG with transparency)
        if image.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(
                image,
                mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None,
            )
            image = background

        # Generate thumbnail maintaining aspect ratio
        image.thumbnail(size, Image.Resampling.LANCZOS)

        # Save to bytes
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=85, optimize=True)
        output.seek(0)

        return output.getvalue()

    except Exception as e:
        log.error(f"Error generating thumbnail: {e}")
        raise ValueError(f"Failed to generate thumbnail: {e}") from e


async def sleep_task(ctx: dict[Any, Any], **_kwargs: Any) -> dict[str, str]:
    """Test task to sleep for 1 minute"""
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting sleep_task (Job ID: {job_id})")

    try:
        await asyncio.sleep(60)
        log.info(f"Completed sleep_task (Job ID: {job_id})")
        return {"message": "Slept for 1 minute", "job_id": job_id}
    except Exception as e:
        log.error(f"Error in sleep_task (Job ID: {job_id}): {e!s}")
        raise


async def count_project_tasks(
    ctx: dict[Any, Any], project_id: str, **_kwargs: Any
) -> dict[str, Any]:
    """Example task that counts tasks for a given project"""
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting count_project_tasks (Job ID: {job_id})")

    try:
        pool = ctx["db_pool"]
        async with pool.connection() as conn, conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) FROM tasks WHERE project_id = %s", (project_id,)
            )
            count = (await cur.fetchone())[0]
            log.info(f"count = {count}")
            return {"count": count}

    except Exception as e:
        log.error(f"Error in count_project_tasks (Job ID: {job_id}): {e!s}")
        raise


async def _save_image_record(
    db,
    project_id: str,
    filename: str,
    file_key: str,
    file_hash: str,
    uploaded_by: str,
    exif_dict: dict | None = None,
    location: dict | None = None,
    status: ImageStatus = ImageStatus.STAGED,
    batch_id: str | None = None,
    thumbnail_url: str | None = None,
    rejection_reason: str | None = None,
) -> ProjectImageOut:
    """Save image record to database.

    Args:
        db: Database connection
        project_id: Project UUID
        filename: Original filename
        file_key: S3 key
        file_hash: MD5 hash
        uploaded_by: User ID
        exif_dict: EXIF data (optional)
        location: GPS location (optional)
        status: Image status (STAGED, INVALID_EXIF, etc.)
        batch_id: Batch UUID for grouping uploads (optional)
        thumbnail_url: S3 key for thumbnail (optional)

    Returns:
        ProjectImageOut: Saved image record
    """
    image_data = ProjectImageCreate(
        project_id=UUID(project_id),
        filename=filename,
        s3_key=file_key,
        hash_md5=file_hash,
        location=location,
        exif=exif_dict,
        uploaded_by=uploaded_by,
        status=status,
        batch_id=UUID(batch_id) if batch_id else None,
        thumbnail_url=thumbnail_url,
        rejection_reason=rejection_reason,
    )

    image_record = await create_project_image(db, image_data)
    await db.commit()

    log.info(
        f"Saved: {filename} | Status: {status} | "
        f"GPS: {location is not None} | EXIF: {exif_dict is not None} | "
        f"BatchID: {batch_id}"
    )

    return image_record


async def process_uploaded_image(
    ctx: dict[Any, Any],
    project_id: str,
    file_key: str,
    filename: str,
    uploaded_by: str,
    batch_id: str | None = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Process an uploaded image after it lands in S3 (ARQ worker).

    Pipeline invariants:
    - We always create a `project_images` row so the UI can show every upload.
    - Upload-time metadata problems (missing/invalid EXIF/GPS) are recorded here as
      `status=invalid_exif` with a user-facing `rejection_reason`.
    - Classification later only selects `status=staged` rows; it must not have to
      rediscover upload-time failures.

    Args:
        ctx: ARQ context
        project_id: UUID of the project
        file_key: S3 key of the uploaded file
        filename: Original filename
        uploaded_by: User ID who uploaded

    Returns:
        dict: Processing result with image_id and status
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(
        f"Starting process_uploaded_image (Job ID: {job_id}): {filename} | "
        f"BatchID received: {batch_id}"
    )

    try:
        # Get database connection from pool
        db_pool = ctx.get("db_pool")
        if not db_pool:
            raise RuntimeError("Database pool not initialized")

        async with db_pool.connection() as db:
            log.info(f"Downloading file from S3: {file_key}")
            file_obj = await async_get_obj_from_bucket(
                settings.S3_BUCKET_NAME, file_key
            )
            file_content = file_obj.read()

            log.info(f"Calculating hash for: {filename}")
            file_hash = calculate_file_hash(file_content)
            # NOTE: We deliberately compute MD5 from the file content rather than
            # using the S3 ETag. The ETag is upload-method-dependent: single-part
            # PUTs produce a plain MD5, but multipart uploads produce a compound
            # hash ({md5_of_parts}-{N}) that differs even for identical content
            # depending on chunk size. Server-side S3 copies preserve the source
            # ETag, so the same file ingested via different paths (browser upload,
            # transfer script, S3 copy) would get different ETags and dedup would
            # silently miss them. MD5 of the content is always consistent regardless
            # of how or where the file was uploaded.

            # Check for duplicates - create record with DUPLICATE status
            # Downstream the EXIF extraction and processing is skipped
            duplicate_of_id = await check_duplicate_image(
                db, UUID(project_id), file_hash
            )
            if duplicate_of_id:
                log.info(
                    f"Duplicate detected: {filename} (hash: {file_hash}) "
                    f"already exists as image {duplicate_of_id}"
                )
                # Create a record with DUPLICATE status to track it in the UI
                image_data = ProjectImageCreate(
                    project_id=UUID(project_id),
                    s3_key=file_key,
                    filename=filename,
                    uploaded_by=uploaded_by,
                    status=ImageStatus.DUPLICATE,
                    hash_md5=file_hash,
                    batch_id=UUID(batch_id) if batch_id else None,
                    duplicate_of=duplicate_of_id,
                )
                image = await create_project_image(db, image_data)
                await db.commit()
                return {
                    "image_id": str(image.id),
                    "status": ImageStatus.DUPLICATE.value,
                    "has_gps": False,
                    "is_duplicate": True,
                    "duplicate_of": str(duplicate_of_id),
                    "message": "Duplicate of existing image",
                }

            # Step 3: Extract EXIF (try-catch to handle failures gracefully)
            # Extract EXIF/GPS. If GPS fields exist but are invalid/out of range, we treat
            # it as upload-time invalid_exif so it cannot be classified/assigned.
            exif_dict = None
            location = None
            gps_error = None
            rejection_reason = None

            try:
                log.info(f"Extracting EXIF from: {filename}")
                exif_dict, location, gps_error = extract_exif_data(file_content)

                if exif_dict:
                    log.info(
                        f" EXIF: {len(exif_dict)} tags | GPS: {location is not None}"
                    )
                    log.debug(f"EXIF tags: {list(exif_dict.keys())[:10]}")
                else:
                    log.warning(f"No EXIF data in: {filename}")
                    log.debug(
                        f"Invalid EXIF for {filename}: extract_exif_data returned None "
                        f"(file_key={file_key}, bytes={len(file_content)})"
                    )
                    rejection_reason = "No EXIF data found"
                if gps_error and not rejection_reason:
                    rejection_reason = gps_error

            except Exception as exif_error:
                log.error(f"EXIF extraction failed for {filename}: {exif_error}")
                log.opt(exception=True).debug(
                    f"EXIF extraction exception for {filename}: {type(exif_error).__name__}: {exif_error}"
                )
                rejection_reason = f"EXIF extraction failed: {exif_error}"

            # Step 4: Generate and upload thumbnail of image (for quick UI display)
            # Thumbnails are best-effort: failure should not fail the upload record.
            thumbnail_s3_key = None
            try:
                log.info(f"Generating thumbnail for: {filename}")
                # Generate thumbnail (run in threadpool since PIL is CPU-bound)
                thumbnail_bytes = await asyncio.to_thread(
                    generate_thumbnail, file_content
                )

                # Create thumbnail S3 key next to the original with thumb_ prefix
                # e.g. projects/{pid}/user-uploads/thumb_{filename}
                parts = file_key.rsplit("/", 1)
                thumbnail_s3_key = (
                    f"{parts[0]}/thumb_{parts[1]}"
                    if len(parts) > 1
                    else f"thumb_{file_key}"
                )

                # Upload thumbnail to S3
                log.info(f"Uploading thumbnail to S3: {thumbnail_s3_key}")
                client = s3_client()
                thumbnail_s3_key = thumbnail_s3_key.lstrip("/")
                client.put_object(
                    settings.S3_BUCKET_NAME,
                    thumbnail_s3_key,
                    io.BytesIO(thumbnail_bytes),
                    len(thumbnail_bytes),
                    content_type="image/jpeg",
                )

                log.info(f"Thumbnail generated and uploaded: {thumbnail_s3_key}")

            except Exception as thumb_error:
                log.warning(
                    f"Failed to generate/upload thumbnail for {filename}: {thumb_error}"
                )
                # Continue even if thumbnail generation fails
                thumbnail_s3_key = None

            # Step 5: Determine status
            # If GPS was present but invalid, reject immediately so it cannot be
            # classified/assigned (and therefore cannot be included in flight-tail detection).
            # Status ownership: upload-time failures become INVALID_EXIF; otherwise the
            # image enters the classification pool as STAGED.
            status = (
                ImageStatus.INVALID_EXIF
                if (not exif_dict or gps_error)
                else ImageStatus.STAGED
            )

            # Step 6: Save image record (ALWAYS save, even if EXIF/thumbnail failed)
            image_record = await _save_image_record(
                db=db,
                project_id=project_id,
                filename=filename,
                file_key=file_key,
                file_hash=file_hash,
                uploaded_by=uploaded_by,
                exif_dict=exif_dict,
                location=location,
                status=status,
                batch_id=batch_id,
                thumbnail_url=thumbnail_s3_key,
                rejection_reason=rejection_reason
                if status == ImageStatus.INVALID_EXIF
                else None,
            )

            log.info(
                f"Completed (Job: {job_id}): "
                f"ID={image_record.id} | Status={status} | "
                f"EXIF={'Yes' if exif_dict else 'No'} | GPS={'Yes' if location else 'No'}"
            )

            return {
                "image_id": str(image_record.id),
                "status": image_record.status,
                "has_gps": location is not None,
                "is_duplicate": False,
            }

    except Exception as e:
        log.error(f"Failed (Job: {job_id}): {e!s}")
        raise


async def ingest_existing_uploads(
    ctx: dict[Any, Any],
    project_id: str,
    uploaded_by: str,
    batch_id: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Scan a project's user-uploads/ prefix and enqueue processing for untracked files.

    Runs as a background job so the HTTP request returns immediately.

    Concurrency safety:
    - A Redis lock (lock:ingest:{project_id}, 30 min TTL) prevents parallel
      ingest jobs for the same project - from retries or duplicate API calls.
    - Each process_uploaded_image job gets a stable _job_id derived from
      project_id + s3_key, so ARQ silently deduplicates re-enqueues of the
      same object.
    - Downstream MD5 hash check in process_uploaded_image is the final safety
      net against duplicate DB rows.
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting ingest job {job_id} for project {project_id}")

    db_pool = ctx.get("db_pool")
    redis: ArqRedis = ctx.get("redis")
    if not db_pool or not redis:
        raise RuntimeError("Database pool or Redis not initialized in ARQ context")

    # Project-scoped lock: prevents parallel ingest runs (retries, double-clicks).
    # TTL of 30 minutes - well beyond expected scan+enqueue time.
    lock_key = f"lock:ingest:{project_id}"
    acquired = await redis.set(lock_key, job_id, nx=True, ex=1800)
    if not acquired:
        log.warning(
            f"Ingest job {job_id}: another ingest is already running for "
            f"project {project_id}, skipping"
        )
        return {
            "project_id": project_id,
            "batch_id": batch_id,
            "enqueued": 0,
            "skipped": True,
        }

    try:
        from app.s3 import list_objects_from_bucket

        prefix = f"projects/{project_id}/user-uploads/"
        bucket = settings.S3_BUCKET_NAME
        image_extensions = {".jpg", ".jpeg", ".tif", ".tiff", ".png", ".dng"}

        # Get already-tracked S3 keys
        async with db_pool.connection() as db, db.cursor() as cur:
            await cur.execute(
                "SELECT s3_key FROM project_images WHERE project_id = %(pid)s",
                {"pid": project_id},
            )
            existing_keys = {row[0] for row in await cur.fetchall()}

        enqueued = 0
        for obj in list_objects_from_bucket(bucket, prefix):
            if obj.is_dir:
                continue
            key = obj.object_name
            relative_key = key.removeprefix(prefix)
            path_parts = relative_key.split("/")
            filename = key.rsplit("/", 1)[-1]
            filename_lower = filename.lower()
            if any(
                part.lower() == "thumbs" for part in path_parts[:-1]
            ) or filename_lower.startswith(("thumb_", "thumbs_", "thumbs-")):
                continue
            ext = os.path.splitext(filename)[1].lower()
            if ext not in image_extensions:
                continue
            if key in existing_keys:
                continue

            # Stable job ID: hash the S3 key so the identifier stays short/safe
            # while remaining deterministic across retries and duplicate requests.
            stable_child_id = (
                f"ingest-img:{project_id}:"
                f"{hashlib.md5(key.encode('utf-8')).hexdigest()}"
            )
            child_job = await redis.enqueue_job(
                "process_uploaded_image",
                project_id,
                key,
                filename,
                uploaded_by,
                batch_id,
                _queue_name="default_queue",
                _job_id=stable_child_id,
            )
            if child_job is not None:
                enqueued += 1

        log.info(
            f"Ingest job {job_id}: enqueued {enqueued} images for project {project_id}"
        )

        # Second pass: reconcile assigned images whose DB path is still
        # user-uploads (move job lost or partially completed). The upload path
        # has full S3 context, so here we let it prune truly-orphaned rows.
        reconciled = await reconcile_stuck_task_images(
            db_pool,
            redis,
            project_id,
            bucket,
            delete_orphans=True,
            job_id=job_id,
        )

        return {
            "project_id": project_id,
            "batch_id": batch_id,
            "enqueued": enqueued,
            "reconciled": {
                "move_jobs_enqueued": reconciled["move_jobs_enqueued"],
                "db_keys_fixed": reconciled["db_keys_fixed"],
                "orphans_deleted": reconciled["orphans_deleted"],
            },
        }
    finally:
        await redis.delete(lock_key)


async def classify_project_images(
    ctx: dict[Any, Any],
    project_id: str,
    disable_flight_tail_detection: bool = False,
    enforce_gimbal_deviation_rejection: bool = False,
    **_kwargs: Any,
) -> dict:
    """Classify all staged images in a project (across all batches)."""
    job_id = ctx.get("job_id", "unknown")
    log.info(
        f"Starting project classification job {job_id} for project {project_id} "
        f"(flight tail detection {'disabled' if disable_flight_tail_detection else 'enabled'}, "
        f"gimbal deviation rejection "
        f"{'enforced' if enforce_gimbal_deviation_rejection else 'shadow-mode'})"
    )

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        result = await ImageClassifier.classify_project(
            db_pool,
            UUID(project_id),
        )

        # Post-classification: detect tails only for images classified in THIS run.
        # Scoping to processed image IDs prevents retroactively rejecting imagery
        # from older batches that was already accepted.
        classified_image_ids = [
            img["image_id"]
            for img in result.get("images", [])
            if img.get("status") == ImageStatus.ASSIGNED
        ]
        if classified_image_ids:
            try:
                async with db_pool.connection() as conn:
                    async with conn.cursor() as cur:
                        # Include images with NULL batch_id - they are grouped
                        # under a synthetic NULL key so the passes still run.
                        await cur.execute(
                            """
                            SELECT DISTINCT batch_id, task_id
                            FROM project_images
                            WHERE project_id = %(project_id)s
                              AND id = ANY(%(image_ids)s)
                              AND status = 'assigned'
                              AND task_id IS NOT NULL
                            """,
                            {
                                "project_id": project_id,
                                "image_ids": classified_image_ids,
                            },
                        )
                        rows = await cur.fetchall()

                    # row[0] (batch_id) may be None for images uploaded without a batch.
                    pairs = [(row[0], row[1]) for row in rows if row[1] is not None]

                    # Stationary/hover removal runs first so redundant photos are
                    # excluded from the flight-tail baseline
                    if pairs:
                        log.info(
                            f"Inspecting project {project_id} for stationary photos: "
                            f"{len(pairs)} (batch, task) pairs"
                        )
                        for batch_id, task_id in pairs:
                            await mark_and_remove_stationary_imagery(
                                conn,
                                UUID(project_id),
                                UUID(str(batch_id)) if batch_id else None,
                                UUID(str(task_id)),
                            )

                    # Off-axis frames go before tail detection so sweeps do not
                    # pollute the tail baseline heading.
                    if pairs:
                        log.info(
                            f"Inspecting project {project_id} for off-axis gimbal "
                            f"frames: {len(pairs)} (batch, task) pairs"
                        )
                        for batch_id, task_id in pairs:
                            await mark_and_remove_off_axis_imagery(
                                conn,
                                UUID(project_id),
                                UUID(str(batch_id)) if batch_id else None,
                                UUID(str(task_id)),
                                image_ids=classified_image_ids,
                                enforce=enforce_gimbal_deviation_rejection,
                            )

                    if pairs and not disable_flight_tail_detection:
                        log.info(
                            f"Inspecting project {project_id} for flightplan tails: "
                            f"{len(pairs)} (batch, task) pairs"
                        )
                        for batch_id, task_id in pairs:
                            await mark_and_remove_flight_tail_imagery(
                                conn,
                                UUID(project_id),
                                UUID(str(batch_id)) if batch_id else None,
                                UUID(str(task_id)),
                            )

                    if pairs:
                        await conn.commit()
            except Exception as post_err:
                log.error(
                    f"Post-classification passes failed for project {project_id}: "
                    f"{post_err}",
                    exc_info=True,
                )

        log.info(
            f"Project classification complete: "
            f"Total={result['total']}, Assigned={result['assigned']}, "
            f"Rejected={result['rejected']}, Unmatched={result['unmatched']}"
        )

        return result

    except Exception as e:
        log.error(f"Project classification failed: {e!s}")
        raise


class MoveEnqueue(str, Enum):
    """Outcome of trying to enqueue a task move."""

    ENQUEUED = "enqueued"  # a new job was queued
    ALREADY_RUNNING = "already_running"  # a move is already queued/running
    FAILED = "failed"  # nothing could be queued


class MoveEnqueueResult(NamedTuple):
    status: MoveEnqueue
    job_id: str | None


# Best-effort per-task lock. It coalesces overlapping moves AND acts as the
# liveness signal for recovery: a crashed worker leaves ARQ's in_progress marker
# behind for up to job_timeout (24h), so we treat in_progress WITHOUT this lock
# as a dead job. The TTL is short so a crash is recoverable within minutes; the
# move is idempotent, so a lapsed lease during a long move at worst causes safe
# redundant work. Release is owner-checked, so a lapsed lease never deletes a
# successor's lock.
_MOVE_LOCK_TTL_MS = 300_000  # 5 minutes
_LOCK_RELEASE_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] "
    "then return redis.call('del', KEYS[1]) else return 0 end"
)


async def move_task_images_for_processing(
    ctx: dict[Any, Any],
    project_id: str,
    task_id: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Move a task's assigned imagery from user-uploads into its ODM folder.

    De-assigned (rejected) imagery is pruned out later by the fail-closed guard
    in the processing jobs, so this stage only moves images in.
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(
        f"Starting move_task_images_for_processing (Job ID: {job_id}): "
        f"project={project_id}, task={task_id}"
    )

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    redis: ArqRedis | None = ctx.get("redis")
    lock_key = f"lock:move-task:{task_id}"
    lock_token = uuid.uuid4().hex
    if redis is not None and not await redis.set(
        lock_key, lock_token, nx=True, px=_MOVE_LOCK_TTL_MS
    ):
        log.info(f"Move for task {task_id} already running; skipping (Job {job_id})")
        return {"project_id": project_id, "task_id": task_id, "skipped": True}

    try:
        async with db_pool.connection() as conn:
            result = await ImageClassifier.move_task_images_to_folder(
                conn, UUID(project_id), UUID(task_id)
            )
            failed = result.get("failed_count", 0)
            moved = result.get("moved_count", 0)

            if failed > 0:
                failed_names = result.get("failed_filenames", [])
                # Moved images are already committed individually; report failures.
                raise RuntimeError(
                    f"Failed to move {failed} of {moved + failed} image(s) "
                    f"to task folder: {', '.join(failed_names[:5])}"
                    + (
                        f" (and {len(failed_names) - 5} more)"
                        if len(failed_names) > 5
                        else ""
                    )
                )

            log.info(
                f"Completed move_task_images_for_processing (Job ID: {job_id}): "
                f"moved={moved}"
            )
            return {
                "project_id": project_id,
                "task_id": task_id,
                "moved_count": moved,
                "failed_count": 0,
            }
    except Exception as e:
        failure_message = (
            "Imagery transfer to the task folder failed. "
            "Please retry by marking this task as fully flown again. "
            f"Details: {e!s}"
        )
        conn = None
        try:
            async with db_pool.connection() as conn:
                transition = await task_logic.update_task_state_system(
                    conn,
                    UUID(project_id),
                    UUID(task_id),
                    failure_message,
                    State.READY_FOR_PROCESSING,
                    State.IMAGE_PROCESSING_FAILED,
                    timestamp(),
                )
                if transition is not None:
                    await conn.commit()
        except Exception as state_error:
            if conn is not None:
                await conn.rollback()
            log.error(
                f"Failed to persist transfer failure state for task {task_id}: "
                f"{state_error}"
            )

        log.error(f"Failed move_task_images_for_processing (Job ID: {job_id}): {e!s}")
        raise
    finally:
        if redis is not None:
            # Owner-checked release; a release failure must not mask the result.
            try:
                await redis.eval(_LOCK_RELEASE_LUA, 1, lock_key, lock_token)
            except Exception as release_err:
                log.warning(
                    f"Failed to release move lock for task {task_id}: {release_err}"
                )


async def _enqueue_task_move(
    redis: ArqRedis, project_id: str, task_id: str
) -> MoveEnqueueResult:
    """Enqueue the staging→task move for a task. Shared by every caller.

    The stable job id coalesces duplicate requests. If arq refuses it (queued,
    running, or a cached result), we only treat it as live when the job is
    queued/deferred or genuinely in_progress (task lock still held); a stale
    in_progress marker from a crashed worker, or a cached result, falls back to
    a fresh id so a stalled transfer can always be recovered. The worker holds a
    per-task lock, so a redundant enqueue runs at most once.
    """
    stable_move_id = f"move-task-images:{task_id}"
    move_job = await redis.enqueue_job(
        "move_task_images_for_processing",
        project_id,
        task_id,
        _queue_name="default_queue",
        _job_id=stable_move_id,
    )
    if move_job is not None:
        return MoveEnqueueResult(MoveEnqueue.ENQUEUED, move_job.job_id)

    # arq 0.26 has no ArqRedis.job(); build the Job handle directly to read status.
    status = await Job(stable_move_id, redis, _queue_name="default_queue").status()
    if status in {JobStatus.queued, JobStatus.deferred}:
        return MoveEnqueueResult(MoveEnqueue.ALREADY_RUNNING, stable_move_id)
    # in_progress is only trustworthy while a worker still holds the task lock;
    # a stale marker from a crashed worker (lingers ~24h) or a cached result
    # falls through to a fresh recovery id.
    if status == JobStatus.in_progress and (
        await redis.get(f"lock:move-task:{task_id}") is not None
    ):
        return MoveEnqueueResult(MoveEnqueue.ALREADY_RUNNING, stable_move_id)

    retry_job_id = f"{stable_move_id}:{uuid.uuid4().hex}"
    move_job = await redis.enqueue_job(
        "move_task_images_for_processing",
        project_id,
        task_id,
        _queue_name="default_queue",
        _job_id=retry_job_id,
    )
    if move_job is not None:
        return MoveEnqueueResult(MoveEnqueue.ENQUEUED, move_job.job_id)
    return MoveEnqueueResult(MoveEnqueue.FAILED, None)


async def reconcile_stuck_task_images(
    db_pool: Any,
    redis: ArqRedis,
    project_id: str,
    bucket: str,
    *,
    delete_orphans: bool,
    job_id: str = "unknown",
) -> dict[str, int]:
    """Reconcile assigned images whose S3 key is still in user-uploads.

    A lost or interrupted transfer leaves assigned images pointing at staging,
    which blocks processing. Per stuck image:

      A) file still in user-uploads → move unfinished → re-enqueue the move
      B) file already at the task dest → move ran, DB not updated → fix the row
      C) file missing everywhere → phantom record

    ``delete_orphans`` gates Case C: the ingest path (fresh off an S3 scan)
    prunes phantoms; the nightly backstop passes False and only logs them, so a
    scheduled sweep can never destroy data.

    Returns counts: stuck, move_jobs_enqueued, db_keys_fixed, orphans_deleted,
    orphans_flagged.
    """
    async with db_pool.connection() as db:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, s3_key, task_id, filename, thumbnail_url
                FROM project_images
                WHERE project_id = %(pid)s
                  AND status = 'assigned'
                  AND s3_key LIKE '%%user-uploads%%'
                """,
                {"pid": project_id},
            )
            stuck_images = await cur.fetchall()

    if not stuck_images:
        return {
            "stuck": 0,
            "move_jobs_enqueued": 0,
            "db_keys_fixed": 0,
            "orphans_deleted": 0,
            "orphans_flagged": 0,
        }

    tasks_needing_move: set[str] = set()
    # Carry (image_id, task_id, original_s3_key, ...) so every write can be a
    # compare-and-set against the exact snapshot we classified.
    db_fixes: list[tuple[str, str, str, str, str | None]] = []
    orphans: list[tuple[str, str, str]] = []

    for img in stuck_images:
        image_id = str(img["id"])
        s3_key = img["s3_key"]
        task_id_str = str(img["task_id"])
        filename = img["filename"]
        old_thumb = img.get("thumbnail_url")
        image_id_prefix = image_id[:8]
        dest_key = (
            f"projects/{project_id}/{task_id_str}/images/{image_id_prefix}_{filename}"
        )
        dest_thumb_key = (
            f"projects/{project_id}/{task_id_str}/images/thumbs/"
            f"{image_id_prefix}_{filename}"
        )

        # S3 existence checks are blocking, so offload them to keep the worker
        # event loop free (this sweep can touch a large backlog).
        if await run_in_threadpool(s3_object_exists, bucket, s3_key):
            tasks_needing_move.add(task_id_str)  # Case A
        elif await run_in_threadpool(s3_object_exists, bucket, dest_key):
            # Case B: file already moved, just fix the DB row.
            new_thumb: str | None = None
            if old_thumb and "user-uploads" in old_thumb:
                thumb_at_dest = await run_in_threadpool(
                    s3_object_exists, bucket, dest_thumb_key
                )
                new_thumb = dest_thumb_key if thumb_at_dest else None
            db_fixes.append((image_id, task_id_str, s3_key, dest_key, new_thumb))
        else:
            orphans.append((image_id, task_id_str, s3_key))  # Case C

    # Every write is a compare-and-set on the full snapshot (id, project, task,
    # s3_key, assigned) so a concurrent reject/reassign/move always wins.
    cas = (
        "id = %(image_id)s AND project_id = %(project_id)s "
        "AND task_id = %(task_id)s AND s3_key = %(orig_s3_key)s "
        "AND status = 'assigned'"
    )

    db_keys_fixed = 0
    if db_fixes:
        async with db_pool.connection() as db:
            for image_id, task_id_str, orig_s3_key, new_s3_key, new_thumb in db_fixes:
                fields = "SET s3_key = %(new_s3_key)s"
                params: dict[str, Any] = {
                    "new_s3_key": new_s3_key,
                    "image_id": image_id,
                    "project_id": project_id,
                    "task_id": task_id_str,
                    "orig_s3_key": orig_s3_key,
                }
                if new_thumb:
                    fields += ", thumbnail_url = %(new_thumb)s"
                    params["new_thumb"] = new_thumb
                async with db.cursor() as cur:
                    await cur.execute(
                        f"UPDATE project_images {fields} WHERE {cas}", params
                    )
                    db_keys_fixed += cur.rowcount
            await db.commit()
        log.info(
            f"Reconcile ({job_id}) project {project_id}: fixed s3_key for "
            f"{db_keys_fixed}/{len(db_fixes)} images whose S3 move completed "
            f"but DB was not updated"
        )

    orphans_deleted = 0
    orphans_flagged = 0
    if orphans:
        if delete_orphans:
            async with db_pool.connection() as db:
                for image_id, task_id_str, orig_s3_key in orphans:
                    async with db.cursor() as cur:
                        await cur.execute(
                            f"DELETE FROM project_images WHERE {cas}",
                            {
                                "image_id": image_id,
                                "project_id": project_id,
                                "task_id": task_id_str,
                                "orig_s3_key": orig_s3_key,
                            },
                        )
                        orphans_deleted += cur.rowcount
                await db.commit()
            log.info(
                f"Reconcile ({job_id}) project {project_id}: deleted "
                f"{orphans_deleted}/{len(orphans)} orphaned image records "
                f"(assigned but S3 file not found)"
            )
        else:
            orphans_flagged = len(orphans)
            orphan_ids = [o[0] for o in orphans]
            log.warning(
                f"Reconcile ({job_id}) project {project_id}: {orphans_flagged} "
                f"assigned image(s) point at user-uploads but the S3 file is "
                f"missing from both staging and the task folder - NOT deleting "
                f"(backstop sweep). Image ids: {', '.join(orphan_ids[:20])}"
                + (" (and more)" if len(orphan_ids) > 20 else "")
            )

    move_enqueued = 0
    for task_id_str in tasks_needing_move:
        result = await _enqueue_task_move(redis, project_id, task_id_str)
        if result.status == MoveEnqueue.ENQUEUED:
            move_enqueued += 1

    if tasks_needing_move:
        log.info(
            f"Reconcile ({job_id}) project {project_id}: re-enqueued move jobs "
            f"for {move_enqueued} task(s) "
            f"({len(tasks_needing_move) - move_enqueued} already queued or running)"
        )

    return {
        "stuck": len(stuck_images),
        "move_jobs_enqueued": move_enqueued,
        "db_keys_fixed": db_keys_fixed,
        "orphans_deleted": orphans_deleted,
        "orphans_flagged": orphans_flagged,
    }


async def reconcile_pending_transfers(
    ctx: dict[Any, Any],
    **_kwargs: Any,
) -> dict[str, Any]:
    """Nightly backstop for transfers stalled mid-move by a deploy/restart/OOM.

    Such a stall strands assigned images in user-uploads, silently blocking
    processing until someone re-uploads. Sweeps every affected project, resuming
    the move (Case A) and fixing stale rows (Case B); never deletes phantom rows
    (Case C), only logs them.
    """
    job_id = ctx.get("job_id", "unknown")
    db_pool = ctx.get("db_pool")
    redis: ArqRedis = ctx.get("redis")
    if not db_pool or not redis:
        log.warning(
            f"reconcile_pending_transfers ({job_id}): no db_pool/redis; skipping"
        )
        return {"projects": 0}

    bucket = settings.S3_BUCKET_NAME
    async with db_pool.connection() as db, db.cursor() as cur:
        await cur.execute(
            """
            SELECT DISTINCT project_id
            FROM project_images
            WHERE status = 'assigned'
              AND s3_key LIKE '%%user-uploads%%'
            """
        )
        project_ids = [str(row[0]) for row in await cur.fetchall()]

    totals = {
        "projects": len(project_ids),
        "stuck": 0,
        "move_jobs_enqueued": 0,
        "db_keys_fixed": 0,
        "orphans_flagged": 0,
    }
    for pid in project_ids:
        try:
            res = await reconcile_stuck_task_images(
                db_pool, redis, pid, bucket, delete_orphans=False, job_id=job_id
            )
            totals["stuck"] += res["stuck"]
            totals["move_jobs_enqueued"] += res["move_jobs_enqueued"]
            totals["db_keys_fixed"] += res["db_keys_fixed"]
            totals["orphans_flagged"] += res["orphans_flagged"]
        except Exception as e:
            log.error(
                f"reconcile_pending_transfers ({job_id}): project {pid} failed: {e}"
            )

    log.info(
        f"reconcile_pending_transfers ({job_id}): swept {totals['projects']} "
        f"project(s), {totals['stuck']} stuck image(s), "
        f"{totals['move_jobs_enqueued']} move job(s) re-enqueued, "
        f"{totals['db_keys_fixed']} DB key(s) fixed, "
        f"{totals['orphans_flagged']} phantom row(s) flagged"
    )
    return totals


def _retry_on_partial_cleanup(result: dict[str, Any]) -> None:
    """Rerun the job (up to max_tries) for images whose storage delete failed.

    Only arq.Retry reschedules a job; any other exception fails it outright.
    """
    if result.get("failed_count"):
        log.warning(
            f"Retrying cleanup: {result['failed_count']} image(s) kept after "
            f"storage delete failure"
        )
        raise Retry(defer=60)


async def delete_batch_images(
    ctx: dict[Any, Any],
    project_id: str,
    batch_id: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Background task to delete all images in a batch from both database and S3.

    Args:
        ctx: ARQ context
        project_id: UUID of the project
        batch_id: UUID of the batch to delete

    Returns:
        dict: Deletion result with counts
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting delete_batch_images (Job ID: {job_id}): batch={batch_id}")

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        async with db_pool.connection() as conn:
            result = await ImageClassifier.delete_batch(
                conn, UUID(batch_id), UUID(project_id)
            )
    except Exception as e:
        log.error(f"Failed to delete batch (Job: {job_id}): {e!s}")
        raise

    log.info(
        f"Batch deletion complete: {result['deleted_count']} images, "
        f"{result['deleted_s3_count']} S3 objects deleted"
    )
    _retry_on_partial_cleanup(result)

    return {
        "message": result["message"],
        "batch_id": batch_id,
        "deleted_images": result["deleted_count"],
        "deleted_s3_objects": result["deleted_s3_count"],
    }


async def delete_invalid_images(
    ctx: dict[Any, Any],
    project_id: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Background task to delete a project's invalid/unmatched images from DB and S3."""
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting delete_invalid_images (Job ID: {job_id}): project={project_id}")

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        async with db_pool.connection() as conn:
            result = await ImageClassifier.delete_invalid_images(conn, UUID(project_id))
    except Exception as e:
        log.error(f"Failed to delete invalid images (Job: {job_id}): {e!s}")
        raise

    log.info(
        f"Invalid imagery cleanup complete: {result['deleted_count']} images, "
        f"{result['deleted_s3_count']} S3 objects deleted"
    )
    _retry_on_partial_cleanup(result)

    return result


async def process_project_task_metrics(
    ctx: dict[Any, Any], project_id: str, **_kwargs: Any
) -> dict[str, Any]:
    """Process project task metrics in the ARQ worker."""
    job_id = ctx.get("job_id", "unknown")
    log.info(
        f"Starting process_project_task_metrics (Job ID: {job_id}): project={project_id}"
    )

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        async with db_pool.connection() as db:
            project = await project_schemas.DbProject.one(db, UUID(project_id))

            async with db.cursor() as cur:
                await cur.execute(
                    """
                    SELECT id, project_id, ST_AsBinary(outline), project_task_index
                    FROM tasks
                    WHERE project_id = %s
                    ORDER BY project_task_index
                    """,
                    (project.id,),
                )
                tasks_data = await cur.fetchall()

            await process_task_metrics(db, tasks_data, project)

            log.info(
                f"Completed process_project_task_metrics (Job ID: {job_id}): "
                f"project={project_id}, tasks={len(tasks_data)}"
            )

            return {
                "message": "Task metrics processed",
                "project_id": project_id,
                "task_count": len(tasks_data),
            }

    except Exception as e:
        log.error(f"Failed process_project_task_metrics (Job ID: {job_id}): {e!s}")
        raise


def _zip_plugin_dir() -> str | None:
    """Zip the QField plugin directory and return base64-encoded bytes.

    Uses the bundled plugin directory at ``/project/src/qfield-plugin``.
    Returns None if the directory does not exist or is empty.
    """
    plugin_dir = Path("/project/src/qfield-plugin")

    if not plugin_dir.is_dir():
        log.warning("QField plugin directory not found; project will have no plugin")
        return None

    buf = io.BytesIO()
    file_count = 0
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(plugin_dir.rglob("*")):
            if file_path.is_file():
                arc_name = str(file_path.relative_to(plugin_dir))
                zf.write(file_path, arc_name)
                file_count += 1

    if file_count == 0:
        log.warning("QField plugin directory is empty: %s", plugin_dir)
        return None

    log.info("Zipped %d plugin files from %s", file_count, plugin_dir)
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def generate_qfield_project(
    ctx: dict[Any, Any],
    project_id: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Generate a QField project via the QGIS container and upload to S3.

    Fetches task geometries and project info from the DB, sends them to
    the QGIS container's /drone endpoint, and uploads the resulting zip
    to the publicuploads/ prefix in S3.
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(
        f"Starting generate_qfield_project (Job ID: {job_id}): project={project_id}"
    )

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        async with db_pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                # Fetch project info
                await cur.execute(
                    """
                    SELECT id, name, ST_AsGeoJSON(outline)::jsonb AS outline,
                           dem_url, gsd_cm_px, front_overlap, side_overlap,
                           altitude_from_ground
                    FROM projects WHERE id = %s
                    """,
                    (project_id,),
                )
                project = await cur.fetchone()
                if not project:
                    raise RuntimeError(f"Project {project_id} not found")

                # Fetch tasks as GeoJSON FeatureCollection, including the
                # latest task state so QField can render task colours that
                # match the web UI snapshot at export time.  Tasks with no
                # event rows fall back to UNLOCKED, matching Task.all().
                await cur.execute(
                    """
                    WITH latest_event AS (
                        SELECT DISTINCT ON (task_id) task_id, state
                        FROM task_events
                        WHERE project_id = %s
                        ORDER BY task_id, created_at DESC
                    )
                    SELECT json_build_object(
                        'type', 'FeatureCollection',
                        'features', COALESCE(json_agg(
                            json_build_object(
                                'type', 'Feature',
                                'geometry', ST_AsGeoJSON(t.outline)::json,
                                'properties', json_build_object(
                                    'project_task_id', t.project_task_index,
                                    'status', COALESCE(le.state::text, 'UNLOCKED')
                                )
                            )
                        ), '[]'::json)
                    ) AS geojson
                    FROM tasks t
                    LEFT JOIN latest_event le ON le.task_id = t.id
                    WHERE t.project_id = %s
                    """,
                    (project_id, project_id),
                )
                row = await cur.fetchone()
                tasks_geojson = row["geojson"]

                # Compute extent from project outline
                await cur.execute(
                    """
                    SELECT ST_XMin(outline), ST_YMin(outline),
                           ST_XMax(outline), ST_YMax(outline)
                    FROM projects WHERE id = %s
                    """,
                    (project_id,),
                )
                ext = await cur.fetchone()
                extent_str = f"{ext['st_xmin']},{ext['st_ymin']},{ext['st_xmax']},{ext['st_ymax']}"

        # Build request payload for the QGIS container
        project_name = project["name"] or f"project-{project_id[:8]}"
        # Sanitize project name for filesystem use
        safe_name = "".join(
            c if c.isalnum() or c in " -_" else "_" for c in project_name
        ).strip()
        if not safe_name:
            safe_name = f"project-{project_id[:8]}"

        flight_params = {}
        if project.get("gsd_cm_px") is not None:
            flight_params["gsd"] = project["gsd_cm_px"]
        if project.get("altitude_from_ground") is not None:
            flight_params["agl"] = project["altitude_from_ground"]
        if project.get("front_overlap") is not None:
            flight_params["forward_overlap"] = project["front_overlap"]
        if project.get("side_overlap") is not None:
            flight_params["side_overlap"] = project["side_overlap"]

        payload = {
            "project_id": project_id,
            "project_name": safe_name,
            "tasks_geojson": tasks_geojson,
            "extent": extent_str,
            "flight_params": flight_params,
            "dem_url": None,
            "plugin_zip": None,
        }

        # If project has a DEM, generate an internal presigned URL for the QGIS container
        dem_url = project.get("dem_url")
        if dem_url:
            # dem_url is stored as an S3 key like "projects/{id}/dem.tif"
            if not dem_url.startswith("http"):
                dem_url = generate_presigned_get_url(
                    settings.S3_BUCKET_NAME, dem_url, expires_hours=2, internal=True
                )
            payload["dem_url"] = dem_url

        # Bundle the QField plugin directory into a zip and base64-encode it
        plugin_b64 = _zip_plugin_dir()
        if plugin_b64:
            payload["plugin_zip"] = plugin_b64

        # Call QGIS container
        qgis_url = f"{settings.QGIS_URL}/drone"
        log.info(f"Calling QGIS container at {qgis_url} for project {project_id}")

        async with (
            aiohttp.ClientSession() as session,
            session.post(
                qgis_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp,
        ):
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(f"QGIS container returned {resp.status}: {body}")
            zip_bytes = await resp.read()

        log.info(f"Received {len(zip_bytes)} bytes from QGIS container")

        # Upload to S3. The S3 key is deterministic per project, so regenerates
        # overwrite in place - CloudFront must revalidate instead of serving a
        # stale edge copy when the user re-exports.
        s3_key = public_qfield_zip_key(project_id)
        add_obj_to_bucket(
            settings.S3_BUCKET_NAME,
            io.BytesIO(zip_bytes),
            s3_key,
            content_type="application/zip",
            metadata={"Cache-Control": "no-cache"},
        )
        log.info(f"Uploaded QField project to s3://{settings.S3_BUCKET_NAME}/{s3_key}")

        return {
            "status": "success",
            "message": "QField project generated",
            "project_id": project_id,
            "s3_key": s3_key,
        }

    except Exception as e:
        log.error(f"Failed to generate QField project (Job: {job_id}): {e!s}")
        raise


async def process_imported_odm_assets(
    ctx: dict[Any, Any],
    project_id: str,
    task_id: str,
    s3_zip_key: str,
    user_id: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Process an ODM zip uploaded by the user (import flow).

    Downloads the zip from S3, validates it contains an orthophoto,
    extracts individual files to S3 under ``odm/``, reprojects the
    orthophoto, and cleans up the temporary upload.
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting process_imported_odm_assets (Job ID: {job_id}): task={task_id}")

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    temp_dir = tempfile.mkdtemp()
    try:
        # Download the uploaded zip from S3
        zip_path = os.path.join(temp_dir, "odm_import.zip")
        result = get_file_from_bucket(settings.S3_BUCKET_NAME, s3_zip_key, zip_path)
        if result is False:
            raise FileNotFoundError(f"Could not download ODM zip from {s3_zip_key}")

        # Validate the zip contains an orthophoto
        with zipfile.ZipFile(zip_path, "r") as zf:
            if "odm_orthophoto/odm_orthophoto.tif" not in zf.namelist():
                raise ValueError(
                    "Invalid ODM zip: missing odm_orthophoto/odm_orthophoto.tif"
                )

        pid = UUID(project_id)
        tid = UUID(task_id)

        # Transition task state to IMAGE_PROCESSING_STARTED
        async with db_pool.connection() as conn:
            result = await task_logic.update_task_state_system(
                conn,
                pid,
                tid,
                "ODM import processing started",
                State.READY_FOR_PROCESSING,
                State.IMAGE_PROCESSING_STARTED,
                timestamp(),
            )
            if result is None:
                result = await task_logic.update_task_state_system(
                    conn,
                    pid,
                    tid,
                    "ODM import retry",
                    State.IMAGE_PROCESSING_FAILED,
                    State.IMAGE_PROCESSING_STARTED,
                    timestamp(),
                )
            if result is None:
                raise RuntimeError(
                    "Cannot start import: task is not in a valid state "
                    "(expected READY_FOR_PROCESSING or IMAGE_PROCESSING_FAILED)"
                )
            await conn.commit()

        # Extract and upload all ODM assets
        extract_and_upload_odm_assets(zip_path, temp_dir, pid, tid)

        # Delete the temporary uploaded zip from S3
        try:
            client = s3_client()
            client.remove_object(settings.S3_BUCKET_NAME, s3_zip_key)
            log.info(f"Deleted temporary import zip from S3: {s3_zip_key}")
        except Exception as e:
            log.warning(f"Failed to delete import zip {s3_zip_key}: {e}")

        # Transition task state to IMAGE_PROCESSING_FINISHED
        async with db_pool.connection() as conn:
            await task_logic.update_task_state_system(
                conn,
                pid,
                tid,
                "ODM import completed",
                State.IMAGE_PROCESSING_STARTED,
                State.IMAGE_PROCESSING_FINISHED,
                timestamp(),
            )

            assets_prefix = f"projects/{project_id}/{task_id}/odm/"
            await project_logic.update_task_field(
                conn, pid, tid, "assets_url", assets_prefix
            )
            await conn.commit()

        log.info(f"ODM import complete for task {task_id}")
        return {
            "message": "ODM import completed",
            "project_id": project_id,
            "task_id": task_id,
        }

    except Exception as e:
        log.error(f"ODM import failed (Job: {job_id}): {e}")

        # Clean up the temporary zip from S3 on failure
        try:
            client = s3_client()
            client.remove_object(settings.S3_BUCKET_NAME, s3_zip_key)
            log.info(f"Cleaned up import zip from S3 after failure: {s3_zip_key}")
        except Exception as cleanup_err:
            log.warning(f"Failed to clean up import zip {s3_zip_key}: {cleanup_err}")

        # Clean up any partially-uploaded ODM assets
        try:
            partial_prefix = f"projects/{project_id}/{task_id}/odm/"
            delete_objects_by_prefix(settings.S3_BUCKET_NAME, partial_prefix)
            log.info(f"Cleaned up partial ODM assets for task {task_id}")
        except Exception as cleanup_err:
            log.warning(f"Failed to clean up partial ODM assets: {cleanup_err}")

        # Try to mark task as failed - attempt from both possible
        # pre-failure states so early failures (before the state
        # transition to IMAGE_PROCESSING_STARTED) are also recorded.
        try:
            async with db_pool.connection() as conn:
                result = await task_logic.update_task_state_system(
                    conn,
                    UUID(project_id),
                    UUID(task_id),
                    f"ODM import failed: {e}",
                    State.IMAGE_PROCESSING_STARTED,
                    State.IMAGE_PROCESSING_FAILED,
                    timestamp(),
                )
                if result is None:
                    # Failure happened before state moved to STARTED
                    await task_logic.update_task_state_system(
                        conn,
                        UUID(project_id),
                        UUID(task_id),
                        f"ODM import failed: {e}",
                        State.READY_FOR_PROCESSING,
                        State.IMAGE_PROCESSING_FAILED,
                        timestamp(),
                    )
                await conn.commit()
        except Exception as state_err:
            log.error(f"Failed to update task state after import failure: {state_err}")
        raise

    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)


def _normalize_s3_endpoint(endpoint: str) -> str:
    """Return a base URL (scheme + host) for the S3-compatible endpoint."""
    endpoint = endpoint.strip().rstrip("/")
    if endpoint.startswith(("http://", "https://")):
        return endpoint
    return f"https://{endpoint}"


async def validate_s3_access(endpoint: str, bucket_name: str, path: str) -> None:
    """Quickly verify the S3 bucket/path is reachable before queuing the full job.

    Raises ValueError with a user-readable message on any problem:
    - 301 PermanentRedirect (wrong region / endpoint style)
    - 403/404 (bucket not found or not public)
    - Empty listing (path prefix has no objects at all)
    """
    base_url = _normalize_s3_endpoint(endpoint)
    list_url = f"{base_url}/{bucket_name}"
    normalized_prefix = path.lstrip("/")
    if normalized_prefix and not normalized_prefix.endswith("/"):
        normalized_prefix = normalized_prefix + "/"

    params: dict[str, str] = {"list-type": "2", "max-keys": "1"}
    if normalized_prefix:
        params["prefix"] = normalized_prefix
    query = urllib.parse.urlencode(params)

    timeout = aiohttp.ClientTimeout(total=10, connect=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"{list_url}?{query}", allow_redirects=False) as resp:
            body = await resp.text()

    if resp.status == 301:
        hint = ""
        try:
            root = ET.fromstring(body)
            ep_el = root.find("Endpoint")
            if ep_el is not None and ep_el.text:
                hint = f" Try using endpoint: {ep_el.text}"
        except Exception:
            pass
        raise ValueError(
            f"Bucket '{bucket_name}' requires a different endpoint (got 301 redirect).{hint}"
        )
    if resp.status == 403:
        raise ValueError(
            f"Bucket '{bucket_name}' is not publicly accessible (403 Forbidden). "
            "Ensure the bucket has public read enabled."
        )
    if resp.status == 404:
        raise ValueError(f"Bucket '{bucket_name}' not found at {base_url} (404).")
    if resp.status != 200:
        raise ValueError(
            f"S3 list returned HTTP {resp.status} for {list_url}: {body[:200]}"
        )

    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    try:
        root = ET.fromstring(body)
        key_count_el = root.find("s3:KeyCount", ns)
        key_count = int(key_count_el.text) if key_count_el is not None else -1
    except Exception:
        key_count = -1

    if key_count == 0:
        path_hint = f" under path '{path}'" if path else ""
        raise ValueError(
            f"No files found in bucket '{bucket_name}'{path_hint}. "
            "Check that the bucket name and path are correct."
        )


async def _list_s3_jpegs(
    session: "aiohttp.ClientSession",
    base_url: str,
    bucket: str,
    prefix: str,
) -> list[str]:
    """List object keys in a public S3-compatible bucket via the v2 list API.

    Filters to .jpg/.jpeg extensions and limits depth to <=3 segments below
    the user-provided prefix. Handles pagination via continuation tokens.
    """
    keys: list[str] = []
    continuation: str | None = None
    list_url = f"{base_url}/{bucket}"
    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}

    normalized_prefix = prefix.lstrip("/")
    if normalized_prefix and not normalized_prefix.endswith("/"):
        normalized_prefix = normalized_prefix + "/"

    while True:
        params: dict[str, str] = {
            "list-type": "2",
            "max-keys": str(_LIST_PAGE_SIZE),
        }
        if normalized_prefix:
            params["prefix"] = normalized_prefix
        if continuation:
            params["continuation-token"] = continuation

        query = urllib.parse.urlencode(params)
        async with session.get(f"{list_url}?{query}") as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(
                    f"S3 list failed ({resp.status}) for {list_url}: {body[:300]}"
                )
            xml_text = await resp.text()

        root = ET.fromstring(xml_text)
        for content in root.findall("s3:Contents", ns):
            key_el = content.find("s3:Key", ns)
            if key_el is None or not key_el.text:
                continue
            key = key_el.text
            ext = os.path.splitext(key)[1].lower()
            if ext not in (".jpg", ".jpeg"):
                continue
            relative = key[len(normalized_prefix) :] if normalized_prefix else key
            if relative.count("/") > _MAX_DEPTH_FROM_PREFIX:
                continue
            keys.append(key)

        truncated_el = root.find("s3:IsTruncated", ns)
        if truncated_el is None or (truncated_el.text or "").lower() != "true":
            break
        next_token_el = root.find("s3:NextContinuationToken", ns)
        if next_token_el is None or not next_token_el.text:
            break
        continuation = next_token_el.text

    return keys


async def _fetch_gps_for_key(
    session: "aiohttp.ClientSession",
    base_url: str,
    bucket: str,
    key: str,
    semaphore: asyncio.Semaphore,
) -> tuple[float, float] | None:
    """Fetch the first ~128KB of an image and extract GPS lat/lon, or None."""
    url = f"{base_url}/{bucket}/{key}"
    async with semaphore:
        try:
            async with session.get(
                url, headers={"Range": f"bytes=0-{_EXIF_HEAD_BYTES - 1}"}
            ) as resp:
                if resp.status not in (200, 206):
                    log.debug(f"EXIF fetch HTTP {resp.status} for {key}")
                    return None
                head_bytes = await resp.read()
        except Exception as e:
            log.debug(f"EXIF fetch failed for {key}: {e}")
            return None

    try:
        _, location, _ = await asyncio.get_running_loop().run_in_executor(
            None, extract_exif_data, head_bytes
        )
    except Exception as e:
        log.debug(f"EXIF parse failed for {key}: {e}")
        return None

    if not location or "lat" not in location or "lon" not in location:
        return None
    lat, lon = float(location["lat"]), float(location["lon"])
    if lat == 0.0 and lon == 0.0:
        # Unset GPS fields (common on DJI drones without a lock) rather than
        # actual null-island coordinates - exclude to avoid a cross-continental AOI.
        return None
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        log.debug(f"GPS out of range for {key}: lat={lat}, lon={lon} - skipping")
        return None
    return (lat, lon)


async def _build_buffered_hull_geojson(
    db,
    coords: list[tuple[float, float]],
) -> dict[str, Any]:
    """Convex hull of (lat, lon) points, buffered by 100m, as a GeoJSON
    FeatureCollection containing a single Polygon feature.

    Computed in PostGIS to match the rest of the codebase: ST_Buffer over a
    geography cast gives an accurate metric buffer that accounts for earth
    curvature (see image_classification.py for the same pattern).
    """
    lons = [lon for (_, lon) in coords]
    lats = [lat for (lat, _) in coords]

    log.debug(
        f"_build_buffered_hull_geojson: running PostGIS query for {len(coords)} coords"
    )
    t0 = time.perf_counter()
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT ST_AsGeoJSON(
                ST_Envelope(
                    ST_Buffer(
                        ST_ConvexHull(
                            ST_Collect(ST_SetSRID(ST_MakePoint(lon, lat), 4326))
                        )::geography,
                        %(buffer_m)s
                    )::geometry
                )
            )
            FROM unnest(%(lons)s::float8[], %(lats)s::float8[]) AS t(lon, lat)
            """,
            {
                "lons": lons,
                "lats": lats,
                "buffer_m": _HULL_BUFFER_METERS,
            },
        )
        row = await cur.fetchone()
    log.debug(
        f"_build_buffered_hull_geojson: PostGIS query took {time.perf_counter() - t0:.2f}s"
    )

    if not row or not row[0]:
        raise RuntimeError("PostGIS failed to build buffered hull from GPS points")

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": json.loads(row[0]),
            }
        ],
    }


async def create_project_from_imagery_exif(
    ctx: dict[Any, Any],
    user_id: str,
    endpoint: str,
    bucket_name: str,
    path: str,
    project_name: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Create a drone-tm project by scanning EXIF GPS from a remote S3 bucket.

    Steps: list .jpg/.jpeg keys (depth <=3) → fetch first ~128KB per file →
    extract GPS via exiftool → buffered convex hull AOI → create project +
    600m task split. Image transfer + ingest are handled separately.
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(
        f"create_project_from_imagery_exif (job {job_id}): "
        f"endpoint={endpoint} bucket={bucket_name} path={path!r} user={user_id}"
    )

    db_pool = ctx.get("db_pool")
    redis: ArqRedis = ctx.get("redis")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    base_url = _normalize_s3_endpoint(endpoint)

    timeout = aiohttp.ClientTimeout(total=None, connect=30, sock_read=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        keys = await _list_s3_jpegs(session, base_url, bucket_name, path)
        log.info(f"Found {len(keys)} JPEG candidates under {bucket_name}/{path!r}")

        if not keys:
            raise RuntimeError(
                f"No .jpg/.jpeg files found at {base_url}/{bucket_name}/{path}"
            )

        semaphore = asyncio.Semaphore(_FETCH_CONCURRENCY)
        results = await asyncio.gather(
            *(
                _fetch_gps_for_key(session, base_url, bucket_name, key, semaphore)
                for key in keys
            )
        )

    key_coords: list[tuple[str, float, float]] = [
        (keys[i], r[0], r[1]) for i, r in enumerate(results) if r is not None
    ]
    gps_ratio = len(key_coords) / len(keys)
    log.info(
        f"GPS extracted from {len(key_coords)}/{len(keys)} ({gps_ratio:.0%}) imagery files"
    )

    # Detect and discard GPS outliers using median ± threshold.
    # Drone surveys never span more than a few dozen km; anything beyond
    # _OUTLIER_THRESHOLD_DEG (~222 km) from the median is a bad reading.
    _OUTLIER_THRESHOLD_DEG = 2.0
    if len(key_coords) >= 3:
        median_lat = statistics.median(lat for _, lat, _ in key_coords)
        median_lon = statistics.median(lon for _, _, lon in key_coords)
        filtered: list[tuple[str, float, float]] = []
        for key, lat, lon in key_coords:
            if (
                abs(lat - median_lat) > _OUTLIER_THRESHOLD_DEG
                or abs(lon - median_lon) > _OUTLIER_THRESHOLD_DEG
            ):
                log.warning(
                    f"GPS outlier discarded: {key} "
                    f"lat={lat:.6f}, lon={lon:.6f} "
                    f"(median lat={median_lat:.6f}, lon={median_lon:.6f})"
                )
            else:
                filtered.append((key, lat, lon))
        if len(filtered) < len(key_coords):
            log.info(
                f"Discarded {len(key_coords) - len(filtered)} GPS outlier(s); "
                f"{len(filtered)} coords remaining"
            )
        key_coords = filtered

    coords: list[tuple[float, float]] = [(lat, lon) for _, lat, lon in key_coords]

    if gps_ratio < _MIN_GPS_RATIO:
        raise RuntimeError(
            f"Only {gps_ratio:.0%} of images had valid GPS data "
            f"(min required: {_MIN_GPS_RATIO:.0%}). Aborting project creation."
        )
    if len(coords) < 3:
        raise RuntimeError(
            f"Need at least 3 images with GPS to build an AOI; found {len(coords)}."
        )

    async with db_pool.connection() as db:
        t_hull = time.perf_counter()
        outline = await _build_buffered_hull_geojson(db, coords)
        log.debug(
            f"create_project_from_imagery_exif (job {job_id}): "
            f"hull built in {time.perf_counter() - t_hull:.2f}s"
        )

        project_in = project_schemas.ProjectIn(
            name=project_name,
            description="This project was created in an automated way by ingesting imagery",
            outline=outline,
            task_split_dimension=_TASK_SPLIT_METERS,
            final_output=["ORTHOPHOTO_2D"],
        )

        t_proj = time.perf_counter()
        project_id = await project_schemas.DbProject.create(db, project_in, user_id)
        log.debug(
            f"create_project_from_imagery_exif (job {job_id}): "
            f"project row inserted ({project_id}) in {time.perf_counter() - t_proj:.2f}s"
        )

        # Split into 600m tasks and persist them, mirroring the
        # /upload-task-boundaries flow used by manual project creation.
        t_split = time.perf_counter()
        split_features = await project_logic.preview_split_by_square(
            outline, _TASK_SPLIT_METERS
        )
        n_tasks = len(split_features.get("features", []))
        log.debug(
            f"create_project_from_imagery_exif (job {job_id}): "
            f"AOI split into {n_tasks} tasks in {time.perf_counter() - t_split:.2f}s"
        )

        t_tasks = time.perf_counter()
        await project_logic.create_tasks_from_geojson(
            db, project_id, split_features, project_in, redis
        )
        log.debug(
            f"create_project_from_imagery_exif (job {job_id}): "
            f"tasks persisted in {time.perf_counter() - t_tasks:.2f}s"
        )

    log.info(
        f"create_project_from_imagery_exif (job {job_id}): "
        f"created project {project_id} from {len(coords)} GPS-tagged images"
    )

    return {
        "project_id": str(project_id),
        "image_count": len(keys),
        "gps_count": len(coords),
    }


async def reconcile_inflight_odm_tasks(ctx: dict[Any, Any]) -> dict[str, Any]:
    """Cron backstop for anything the webhook and page-open paths miss.

    Reconciles only in-flight runs (non-null odm_task_uuid, set on submit and
    cleared on terminal), so it never scans processing history.
    """
    db_pool = ctx.get("db_pool")
    if not db_pool:
        log.warning("reconcile_inflight_odm_tasks: no db_pool; skipping")
        return {"status": "skipped", "reason": "no_db_pool"}

    async with db_pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT p.id
                FROM projects p
                WHERE (
                        p.image_processing_status = %(processing)s
                        AND p.odm_task_uuid IS NOT NULL
                      )
                   OR EXISTS (
                        SELECT 1 FROM tasks t
                        WHERE t.project_id = p.id
                          AND t.odm_task_uuid IS NOT NULL
                      );
                """,
                {"processing": ImageProcessingStatus.PROCESSING.name},
            )
            projects = await cur.fetchall()

    reconciled = 0
    for proj in projects:
        project_id = proj["id"]
        try:
            async with db_pool.connection() as conn:
                await project_logic.reconcile_project_processing(conn, project_id)
            reconciled += 1
        except Exception as e:
            log.warning(
                f"reconcile_inflight_odm_tasks: project {project_id} failed: {e}"
            )

    log.info(
        f"reconcile_inflight_odm_tasks: swept {len(projects)} in-flight project(s)"
    )
    return {"in_flight": len(projects), "reconciled": reconciled}


async def reconcile_odm_by_uuid(
    ctx: dict[Any, Any], odm_task_uuid: str
) -> dict[str, Any]:
    """Reconcile the project owning an ODM task UUID (enqueued by the webhook).

    The webhook is an untrusted trigger: its payload status is ignored and the
    truth is re-derived by reconcile_project_processing.
    """
    db_pool = ctx.get("db_pool")
    if not db_pool or not odm_task_uuid:
        return {"status": "skipped"}

    async with db_pool.connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT p.id AS project_id
                FROM projects p
                WHERE p.odm_task_uuid = %(uuid)s
                UNION
                SELECT t.project_id AS project_id
                FROM tasks t
                WHERE t.odm_task_uuid = %(uuid)s
                LIMIT 1;
                """,
                {"uuid": odm_task_uuid},
            )
            row = await cur.fetchone()

    if not row:
        log.info(f"reconcile_odm_by_uuid: no project for odm uuid {odm_task_uuid}")
        return {"status": "not_found", "odm_task_uuid": odm_task_uuid}

    # Reconcile the whole owning project, not just this task.
    project_id = row["project_id"]
    async with db_pool.connection() as conn:
        summary = await project_logic.reconcile_project_processing(conn, project_id)
    log.info(f"reconcile_odm_by_uuid: reconciled project {project_id}")
    return {"project_id": str(project_id), **summary}


class WorkerSettings:
    """ARQ worker configuration"""

    redis_settings = RedisSettings.from_dsn(settings.DRAGONFLY_DSN)
    functions: ClassVar[list] = [
        sleep_task,
        count_project_tasks,
        process_drone_images,
        process_all_drone_images,
        process_uploaded_image,
        ingest_existing_uploads,
        classify_project_images,
        move_task_images_for_processing,
        delete_batch_images,
        delete_invalid_images,
        process_project_task_metrics,
        download_and_upload_dem,
        generate_qfield_project,
        process_imported_odm_assets,
        create_project_from_imagery_exif,
        generate_orthophoto_cog,
        generate_3d_tiles,
        reconcile_inflight_odm_tasks,
        reconcile_odm_by_uuid,
        reconcile_pending_transfers,
    ]

    # Backstop reconcile every 30 min (webhook and page-open do the fast path).
    # Plus a nightly sweep that resumes imagery transfers stalled by a
    # deploy/restart mid-move (runs at 03:00 UTC, off-peak).
    cron_jobs: ClassVar[list] = [
        cron(reconcile_inflight_odm_tasks, minute={0, 30}, run_at_startup=False),
        cron(reconcile_pending_transfers, hour=3, minute=0, run_at_startup=False),
    ]

    queue_name = "default_queue"
    max_jobs = 20
    job_timeout = 86400  # 24 hours
    max_tries = 3
    health_check_interval = 60
    on_startup = startup
    on_shutdown = shutdown


async def get_redis_pool() -> ArqRedis:
    """Redis connection dependency"""
    try:
        return await create_pool(RedisSettings.from_dsn(settings.DRAGONFLY_DSN))
    except Exception as e:
        log.error(f"Redis connection failed: {e!s}")
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail="Background worker unavailable",
        ) from e
