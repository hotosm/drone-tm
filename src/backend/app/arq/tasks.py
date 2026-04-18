import asyncio
import base64
import hashlib
import io
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from uuid import UUID
import os
import shutil
import tempfile

import aiohttp
from arq import ArqRedis, create_pool
from arq.connections import RedisSettings, log_redis_info
from fastapi import HTTPException
from loguru import logger as log
from PIL import Image
from psycopg.rows import dict_row

from app.config import settings
from app.db.database import get_db_connection_pool
from app.images.image_logic import (
    calculate_file_hash,
    check_duplicate_image,
    create_project_image,
    extract_exif_data,
)
from app.images.image_schemas import ProjectImageCreate, ProjectImageOut
from app.images.flight_tail_removal import mark_and_remove_flight_tail_imagery
from app.models.enums import HTTPStatus, ImageStatus
from app.projects import project_schemas
from app.projects.project_logic import (
    process_all_drone_images,
    process_drone_images,
    process_task_metrics,
)
from app.s3 import (
    add_obj_to_bucket,
    async_get_obj_from_bucket,
    generate_presigned_get_url,
    s3_client,
    get_file_from_bucket,
    delete_objects_by_prefix,
)
from app.images.image_classification import ImageClassifier
from app.jaxa.upload_dem import download_and_upload_dem
from app.images.image_processing import (
    OdmAssetTerminalError,
    OdmAssetTransientError,
    extract_and_upload_odm_assets,
    process_assets_from_odm,
)
from app.models.enums import ImageProcessingStatus, State
from app.tasks import task_logic
from app.utils import timestamp
from app.projects import project_logic


THUMBNAIL_SIZE = (200, 200)


async def startup(ctx: Dict[Any, Any]) -> None:
    """Initialize ARQ resources including database pool"""
    log.info("Starting ARQ worker")

    # Initialize Redis
    ctx["redis"] = await create_pool(RedisSettings.from_dsn(settings.DRAGONFLY_DSN))
    await log_redis_info(ctx["redis"], log.info)

    # Initialize Database pool
    ctx["db_pool"] = await get_db_connection_pool()
    log.info("Database pool initialized")


async def shutdown(ctx: Dict[Any, Any]) -> None:
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
    image_bytes: bytes, size: Tuple[int, int] = THUMBNAIL_SIZE
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


async def sleep_task(ctx: Dict[Any, Any], **_kwargs: Any) -> Dict[str, str]:
    """Test task to sleep for 1 minute"""
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting sleep_task (Job ID: {job_id})")

    try:
        await asyncio.sleep(60)
        log.info(f"Completed sleep_task (Job ID: {job_id})")
        return {"message": "Slept for 1 minute", "job_id": job_id}
    except Exception as e:
        log.error(f"Error in sleep_task (Job ID: {job_id}): {str(e)}")
        raise


async def count_project_tasks(
    ctx: Dict[Any, Any], project_id: str, **_kwargs: Any
) -> Dict[str, Any]:
    """Example task that counts tasks for a given project"""
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting count_project_tasks (Job ID: {job_id})")

    try:
        pool = ctx["db_pool"]
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT COUNT(*) FROM tasks WHERE project_id = %s", (project_id,)
                )
                count = (await cur.fetchone())[0]
                log.info(f"count = {count}")
                return {"count": count}

    except Exception as e:
        log.error(f"Error in count_project_tasks (Job ID: {job_id}): {str(e)}")
        raise


