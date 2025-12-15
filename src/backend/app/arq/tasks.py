import asyncio
import io
from typing import Any, Dict, Optional, Tuple
from uuid import UUID

from arq import ArqRedis, create_pool
from arq.connections import RedisSettings, log_redis_info
from fastapi import HTTPException
from loguru import logger as log
from PIL import Image

from app.config import settings
from app.db.database import get_db_connection_pool
from app.images.image_logic import (
    calculate_file_hash,
    check_duplicate_image,
    create_project_image,
    mark_image_as_duplicate,
)
from app.images.image_schemas import ProjectImageCreate, ProjectImageOut
from app.models.enums import HTTPStatus, ImageStatus
from app.projects.project_logic import process_all_drone_images, process_drone_images
from app.s3 import async_get_obj_from_bucket, s3_client
from app.projects.image_classification import ImageClassifier


THUMBNAIL_SIZE = (200, 200)


async def startup(ctx: Dict[Any, Any]) -> None:
    """Initialize ARQ resources including database pool"""
    log.info("Starting ARQ worker")

    # Initialize Redis
    ctx["redis"] = await create_pool(RedisSettings.from_dsn(settings.REDIS_DSN))
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


async def sleep_task(ctx: Dict[Any, Any]) -> Dict[str, str]:
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


