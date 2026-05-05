import json
import os
import tempfile
import uuid
import zipfile
from typing import Any, Literal, Optional

import aiohttp
from loguru import logger as log
from osgeo import gdal

from app.config import settings
from app.s3 import (
    add_file_to_bucket,
    delete_objects_by_prefix,
    get_file_from_bucket,
)


SCALEODM_SUBMIT_TIMEOUT_SEC = 30


ProcessingMode = Literal["standard", "merge-existing", "thermal", "city-scale"]


class ScaleOdmSubmitError(RuntimeError):
    """Raised when POST /task/new is rejected by ScaleODM."""

    def __init__(self, message: str, *, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class OrthophotoPostProcessingError(RuntimeError):
    """Raised when the in-place orthophoto reprojection fails."""


async def submit_scaleodm_task(
    *,
    scaleodm_url: str,
    read_s3_path: str,
    write_s3_path: str,
    name: str,
    options: list[dict[str, Any]],
    processing_mode: ProcessingMode = "standard",
    s3_scan_depth: int = 1,
    use_default_excludes: bool = True,
    exclude_paths: Optional[list[str]] = None,
    s3_endpoint: Optional[str] = None,
) -> str:
    """Create a ScaleODM task via POST /task/new.

    Returns the ScaleODM task UUID. Raises :class:`ScaleOdmSubmitError`
    on a non-2xx response (with the server's ``error``/``errorMessage``
    string when present).
    """
    body: dict[str, Any] = {
        "name": name,
        "readS3Path": read_s3_path,
        "writeS3Path": write_s3_path,
        "processingMode": processing_mode,
        "s3ScanDepth": s3_scan_depth,
        "useDefaultExcludes": use_default_excludes,
    }
    if options:
        body["options"] = json.dumps(options)
    if exclude_paths:
        body["excludePaths"] = json.dumps(exclude_paths)
    if s3_endpoint:
        body["s3Endpoint"] = s3_endpoint

    base = scaleodm_url.rstrip("/")
    url = f"{base}/task/new"
    timeout = aiohttp.ClientTimeout(total=SCALEODM_SUBMIT_TIMEOUT_SEC)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, json=body) as resp:
            text = await resp.text()
            payload: Optional[dict[str, Any]] = None
            try:
                payload = json.loads(text) if text else None
            except json.JSONDecodeError:
                payload = None

            if resp.status >= 400:
                err = None
                if isinstance(payload, dict):
                    err = (
                        payload.get("error")
                        or payload.get("errorMessage")
                        or payload.get("message")
                    )
                raise ScaleOdmSubmitError(
                    err
                    or f"ScaleODM /task/new returned HTTP {resp.status}: {text[:300]}",
                    status=resp.status,
                )

            uuid_value = (
                (payload or {}).get("uuid") if isinstance(payload, dict) else None
            )
            if not uuid_value:
                raise ScaleOdmSubmitError(
                    f"ScaleODM /task/new response missing uuid: {text[:300]}"
                )
            log.info(f"ScaleODM accepted task {uuid_value} ({name})")
            return str(uuid_value)


async def remove_scaleodm_task(*, scaleodm_url: str, odm_task_uuid: str) -> None:
    """Best-effort POST /task/remove. Logs and swallows failures."""
    base = scaleodm_url.rstrip("/")
    url = f"{base}/task/remove"
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=SCALEODM_SUBMIT_TIMEOUT_SEC)
        ) as session:
            async with session.post(url, json={"uuid": odm_task_uuid}) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    log.warning(
                        "ScaleODM /task/remove returned HTTP {} for {}: {}",
                        resp.status,
                        odm_task_uuid,
                        body[:200],
                    )
                    return
        log.info(f"Removed ScaleODM task {odm_task_uuid}")
    except Exception as e:
        log.warning(f"Failed to remove ScaleODM task {odm_task_uuid}: {e}")


async def fetch_scaleodm_task_info(
    *, scaleodm_url: str, odm_task_uuid: str
) -> Optional[dict[str, Any]]:
    """Fetch /task/{uuid}/info from ScaleODM. Returns ``None`` on failure."""
    base = scaleodm_url.rstrip("/")
    url = f"{base}/task/{odm_task_uuid}/info"
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=15)
        ) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    log.warning(
                        "ScaleODM /task/{}/info returned HTTP {}",
                        odm_task_uuid,
                        resp.status,
                    )
                    return None
                return await resp.json()
    except Exception as e:
        log.warning(f"Failed to fetch ScaleODM task info for {odm_task_uuid}: {e}")
        return None


