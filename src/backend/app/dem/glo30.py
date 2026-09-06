"""Download project DEM crops from Copernicus GLO-30 via OAM TiTiler."""

import io
import math

import httpx
from app.config import settings
from app.projects import project_logic
from arq import Retry
from fastapi import UploadFile
from loguru import logger as log

# GLO-30 pixel edges are offset half a pixel from whole degrees.
PIXEL_DEG = 1 / 3600
GRID_ORIGIN = -0.5 * PIXEL_DEG

DEFAULT_BUFFER_PX = 1

# 4096 pixels is roughly 127 km at the equator.
MAX_DIMENSION_PX = 4096

REQUEST_TIMEOUT = 180

RETRY_DEFER_SECONDS = 30


def _snap_down(value: float) -> float:
    """Return the grid edge at or below a coordinate."""
    return GRID_ORIGIN + math.floor((value - GRID_ORIGIN) / PIXEL_DEG) * PIXEL_DEG


def _snap_up(value: float) -> float:
    """Return the grid edge at or above a coordinate."""
    return GRID_ORIGIN + math.ceil((value - GRID_ORIGIN) / PIXEL_DEG) * PIXEL_DEG


def snap_bbox(
    bbox: tuple[float, float, float, float],
    buffer_px: int = DEFAULT_BUFFER_PX,
) -> tuple[tuple[float, float, float, float], int, int]:
    """Snap a bbox to the GLO-30 grid and return its pixel dimensions."""
    minx, miny, maxx, maxy = bbox
    if minx >= maxx or miny >= maxy:
        raise ValueError(f"Degenerate bbox: {bbox}")

    pad = buffer_px * PIXEL_DEG
    minx = _snap_down(minx - pad)
    miny = _snap_down(miny - pad)
    maxx = _snap_up(maxx + pad)
    maxy = _snap_up(maxy + pad)

    width = round((maxx - minx) / PIXEL_DEG)
    height = round((maxy - miny) / PIXEL_DEG)

    if width > MAX_DIMENSION_PX or height > MAX_DIMENSION_PX:
        raise ValueError(
            f"Project AOI needs a {width}x{height} px DEM, over the "
            f"{MAX_DIMENSION_PX} px limit. Split the project, or upload a DEM."
        )

    return (minx, miny, maxx, maxy), width, height


def dem_crop_url(bbox: tuple[float, float, float, float]) -> str:
    """Build the TiTiler URL for a GeoTIFF crop of the GLO-30 mosaic."""
    (minx, miny, maxx, maxy), width, height = snap_bbox(bbox)
    return (
        f"{settings.OAM_RASTER_API_URL.rstrip('/')}"
        f"/collections/{settings.DEM_STAC_COLLECTION}"
        f"/bbox/{minx:.10f},{miny:.10f},{maxx:.10f},{maxy:.10f}.tif"
        f"?assets=data&width={width}&height={height}&return_mask=false"
    )


async def fetch_dem(bbox: tuple[float, float, float, float]) -> bytes:
    """Fetch a GLO-30 GeoTIFF covering a bbox."""
    url = dem_crop_url(bbox)
    log.info(f"Requesting GLO-30 DEM crop: {url}")

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(url)
        response.raise_for_status()

    if not response.content:
        raise ValueError(f"TiTiler returned an empty DEM for bbox {bbox}")

    log.info(f"Received {len(response.content)} byte DEM for bbox {bbox}")
    return response.content


async def download_and_upload_glo30_dem(ctx, project_id: str, bbox: list, **_kwargs):
    """ARQ worker function to crop GLO-30 for a project and store it on S3."""
    log.info(f"Starting GLO-30 DEM job for project ({project_id}) over {bbox}")

    # Retry failures that may succeed on a later attempt.
    try:
        dem_bytes = await fetch_dem(tuple(bbox))

        dem = UploadFile(
            file=io.BytesIO(dem_bytes),
            filename="dem.tif",
            headers={"content-type": "image/tiff"},  # type: ignore[arg-type]
        )
        dem_url = await project_logic.upload_file_to_s3(project_id, dem, "dem.tif")
        log.info(f"Uploaded GLO-30 DEM for project ({project_id}) to: {dem_url}")

        async with ctx["db_pool"].connection() as conn:
            await project_logic.update_url(conn, project_id, dem_url)
    except ValueError:
        raise
    except Exception as e:
        attempt = ctx.get("job_try", 1)
        log.warning(
            f"GLO-30 DEM job failed for project ({project_id}), attempt {attempt}: {e}"
        )
        raise Retry(defer=attempt * RETRY_DEFER_SECONDS) from e

    log.info(f"Successfully completed GLO-30 DEM job for project ({project_id})")


async def enqueue_glo30_dem_download(bbox, project_id: str, redis):
    """Enqueue a GLO-30 DEM crop to the arq-worker queue."""
    job = await redis.enqueue_job(
        "download_and_upload_glo30_dem",
        str(project_id),
        list(bbox),
        _queue_name="default_queue",
    )
    log.info(f"Queued GLO-30 DEM job: {job.job_id} for project: {project_id}")
    return job
