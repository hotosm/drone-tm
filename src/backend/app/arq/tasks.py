import asyncio
import json
from typing import Any, Dict, Optional
from uuid import UUID

from arq import ArqRedis, create_pool
from arq.connections import RedisSettings, log_redis_info
from fastapi import HTTPException
from loguru import logger as log
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
from app.models.enums import HTTPStatus, ImageStatus
from app.projects.project_logic import process_all_drone_images, process_drone_images
from app.s3 import async_get_obj_from_bucket


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
    )

    image_record = await create_project_image(db, image_data)
    await db.commit()

    log.info(
        f"Saved: {filename} | Status: {status} | "
        f"GPS: {location is not None} | EXIF: {exif_dict is not None}"
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
    log.info(f"Starting process_uploaded_image (Job ID: {job_id}): {filename}")

    try:
        # Get database connection from pool
        db_pool = ctx.get("db_pool")
        if not db_pool:
            raise Exception("Database pool not initialized")

        async with db_pool.connection() as db:
            log.info(f"Downloading file from S3: {file_key}")
            file_obj = await async_get_obj_from_bucket(settings.S3_BUCKET_NAME, file_key)
            file_content = file_obj.read()

            log.info(f"Calculating hash for: {filename}")
            file_hash = calculate_file_hash(file_content)

            # Step 2: Check for duplicates (idempotent behavior)
            duplicate_id = await check_duplicate_image(db, UUID(project_id), file_hash)
            if duplicate_id:
                log.info(f"Duplicate detected: {file_hash} -> {duplicate_id}")
                sql = f"SELECT * FROM project_images WHERE id = %(id)s"
                async with db.cursor(row_factory=dict_row) as cur:
                    await cur.execute(sql, {"id": str(duplicate_id)})
                    existing_record = await cur.fetchone()

                return {
                    "image_id": str(duplicate_id),
                    "status": existing_record["status"],
                    "has_gps": existing_record["location"] is not None,
                    "is_duplicate": True,
                    "message": "Duplicate image (idempotent)",
                }

            # Step 3: Extract EXIF (try-catch to handle failures gracefully)
            exif_dict = None
            location = None

            try:
                log.info(f"Extracting EXIF from: {filename}")
                exif_dict, location = extract_exif_data(file_content)

                if exif_dict:
                    log.info(f"✓ EXIF: {len(exif_dict)} tags | GPS: {location is not None}")
                    log.debug(f"EXIF tags: {list(exif_dict.keys())[:10]}")
                else:
                    log.warning(f"✗ No EXIF data in: {filename}")

            except Exception as exif_error:
                log.error(f"✗ EXIF extraction failed for {filename}: {exif_error}")

            # Step 4: Determine status
            status = ImageStatus.STAGED if exif_dict else ImageStatus.INVALID_EXIF

            # Step 5: Save image record (ALWAYS save, even if EXIF failed)
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
            )

            log.info(
                f"✓ Completed (Job: {job_id}): "
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
        log.error(f"✗ Failed (Job: {job_id}): {str(e)}")
        raise


async def classify_image_batch(
    ctx: Dict[Any, Any],
    project_id: str,
    batch_id: str,
) -> Dict:
    from app.projects.image_classification import ImageClassifier

    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting batch classification job {job_id} for batch {batch_id}")

    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("Database pool not initialized in ARQ context")

    try:
        async with db_pool.connection() as conn:
            result = await ImageClassifier.classify_batch(
                conn,
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