def reproject_to_web_mercator(input_file, output_file):
    """Reproject an orthophoto to Web Mercator (EPSG:3857) as a COG.

    Done in two steps to avoid a known issue where combining the COG
    driver with Warp + creationOptions + memory caps produces truncated
    output: first Warp to a plain GeoTIFF, then Translate that to COG.
    """
    warped_path = output_file + ".warped.tif"
    try:
        gdal.SetConfigOption("GDAL_CACHEMAX", "256")

        gdal.Warp(
            warped_path,
            input_file,
            dstSRS="EPSG:3857",
            format="GTiff",
            resampleAlg="near",
            warpMemoryLimit=256 * 1024 * 1024,
            multithread=True,
            creationOptions=["COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER", "TILED=YES"],
        )

        gdal.Translate(
            output_file,
            warped_path,
            format="COG",
            creationOptions=["COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"],
        )
        log.info(f"File reprojected to Web Mercator and saved as {output_file}")

    except Exception as e:
        log.error(f"An error occurred during reprojection: {e}")
        raise
    finally:
        if os.path.exists(warped_path):
            try:
                os.remove(warped_path)
            except Exception:
                pass


def _orthophoto_s3_key(project_id: uuid.UUID, task_id: Optional[uuid.UUID]) -> str:
    task_segment = f"{task_id}/" if task_id else ""
    return f"projects/{project_id}/{task_segment}odm/odm_orthophoto/odm_orthophoto.tif"


def reproject_orthophoto_in_place(
    project_id: uuid.UUID,
    task_id: Optional[uuid.UUID],
) -> None:
    """Pull odm_orthophoto.tif from S3, reproject to EPSG:3857 COG, overwrite the same key.

    Used for task-level preview orthophotos that are display artifacts. Do not
    use this for project-level final ODM orthophotos, which must remain in
    their native processing CRS for download and publication.
    """
    if task_id is None:
        raise OrthophotoPostProcessingError(
            "Project-level final orthophotos must not be reprojected in place"
        )

    s3_key = _orthophoto_s3_key(project_id, task_id)

    temp_dir = tempfile.mkdtemp()
    src_path = os.path.join(temp_dir, "odm_orthophoto.tif")
    out_path = os.path.join(temp_dir, "odm_orthophoto_3857.tif")

    try:
        ok = get_file_from_bucket(settings.S3_BUCKET_NAME, s3_key, src_path)
        if ok is False or not os.path.exists(src_path):
            raise OrthophotoPostProcessingError(
                f"Could not download orthophoto from s3://{settings.S3_BUCKET_NAME}/{s3_key}"
            )

        try:
            src_ds = gdal.Open(src_path)
            if src_ds is not None:
                log.info(
                    "Source ScaleODM orthophoto: size={}x{}, bands={}, "
                    "filesize={} bytes, geotransform={}, projection={}",
                    src_ds.RasterXSize,
                    src_ds.RasterYSize,
                    src_ds.RasterCount,
                    os.path.getsize(src_path),
                    src_ds.GetGeoTransform(),
                    (src_ds.GetProjection() or "(none)")[:200],
                )
                src_ds = None
            else:
                log.warning(f"GDAL could not open source ortho at {src_path}")
        except Exception as inspect_err:
            log.warning(f"Failed to inspect source ortho: {inspect_err}")

        try:
            reproject_to_web_mercator(src_path, out_path)
        except Exception as e:
            raise OrthophotoPostProcessingError(
                f"Reprojection failed for {s3_key}: {e}"
            ) from e

        try:
            out_ds = gdal.Open(out_path)
            if out_ds is not None:
                log.info(
                    "Reprojected COG orthophoto: size={}x{}, filesize={} bytes",
                    out_ds.RasterXSize,
                    out_ds.RasterYSize,
                    os.path.getsize(out_path),
                )
                out_ds = None
        except Exception:
            pass

        try:
            add_file_to_bucket(settings.S3_BUCKET_NAME, out_path, s3_key)
        except Exception as e:
            raise OrthophotoPostProcessingError(
                f"Upload of reprojected ortho failed for {s3_key}: {e}"
            ) from e

        log.info(f"Uploaded reprojected COG orthophoto to {s3_key}")

    finally:
        for path in (src_path, out_path, out_path + ".warped.tif"):
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass
        try:
            os.rmdir(temp_dir)
        except Exception:
            pass


