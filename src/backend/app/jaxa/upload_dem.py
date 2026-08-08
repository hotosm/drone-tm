"""Initialise Scrapy AsyncCrawlerRunner and download DEM files from JAXA.

Uses AsyncCrawlerRunner (Scrapy >=2.13) which provides native async/await
support on top of AsyncioSelectorReactor, avoiding the Deferred-to-Future
bridging that CrawlerRunner required.
"""

import asyncio
import io
import json
import os
import tempfile
from pathlib import Path

from app.db import database
from app.jaxa.jaxa_coordinates import get_covering_tiles
from app.jaxa.tif_spider import TifSpider
from app.projects import project_logic
from arq import ArqRedis
from fastapi import UploadFile
from loguru import logger as log
from osgeo import gdal
from psycopg.rows import dict_row
from scrapy.crawler import AsyncCrawlerRunner
from scrapy.utils.project import get_project_settings
from scrapy.utils.reactor import _asyncio_reactor_path, install_reactor

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
        async with pool as pool_instance, pool_instance.connection() as conn:
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


def clip_dem_to_aoi(dem_path: str, buffered_aoi_geojson: dict) -> str:
    """Clip a DEM raster to a buffered AOI polygon using GDAL.

    Writes the GeoJSON geometry to a temporary cutline file, then uses
    gdal.Warp with cropToCutline to produce a clipped raster.

    Args:
        dem_path: Path to the input DEM GeoTIFF.
        buffered_aoi_geojson: GeoJSON geometry dict of the buffered AOI.

    Returns:
        Path to the clipped raster.
    """
    fd, cutline_path = tempfile.mkstemp(suffix=".geojson", prefix="cutline_")
    os.close(fd)
    clipped_path = dem_path + ".clipped.tif"

    try:
        # Write the buffered AOI geometry to a temporary GeoJSON file.
        # gdal.Warp requires a file path for cutlineDSName.
        cutline_geojson = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {}, "geometry": buffered_aoi_geojson}
            ],
        }
        with open(cutline_path, "w") as f:
            json.dump(cutline_geojson, f)

        result = gdal.Warp(
            clipped_path,
            dem_path,
            cutlineDSName=cutline_path,
            cropToCutline=True,
            format="GTiff",
        )
        if result is None:
            raise RuntimeError(
                f"gdal.Warp returned None - clipping failed for {dem_path}"
            )
        result = None  # flush/close

        # Replace the original file with the clipped version.
        os.replace(clipped_path, dem_path)

        return dem_path

    except Exception:
        # Clean up the clipped file if it was created but the rename failed.
        if os.path.exists(clipped_path):
            try:
                os.remove(clipped_path)
            except OSError:
                pass
        raise

    finally:
        if os.path.exists(cutline_path):
            try:
                os.remove(cutline_path)
            except OSError:
                pass


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

    # Use project-specific directory to avoid conflicts in k8s
    project_dir = Path(tempfile.gettempdir()) / "tif_processing" / str(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    tif_file_path = str(project_dir / "merged.tif")

    try:
        # Run the blocking Scrapy crawler
        log.info(f"Starting Scrapy crawler for project ({project_id})")
        await _run_scrapy_crawler_async(coordinates_str, tif_file_path)

        log.info(f"Scrapy crawler completed for project ({project_id})")

        # Clip the merged DEM to the project AOI (buffered by 50 m).
        # This reduces the file size for QField packaging (Issue #790).
        # Failure here is non-fatal: the unclipped DEM is still usable.
        try:
            db_pool = ctx.get("db_pool")
            if db_pool:
                async with db_pool.connection() as conn:
                    async with conn.cursor(row_factory=dict_row) as cur:
                        await cur.execute(
                            """
                            SELECT ST_AsGeoJSON(
                                ST_Buffer(outline::geography, 50)::geometry
                            )::json AS buffered_outline
                            FROM projects WHERE id = %s
                            """,
                            (project_id,),
                        )
                        row = await cur.fetchone()

                if row and row["buffered_outline"]:
                    tif_file_path = clip_dem_to_aoi(
                        tif_file_path, row["buffered_outline"]
                    )
                    log.info(f"Clipped DEM to buffered AOI for project ({project_id})")
                else:
                    log.warning(
                        f"No AOI found for project ({project_id}), "
                        "uploading unclipped DEM"
                    )
            else:
                log.warning(
                    f"DB pool unavailable for project ({project_id}), "
                    "uploading unclipped DEM"
                )
        except Exception as clip_err:
            log.warning(
                f"DEM clipping failed for project ({project_id}), "
                f"uploading unclipped: {clip_err}"
            )

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
