import asyncio
from typing import Any, Dict

from arq import ArqRedis, create_pool
from arq.connections import RedisSettings, log_redis_info
from fastapi import HTTPException
from loguru import logger as log

from app.config import settings
from app.db.database import get_db_connection_pool
from app.models.enums import HTTPStatus
from app.projects.project_logic import process_all_drone_images, process_drone_images


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


class WorkerSettings:
    """ARQ worker configuration"""

    redis_settings = RedisSettings.from_dsn(settings.REDIS_DSN)
    functions = [
        sleep_task,
        count_project_tasks,
        process_drone_images,
        process_all_drone_images,
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