async def count_project_tasks(ctx: Dict[Any, Any], project_id: str) -> Dict[str, Any]:
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
) -> Dict[str, Any]:
    """Background task to process uploaded image: extract EXIF, calculate hash, save to DB.

    This function ALWAYS saves the image record, even if EXIF extraction fails,
    so that all uploaded images can be reviewed during the classification phase.

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

            # Step 2: Check for duplicates
            duplicate_of_id = await check_duplicate_image(
                db, UUID(project_id), file_hash
            )
            if duplicate_of_id:
                log.info(f"Duplicate detected: {file_hash} -> {duplicate_of_id}")
                # Create a new record marked as duplicate (so it shows in batch)
                image_record = await _save_image_record(
                    db=db,
                    project_id=project_id,
                    filename=filename,
                    file_key=file_key,
                    file_hash=file_hash,
                    uploaded_by=uploaded_by,
                    exif_dict=None,
                    location=None,
                    status=ImageStatus.DUPLICATE,
                    batch_id=batch_id,
                )
                # Mark with reference to original
                await mark_image_as_duplicate(db, image_record.id, duplicate_of_id)

                return {
                    "image_id": str(image_record.id),
                    "status": ImageStatus.DUPLICATE.value,
                    "has_gps": False,
                    "is_duplicate": True,
                    "duplicate_of": str(duplicate_of_id),
                    "message": "Duplicate image detected",
                }

            # Step 3: Extract EXIF (try-catch to handle failures gracefully)
            exif_dict = None
            location = None

            try:
                log.info(f"Extracting EXIF from: {filename}")
                exif_dict, location = extract_exif_data(file_content)

                if exif_dict:
                    log.info(
                        f" EXIF: {len(exif_dict)} tags | GPS: {location is not None}"
                    )
                    log.debug(f"EXIF tags: {list(exif_dict.keys())[:10]}")
                else:
                    log.warning(f"No EXIF data in: {filename}")

            except Exception as exif_error:
                log.error(f"EXIF extraction failed for {filename}: {exif_error}")

            # Step 4: Generate and upload thumbnail
            thumbnail_s3_key = None
            try:
                log.info(f"Generating thumbnail for: {filename}")
                # Generate thumbnail (run in threadpool since PIL is CPU-bound)
                thumbnail_bytes = await asyncio.to_thread(
                    generate_thumbnail, file_content
                )

                # Create thumbnail S3 key (store in thumbnails/ subdirectory)
                thumbnail_s3_key = file_key.replace("/images/", "/thumbnails/", 1)
                if "/images/" not in file_key:
                    # Fallback: add thumb_ prefix
                    parts = file_key.rsplit("/", 1)
                    thumbnail_s3_key = f"{parts[0]}/thumb_{parts[1]}" if len(parts) > 1 else f"thumb_{file_key}"

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
                log.warning(f"Failed to generate/upload thumbnail for {filename}: {thumb_error}")
                # Continue even if thumbnail generation fails
                thumbnail_s3_key = None

            # Step 5: Determine status
            status = ImageStatus.STAGED if exif_dict else ImageStatus.INVALID_EXIF

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


async def classify_image_batch(
    ctx: Dict[Any, Any],
    project_id: str,
    batch_id: str,
) -> Dict:
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting batch classification job {job_id} for batch {batch_id}")

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        # Pass the pool directly so classify_batch can get separate connections
        # for each parallel worker
        result = await ImageClassifier.classify_batch(
            db_pool,
            UUID(batch_id),
            UUID(project_id),
        )

        log.info(
            f"Batch classification complete: "
            f"Total={result['total']}, Assigned={result['assigned']}, "
            f"Rejected={result['rejected']}, Unmatched={result['unmatched']}"
        )

        return result

    except Exception as e:
        log.error(f"Batch classification failed: {str(e)}")
        raise


async def delete_batch_images(
    ctx: Dict[Any, Any],
    project_id: str,
    batch_id: str,
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
            # Get all S3 keys for images and thumbnails in this batch
            query = """
                SELECT s3_key, thumbnail_url
                FROM project_images
                WHERE batch_id = %(batch_id)s
                AND project_id = %(project_id)s
            """

            async with conn.cursor() as cur:
                await cur.execute(
                    query,
                    {"batch_id": batch_id, "project_id": project_id},
                )
                rows = await cur.fetchall()

            # Collect all S3 keys to delete
            s3_keys_to_delete = []
            for row in rows:
                s3_key, thumbnail_url = row
                if s3_key:
                    s3_keys_to_delete.append(s3_key)
                if thumbnail_url:
                    s3_keys_to_delete.append(thumbnail_url)

            image_count = len(rows)
            log.info(
                f"Found {image_count} images and {len(s3_keys_to_delete)} S3 objects to delete"
            )

            # Delete from S3
            deleted_s3_count = 0
            if s3_keys_to_delete:
                client = s3_client()
                for key in s3_keys_to_delete:
                    try:
                        key = key.lstrip("/")
                        client.remove_object(settings.S3_BUCKET_NAME, key)
                        deleted_s3_count += 1
                    except Exception as e:
                        log.warning(f"Failed to delete S3 object {key}: {e}")

            log.info(f"Deleted {deleted_s3_count} objects from S3")

            # Delete from database
            delete_query = """
                DELETE FROM project_images
                WHERE batch_id = %(batch_id)s
                AND project_id = %(project_id)s
            """

            async with conn.cursor() as cur:
                await cur.execute(
                    delete_query,
                    {"batch_id": batch_id, "project_id": project_id},
                )

            await conn.commit()

            log.info(
                f"Batch deletion complete: {image_count} images, "
                f"{deleted_s3_count} S3 objects deleted"
            )

            return {
                "message": "Batch deleted successfully",
                "batch_id": batch_id,
                "deleted_images": image_count,
                "deleted_s3_objects": deleted_s3_count,
            }

    except Exception as e:
        log.error(f"Failed to delete batch (Job: {job_id}): {str(e)}")
        raise


class WorkerSettings:
    """ARQ worker configuration"""

    redis_settings = RedisSettings.from_dsn(settings.REDIS_DSN)
    functions = [
        sleep_task,
        count_project_tasks,
        process_drone_images,
        process_all_drone_images,
        process_uploaded_image,
        classify_image_batch,
        delete_batch_images,
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
        return await create_pool(RedisSettings.from_dsn(settings.REDIS_DSN))
    except Exception as e:
        log.error(f"Redis connection failed: {str(e)}")
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail="Background worker unavailable",
        ) from e