async def _save_image_record(
    db,
    project_id: str,
    filename: str,
    file_key: str,
    file_hash: str,
    uploaded_by: str,
    exif_dict: Optional[dict] = None,
    location: Optional[dict] = None,
    status: ImageStatus = ImageStatus.STAGED,
    batch_id: Optional[str] = None,
    thumbnail_url: Optional[str] = None,
    rejection_reason: Optional[str] = None,
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
    ctx: Dict[Any, Any],
    project_id: str,
    file_key: str,
    filename: str,
    uploaded_by: str,
    batch_id: Optional[str] = None,
    **_kwargs: Any,
) -> Dict[str, Any]:
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
            raise Exception("Database pool not initialized")

        async with db_pool.connection() as db:
            log.info(f"Downloading file from S3: {file_key}")
            file_obj = await async_get_obj_from_bucket(
                settings.S3_BUCKET_NAME, file_key
            )
            file_content = file_obj.read()

            log.info(f"Calculating hash for: {filename}")
            file_hash = calculate_file_hash(file_content)

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
        log.error(f"Failed (Job: {job_id}): {str(e)}")
        raise


async def ingest_existing_uploads(
    ctx: Dict[Any, Any],
    project_id: str,
    uploaded_by: str,
    batch_id: str,
    **_kwargs: Any,
) -> Dict[str, Any]:
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
        async with db_pool.connection() as db:
            async with db.cursor() as cur:
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
            filename = key.rsplit("/", 1)[-1]
            if filename.startswith("thumb_"):
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
        return {"project_id": project_id, "batch_id": batch_id, "enqueued": enqueued}
    finally:
        await redis.delete(lock_key)


async def classify_project_images(
    ctx: Dict[Any, Any],
    project_id: str,
    **_kwargs: Any,
) -> Dict:
    """Classify all staged images in a project (across all batches)."""
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting project classification job {job_id} for project {project_id}")

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
                        # under a synthetic NULL key so tail detection still runs.
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

                    # row[0] (batch_id) may be None for images uploaded without
                    # a batch - still include them for tail detection.
                    pairs = [(row[0], row[1]) for row in rows if row[1] is not None]
                    if pairs:
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
            except Exception as tail_err:
                log.error(
                    f"Flight tail detection failed for project {project_id} "
                    f"(post-classification): {tail_err}",
                    exc_info=True,
                )

        log.info(
            f"Project classification complete: "
            f"Total={result['total']}, Assigned={result['assigned']}, "
            f"Rejected={result['rejected']}, Unmatched={result['unmatched']}"
        )

        return result

    except Exception as e:
        log.error(f"Project classification failed: {str(e)}")
        raise