def extract_and_upload_odm_assets(
    zip_path: str,
    temp_dir: str,
    project_id: uuid.UUID,
    task_id: Optional[uuid.UUID],
) -> bool:
    """Extract files from an ODM zip one-by-one and upload each to S3.

    Used by the manual ODM zip import flow. Uploads individual files
    under ``projects/{pid}/{tid}/odm/`` and replaces the raw orthophoto
    with an EPSG:3857 COG at
    ``projects/{pid}/{tid}/odm/odm_orthophoto/odm_orthophoto.tif``.
    """
    task_segment = f"{task_id}/" if task_id else ""
    odm_prefix = f"projects/{project_id}/{task_segment}odm/"

    existing = delete_objects_by_prefix(settings.S3_BUCKET_NAME, odm_prefix)
    if existing:
        log.info(f"Cleared {existing} existing objects under {odm_prefix}")

    ortho_member = "odm_orthophoto/odm_orthophoto.tif"
    ortho_local: str | None = None

    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.namelist():
            if member.endswith("/"):
                continue

            resolved = os.path.realpath(os.path.join(temp_dir, member))
            if not resolved.startswith(os.path.realpath(temp_dir) + os.sep):
                log.warning(f"Skipping zip member with unsafe path: {member}")
                continue

            extracted_path = zf.extract(member, temp_dir)

            if member == ortho_member:
                ortho_local = extracted_path
                continue

            s3_key = f"{odm_prefix}{member}"
            try:
                add_file_to_bucket(settings.S3_BUCKET_NAME, extracted_path, s3_key)
                log.debug(f"Uploaded ODM asset: {s3_key}")
            except Exception:
                if os.path.exists(extracted_path):
                    os.remove(extracted_path)
                raise

            os.remove(extracted_path)

    if os.path.exists(zip_path):
        os.remove(zip_path)
        log.info(f"Deleted zip {zip_path} to free disk before reprojection")

    if ortho_local and os.path.exists(ortho_local):
        try:
            src_ds = gdal.Open(ortho_local)
            if src_ds is not None:
                log.info(
                    "Source ODM orthophoto: size={}x{}, bands={}, "
                    "filesize={} bytes, geotransform={}, projection={}",
                    src_ds.RasterXSize,
                    src_ds.RasterYSize,
                    src_ds.RasterCount,
                    os.path.getsize(ortho_local),
                    src_ds.GetGeoTransform(),
                    (src_ds.GetProjection() or "(none)")[:200],
                )
                src_ds = None
            else:
                log.warning(f"GDAL could not open source ortho at {ortho_local}")
        except Exception as inspect_err:
            log.warning(f"Failed to inspect source ortho: {inspect_err}")

        reprojected_path = os.path.join(temp_dir, "odm_orthophoto_3857.tif")
        try:
            reproject_to_web_mercator(ortho_local, reprojected_path)

            try:
                out_ds = gdal.Open(reprojected_path)
                if out_ds is not None:
                    log.info(
                        "Reprojected COG orthophoto: size={}x{}, filesize={} bytes",
                        out_ds.RasterXSize,
                        out_ds.RasterYSize,
                        os.path.getsize(reprojected_path),
                    )
                    out_ds = None
            except Exception:
                pass

            s3_ortho = f"{odm_prefix}{ortho_member}"
            add_file_to_bucket(settings.S3_BUCKET_NAME, reprojected_path, s3_ortho)
            log.info(f"Uploaded reprojected COG orthophoto to {s3_ortho}")
        finally:
            if os.path.exists(ortho_local):
                os.remove(ortho_local)
            if os.path.exists(reprojected_path):
                os.remove(reprojected_path)
    else:
        raise FileNotFoundError(
            "ODM zip does not contain odm_orthophoto/odm_orthophoto.tif"
        )

    return True
