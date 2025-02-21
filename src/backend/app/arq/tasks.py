import asyncio
from typing import Any, Dict
from arq.connections import RedisSettings, log_redis_info
from app.config import settings
from loguru import logger as log
from arq import create_pool, ArqRedis
from fastapi import HTTPException
from app.models.enums import HTTPStatus


async def startup(ctx: Dict[Any, Any]) -> None:
    """Initialize ARQ resources"""
    log.info("Starting ARQ worker")
    ctx["redis"] = await create_pool(RedisSettings.from_dsn(settings.REDIS_DSN))
    await log_redis_info(ctx["redis"], log.info)


async def shutdown(ctx: Dict[Any, Any]) -> None:
    """Cleanup ARQ resources"""
    log.info("Shutting down ARQ worker")
    if redis := ctx.get("redis"):  # Get redis if it exists
        await redis.close()
        log.info("Redis connection closed")


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


class WorkerSettings:
    """ARQ worker configuration"""

    redis_settings = RedisSettings.from_dsn(settings.REDIS_DSN)
    functions = [sleep_task]
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
