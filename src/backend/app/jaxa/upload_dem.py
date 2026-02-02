import io
import os
from pathlib import Path

from loguru import logger as log
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings
from fastapi import UploadFile
from arq import ArqRedis

from app.db import database
from app.jaxa.jaxa_coordinates import get_covering_tiles
from app.projects import project_logic
from app.jaxa.tif_spider import TifSpider


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


async def download_and_upload_dem(ctx, coordinates_str: str, project_id: str):
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

    # Use project-specific directory to avoid conflicts in k8s
    project_dir = Path(f"/tmp/tif_processing/{project_id}")
    project_dir.mkdir(parents=True, exist_ok=True)
    tif_file_path = str(project_dir / "merged.tif")

    try:
        # Run the blocking Scrapy crawler
        log.info(f"Starting Scrapy crawler for project ({project_id})")

        process = CrawlerProcess(get_project_settings())
        process.crawl(TifSpider, coordinates=coordinates_str, output_path=tif_file_path)
        process.start()  # This blocks until crawling is complete

        log.info(f"Scrapy crawler completed for project ({project_id})")

        # Upload to S3 and update database
        await upload_dem_file_s3_sync(tif_file_path, project_id)

        log.info(f"Successfully completed DEM job for project ({project_id})")

    except Exception as e:
        log.error(
            f"DEM download job failed for project ({project_id}): {e}", exc_info=True
        )

        # Clean up on failure
        if os.path.exists(tif_file_path):
            os.remove(tif_file_path)
            log.info(f"Cleaned up partial file: {tif_file_path}")

        if project_dir.exists():
            # Try to clean up any remaining files
            for file in project_dir.glob("*"):
                try:
                    file.unlink()
                except Exception as cleanup_error:
                    log.warning(f"Could not clean up {file}: {cleanup_error}")

            # Remove directory if empty
            try:
                project_dir.rmdir()
            except Exception:
                pass

        raise