async def move_task_images_for_processing(
    ctx: Dict[Any, Any],
    project_id: str,
    task_id: str,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Move assigned task images from user-uploads to the task folder."""
    job_id = ctx.get("job_id", "unknown")
    log.info(
        f"Starting move_task_images_for_processing (Job ID: {job_id}): "
        f"project={project_id}, task={task_id}"
    )

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        async with db_pool.connection() as conn:
            result = await ImageClassifier.move_task_images_to_folder(
                conn, UUID(project_id), UUID(task_id)
            )
            failed = result.get("failed_count", 0)
            moved = result.get("moved_count", 0)

            if failed > 0:
                failed_names = result.get("failed_filenames", [])
                # Images that moved successfully are already committed
                # individually, so we only report the failures here.
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
            f"Details: {str(e)}"
        )
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
            log.error(
                f"Failed to persist transfer failure state for task {task_id}: "
                f"{state_error}"
            )

        log.error(
            f"Failed move_task_images_for_processing (Job ID: {job_id}): {str(e)}"
        )
        raise


async def delete_batch_images(
    ctx: Dict[Any, Any],
    project_id: str,
    batch_id: str,
    **_kwargs: Any,
) -> Dict[str, Any]:
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

            log.info(
                f"Batch deletion complete: {result['deleted_count']} images, "
                f"{result['deleted_s3_count']} S3 objects deleted"
            )

            return {
                "message": result["message"],
                "batch_id": batch_id,
                "deleted_images": result["deleted_count"],
                "deleted_s3_objects": result["deleted_s3_count"],
            }

    except Exception as e:
        log.error(f"Failed to delete batch (Job: {job_id}): {str(e)}")
        raise


async def process_project_task_metrics(
    ctx: Dict[Any, Any], project_id: str, **_kwargs: Any
) -> Dict[str, Any]:
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
        log.error(f"Failed process_project_task_metrics (Job ID: {job_id}): {str(e)}")
        raise


def _zip_plugin_dir() -> Optional[str]:
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
    ctx: Dict[Any, Any],
    project_id: str,
    **_kwargs: Any,
) -> Dict[str, Any]:
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
                    "SELECT id, name, ST_AsGeoJSON(outline)::jsonb AS outline, dem_url FROM projects WHERE id = %s",
                    (project_id,),
                )
                project = await cur.fetchone()
                if not project:
                    raise RuntimeError(f"Project {project_id} not found")

                # Fetch tasks as GeoJSON FeatureCollection
                await cur.execute(
                    """
                    SELECT json_build_object(
                        'type', 'FeatureCollection',
                        'features', COALESCE(json_agg(
                            json_build_object(
                                'type', 'Feature',
                                'geometry', ST_AsGeoJSON(outline)::json,
                                'properties', json_build_object(
                                    'project_task_id', project_task_index
                                )
                            )
                        ), '[]'::json)
                    ) AS geojson
                    FROM tasks
                    WHERE project_id = %s
                    """,
                    (project_id,),
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

        payload = {
            "project_id": project_id,
            "project_name": safe_name,
            "tasks_geojson": tasks_geojson,
            "extent": extent_str,
            "flight_params": {},
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

        async with aiohttp.ClientSession() as session:
            async with session.post(
                qgis_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(f"QGIS container returned {resp.status}: {body}")
                zip_bytes = await resp.read()

        log.info(f"Received {len(zip_bytes)} bytes from QGIS container")

        # Upload to S3
        s3_key = f"publicuploads/qfield/{project_id}.zip"
        add_obj_to_bucket(
            settings.S3_BUCKET_NAME,
            io.BytesIO(zip_bytes),
            s3_key,
            content_type="application/zip",
        )
        log.info(f"Uploaded QField project to s3://{settings.S3_BUCKET_NAME}/{s3_key}")

        return {
            "status": "success",
            "message": "QField project generated",
            "project_id": project_id,
            "s3_key": s3_key,
        }

    except Exception as e:
        log.error(f"Failed to generate QField project (Job: {job_id}): {str(e)}")
        raise


async def process_imported_odm_assets(
    ctx: Dict[Any, Any],
    project_id: str,
    task_id: str,
    s3_zip_key: str,
    user_id: str,
    **_kwargs: Any,
) -> Dict[str, Any]:
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


async def _persist_odm_failure(
    ctx: Dict[Any, Any],
    project_uuid: UUID,
    task_uuid: Optional[UUID],
    state: Optional[State],
    error_message: str,
) -> None:
    """Persist failure state for either task-level or project-level ODM processing."""
    try:
        db_pool = ctx.get("db_pool")
        if not db_pool:
            return
        async with db_pool.connection() as conn:
            if task_uuid and state:
                await task_logic.update_task_state_system(
                    db=conn,
                    project_id=project_uuid,
                    task_id=task_uuid,
                    comment=f"Image processing failed: {error_message}",
                    initial_state=state,
                    final_state=State.IMAGE_PROCESSING_FAILED,
                    updated_at=timestamp(),
                )
            elif task_uuid and not state:
                log.warning(
                    f"Cannot persist task-level failure for {task_uuid} "
                    "(no initial state provided)",
                )
            else:
                # Project-level processing: mark the project as FAILED.
                await project_logic.update_processing_status(
                    conn, project_uuid, ImageProcessingStatus.FAILED
                )
            await conn.commit()
    except Exception as state_err:
        target = task_uuid or project_uuid
        log.error(f"Failed to persist ODM failure state for {target}: {state_err}")


async def process_odm_webhook_assets(
    ctx: Dict[Any, Any],
    node_odm_url: str,
    dtm_project_id: str,
    odm_task_id: str,
    state_name: Optional[str] = None,
    message: Optional[str] = None,
    dtm_task_id: Optional[str] = None,
    odm_status_code: Optional[int] = None,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """ARQ wrapper for process_assets_from_odm (webhook flow).

    Offloads the heavy zip download, extraction, and GDAL reprojection
    from the API server to the worker so it doesn't trigger liveness
    probe failures.

    Uses a Redis lock (SET NX) to prevent concurrent processing of the
    same task, in addition to arq's ``_job_id`` dedup at enqueue time.
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(
        "Starting process_odm_webhook_assets (Job ID: {}): project={} odm_task={}",
        job_id,
        dtm_project_id,
        odm_task_id,
    )

    # Distributed lock: prevent two workers from processing the same
    # task concurrently (belt-and-suspenders alongside _job_id dedup).
    lock_target = dtm_task_id or dtm_project_id
    lock_key = f"lock:odm-assets:{lock_target}"
    redis = ctx.get("redis")
    lock_acquired = False
    if redis:
        lock_acquired = await redis.set(
            lock_key,
            job_id,
            nx=True,
            ex=21600,  # 6 hours - must exceed worst-case download + reprojection
        )
        if not lock_acquired:
            log.warning(
                "Skipping process_odm_webhook_assets for {}: "
                "another job already holds the lock",
                lock_target,
            )
            return {"status": "skipped", "reason": "concurrent_lock"}

    try:
        project_uuid = UUID(dtm_project_id)
        task_uuid = UUID(dtm_task_id) if dtm_task_id else None
        state = State[state_name] if state_name else None
        job_try = int(ctx.get("job_try") or 1)
        max_tries = int(getattr(WorkerSettings, "max_tries", 3) or 3)

        try:
            await process_assets_from_odm(
                node_odm_url=node_odm_url,
                dtm_project_id=project_uuid,
                odm_task_id=odm_task_id,
                state=state,
                message=message,
                dtm_task_id=task_uuid,
                odm_status_code=odm_status_code,
                persist_failure_state=False,
                db_pool=ctx.get("db_pool"),
            )
        except OdmAssetTransientError as e:
            if job_try < max_tries:
                log.warning(
                    f"Transient ODM asset processing error "
                    f"(try {job_try}/{max_tries}), retrying: {e}",
                )
                raise

            log.error(
                f"ODM asset processing exhausted retries ({job_try}/{max_tries}): {e}",
            )
            await _persist_odm_failure(ctx, project_uuid, task_uuid, state, str(e))
            raise
        except OdmAssetTerminalError as e:
            log.error(f"Terminal ODM asset processing error: {e}")
            await _persist_odm_failure(ctx, project_uuid, task_uuid, state, str(e))
            return {
                "status": "failed",
                "reason": "terminal_error",
                "project_id": dtm_project_id,
            }

        return {"status": "completed", "project_id": dtm_project_id}
    finally:
        if redis and lock_acquired:
            await redis.delete(lock_key)


class WorkerSettings:
    """ARQ worker configuration"""

    redis_settings = RedisSettings.from_dsn(settings.DRAGONFLY_DSN)
    functions = [
        sleep_task,
        count_project_tasks,
        process_drone_images,
        process_all_drone_images,
        process_uploaded_image,
        ingest_existing_uploads,
        classify_project_images,
        move_task_images_for_processing,
        delete_batch_images,
        process_project_task_metrics,
        download_and_upload_dem,
        generate_qfield_project,
        process_imported_odm_assets,
        process_odm_webhook_assets,
    ]

    queue_name = "default_queue"
    max_jobs = 20
    job_timeout = 86400  # 24 hours
    max_tries = 3
    health_check_interval = 300  # 5 minutes
    on_startup = startup
    on_shutdown = shutdown


async def get_redis_pool() -> ArqRedis:
    """Redis connection dependency"""
    try:
        return await create_pool(RedisSettings.from_dsn(settings.DRAGONFLY_DSN))
    except Exception as e:
        log.error(f"Redis connection failed: {str(e)}")
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail="Background worker unavailable",
        ) from e
