"""Initialise Scrapy AsyncCrawlerRunner and download DEM files from JAXA.

Uses AsyncCrawlerRunner (Scrapy >=2.13) which provides native async/await
support on top of AsyncioSelectorReactor, avoiding the Deferred-to-Future
bridging that CrawlerRunner required.
"""

import io
import asyncio
import os
import shutil
import tempfile
from pathlib import Path

from loguru import logger as log
from scrapy.utils.project import get_project_settings
from scrapy.crawler import AsyncCrawlerRunner
from scrapy.utils.reactor import install_reactor, _asyncio_reactor_path
from fastapi import UploadFile
from arq import ArqRedis

from app.db import database
from app.jaxa.jaxa_coordinates import get_covering_tiles
from app.projects import project_logic
from app.jaxa.tif_spider import TifSpider


_crawler_runner: AsyncCrawlerRunner | None = None
_crawler_loop: asyncio.AbstractEventLoop | None = None
_crawler_lock = asyncio.Lock()
_crawler_timeout_seconds = 20 * 60


def _get_or_create_crawler_runner() -> AsyncCrawlerRunner:
    """Create Scrapy runner bound to the currently running asyncio loop."""
    global _crawler_runner, _crawler_loop

    loop = asyncio.get_running_loop()
    if _crawler_runner is not None:
        if _crawler_loop is not loop:
            raise RuntimeError(
                "Scrapy crawler runner is bound to a different event loop. "
                "Restart the worker to reset Scrapy/Twisted state."
            )
        return _crawler_runner

    install_reactor(_asyncio_reactor_path)

    from twisted.internet import reactor as twisted_reactor

    reactor_loop = getattr(twisted_reactor, "_asyncioEventloop", None)
    if reactor_loop is not loop:
        raise RuntimeError(
            "Twisted AsyncioSelectorReactor is attached to a different asyncio loop. "
            "This can stall Scrapy crawls; restart the worker process."
        )

    # The reactor must be marked as "running" so that callWhenRunning()
    # callbacks fire immediately.  Without this, the Twisted thread-pool
    # (used for DNS resolution) is created but never started, causing
    # every Scrapy download to hang on hostname resolution.
    if not twisted_reactor.running:
        twisted_reactor.startRunning(installSignalHandlers=False)

    scrapy_settings = get_project_settings()
    scrapy_settings.set("TWISTED_REACTOR", _asyncio_reactor_path, priority="project")
    scrapy_settings.set("TELNETCONSOLE_ENABLED", False, priority="project")

    _crawler_runner = AsyncCrawlerRunner(scrapy_settings)
    _crawler_loop = loop
    return _crawler_runner


async def _run_scrapy_crawler_async(coordinates_str: str, tif_file_path: str):
    """Run Scrapy in-process using the asyncio reactor, one crawl at a time."""
    async with _crawler_lock:
        runner = _get_or_create_crawler_runner()
        log.info(f"Starting Scrapy crawl for DEM tiles: {coordinates_str}")
        await asyncio.wait_for(
            runner.crawl(
                TifSpider, coordinates=coordinates_str, output_path=tif_file_path
            ),
            timeout=_crawler_timeout_seconds,
        )
        log.info(f"Scrapy crawl finished, expecting DEM at {tif_file_path}")


async def upload_dem_file_s3_sync(tif_file_path: str, project_id: str):
    """Uploads the DEM file to S3 and updates the database."""
    try:
        # Check if file exists
        if not os.path.exists(tif_file_path):
            raise FileNotFoundError(f"DEM file not found at {tif_file_path}")

        log.info(
            f"Found DEM file at {tif_file_path}, preparing upload for project ({project_id})"
        )

        with open(tif_file_path, "rb") as dem_file:
            file_bytes = dem_file.read()
            file_obj = io.BytesIO(file_bytes)
            dem = UploadFile(file=file_obj, filename="dem.tif")

        log.info(f"Uploading downloaded DEM for project ({project_id}) to S3")
        dem_url = await project_logic.upload_file_to_s3(project_id, dem, "dem.tif")
        log.info(f"Successfully uploaded DEM file to: {dem_url}")

        pool = await database.get_db_connection_pool()
        async with pool as pool_instance:
            async with pool_instance.connection() as conn:
                await project_logic.update_url(conn, project_id, dem_url)
                log.info(f"DEM URL updated in database for project ({project_id})")

        log.info(f"Removing temporary file from disk: {tif_file_path}")
        os.remove(tif_file_path)

        # Clean up project-specific directory
        project_dir = Path(tif_file_path).parent
        if project_dir.exists() and not any(project_dir.iterdir()):
            project_dir.rmdir()
            log.info(f"Cleaned up empty project directory: {project_dir}")

    except FileNotFoundError as e:
        log.error(f"DEM file not found for project ({project_id}): {e}")
        raise
    except Exception as e:
        log.error(
            f"Failed to upload DEM for project ({project_id}): {e}", exc_info=True
        )
        log.error(f"File path was: {tif_file_path}")
        raise


async def enqueue_dem_download(
    geometry,
    project_id: str,
    redis: ArqRedis,
):
    """Enqueues a DEM download job to the arq-worker queue."""
    tiles = get_covering_tiles(geometry)
    coordinates_str = ",".join(tiles)

    try:
        log.info(f"Enqueuing DEM download job for project ({project_id})")

        # Enqueue the job to arq-worker
        job = await redis.enqueue_job(
            "download_and_upload_dem",
            coordinates_str,
            str(project_id),
            _queue_name="default_queue",
        )

        log.info(
            f"Queued DEM download job: {job.job_id} for project: {project_id} "
            f"with {len(tiles)} tiles"
        )

        return {
            "message": "DEM download job enqueued",
            "job_id": job.job_id,
            "project_id": str(project_id),
            "tile_count": len(tiles),
        }

    except Exception as e:
        log.error(
            f"Failed to enqueue DEM download job for project ({project_id}): {e}",
            exc_info=True,
        )
        raise


async def download_and_upload_dem(
    ctx, coordinates_str: str, project_id: str, **_kwargs
):
    """
    ARQ worker function to download DEM tiles and upload to S3.

    This is a blocking function that runs in the arq-worker process.

    Args:
        ctx: ARQ context
        coordinates_str: Comma-separated list of tile coordinates
        project_id: Project ID for organization
    """
    log.info(
        f"Starting DEM download job for project ({project_id}) "
        f"with coordinates: {coordinates_str}"
    )

    # Use a project-scoped temp directory so concurrent jobs don't collide
    # in k8s. tempfile picks the system temp root (TMPDIR / TEMP / /tmp)
    # and the directory is cleaned up automatically on success or failure.
    project_dir = Path(tempfile.mkdtemp(prefix=f"dtm-dem-{project_id}-"))
    tif_file_path = str(project_dir / "merged.tif")

    try:
        # Run the blocking Scrapy crawler
        log.info(f"Starting Scrapy crawler for project ({project_id})")
        await _run_scrapy_crawler_async(coordinates_str, tif_file_path)

        log.info(f"Scrapy crawler completed for project ({project_id})")

        # Upload to S3 and update database
        await upload_dem_file_s3_sync(tif_file_path, project_id)

        log.info(f"Successfully completed DEM job for project ({project_id})")

    except Exception as e:
        log.error(
            f"DEM download job failed for project ({project_id}): {e}", exc_info=True
        )
        raise
    finally:
        shutil.rmtree(project_dir, ignore_errors=True)
