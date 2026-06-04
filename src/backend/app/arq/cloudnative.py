"""ARQ jobs that produce web-optimized derivatives from final ODM output.

Two jobs run per project once final processing succeeds:

* ``generate_orthophoto_cog`` — reprojects the project-level
  ``odm_orthophoto.tif`` to EPSG:3857 and writes a Cloud-Optimized GeoTIFF
  (with overviews) suitable for direct range-request reads from a MapLibre
  client via ``@geomatico/maplibre-cog-protocol``.

* ``generate_3d_tiles`` — converts the textured OBJ output
  (``odm_texturing/odm_textured_model_geo.obj``) to 3D Tiles using the
  bundled ``Obj2Tiles`` binary, georeferencing it with the lat/lon/alt
  recorded in ``opensfm/reference_lla.json``.

Both jobs are idempotent — the ``cog_ready`` / ``tiles_ready`` flags on the
project act as a "done" marker. Re-running with ``force=True`` overwrites the
S3 outputs (used by the admin backfill script).
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict

from loguru import logger as log
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles

from app.config import settings
from app.projects.s3_paths import (
    cloudnative_3d_tiles_prefix,
    cloudnative_orthophoto_cog_key,
)
from app.s3 import (
    add_file_to_bucket,
    delete_objects_by_prefix,
    get_file_from_bucket,
    list_objects_from_bucket,
    s3_object_exists,
)

# Path to the static Obj2Tiles binary, copied into the runtime image from
# ghcr.io/spwoodcock/obj2tiles in the Dockerfile.
OBJ2TILES_BIN = "Obj2Tiles"

# Source layout under the project's S3 prefix (matches ODM's final output tree).
_ORTHOPHOTO_KEY = "projects/{pid}/odm/odm_orthophoto/odm_orthophoto.tif"
_TEXTURING_PREFIX = "projects/{pid}/odm/odm_texturing/"
_REFERENCE_LLA_KEY = "projects/{pid}/odm/opensfm/reference_lla.json"
_OBJ_FILE_NAME = "odm_textured_model_geo.obj"

# Columns we toggle on completion. Hardcoded list (not user input) so the
# string-formatted UPDATE below is not an injection risk.
_READY_COLUMNS = {"cog_ready", "tiles_ready"}


async def _get_ready_flag(db_pool: Any, project_id: uuid.UUID, column: str) -> bool:
    if column not in _READY_COLUMNS:
        raise ValueError(f"Unknown ready column: {column}")
    async with db_pool.connection() as conn:
        cur = await conn.execute(
            f"SELECT {column} FROM projects WHERE id = %(pid)s",
            {"pid": project_id},
        )
        row = await cur.fetchone()
        return bool(row[0]) if row else False


async def _set_ready_flag(
    db_pool: Any, project_id: uuid.UUID, column: str, value: bool
) -> None:
    if column not in _READY_COLUMNS:
        raise ValueError(f"Unknown ready column: {column}")
    async with db_pool.connection() as conn:
        await conn.execute(
            f"UPDATE projects SET {column} = %(value)s WHERE id = %(pid)s",
            {"value": value, "pid": project_id},
        )
        await conn.commit()


def _generate_cog(src_path: Path, dst_path: Path) -> None:
    """Reproject orthophoto to EPSG:3857 and write as a COG with overviews.

    ``web_optimized=True`` reprojects to web-mercator and aligns the output to
    the web-mercator tiling grid (power-of-2 sizes), which keeps overview
    generation cheap and matches what tile-aware clients expect.
    """
    profile = cog_profiles.get("deflate")
    cog_translate(
        str(src_path),
        str(dst_path),
        profile,
        web_optimized=True,
        in_memory=False,
        forward_band_tags=True,
        quiet=True,
    )


def _run_obj2tiles(
    obj_path: Path, output_dir: Path, lat: float, lon: float, alt: float
) -> None:
    cmd = [
        OBJ2TILES_BIN,
        "--lods",
        "8",
        "--divisions",
        "3",
        "--lat",
        str(lat),
        "--lon",
        str(lon),
        "--alt",
        str(alt),
        str(obj_path),
        str(output_dir),
    ]
    log.info("Running Obj2Tiles: {}", " ".join(cmd))
    result = subprocess.run(
        cmd,
        cwd=str(obj_path.parent),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        log.error("Obj2Tiles stderr: {}", result.stderr)
        raise RuntimeError(
            f"Obj2Tiles exited {result.returncode}: {result.stderr[:1000]}"
        )
    if result.stdout:
        log.debug("Obj2Tiles stdout: {}", result.stdout[:1000])


def _download_prefix_to_dir(prefix: str, local_dir: Path) -> int:
    """Mirror an S3 prefix into a local directory; returns file count."""
    count = 0
    for obj in list_objects_from_bucket(settings.S3_BUCKET_NAME, prefix):
        key = obj.object_name
        if not key.startswith(prefix):
            continue
        rel = key[len(prefix) :]
        if not rel or rel.endswith("/"):
            continue
        dest = local_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        get_file_from_bucket(settings.S3_BUCKET_NAME, key, str(dest))
        count += 1
    return count


def _upload_tree_to_prefix(local_dir: Path, prefix: str) -> int:
    """Upload every file under ``local_dir`` to ``s3://bucket/{prefix}/...``."""
    count = 0
    for path in local_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(local_dir).as_posix()
        key = f"{prefix}/{rel}"
        add_file_to_bucket(settings.S3_BUCKET_NAME, str(path), key)
        count += 1
    return count


async def generate_orthophoto_cog(
    ctx: Dict[Any, Any],
    *,
    project_id: str,
    force: bool = False,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Produce a web-mercator COG from the project-level orthophoto."""
    pid = uuid.UUID(project_id)
    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("db_pool missing from arq ctx")

    if not force and await _get_ready_flag(db_pool, pid, "cog_ready"):
        log.info("COG already ready for project {}; skipping", pid)
        return {"status": "skipped", "reason": "already_ready"}

    src_key = _ORTHOPHOTO_KEY.format(pid=pid)
    dst_key = cloudnative_orthophoto_cog_key(pid)

    src_exists = await asyncio.to_thread(
        s3_object_exists, settings.S3_BUCKET_NAME, src_key
    )
    if not src_exists:
        log.warning(
            "Orthophoto missing at s3://{}/{}; cannot generate COG",
            settings.S3_BUCKET_NAME,
            src_key,
        )
        return {"status": "skipped", "reason": "source_missing"}

    with tempfile.TemporaryDirectory(prefix="cog-") as tmp:
        tmp_path = Path(tmp)
        src_path = tmp_path / "orthophoto.tif"
        dst_path = tmp_path / "orthophoto_cog.tif"

        log.info("Downloading orthophoto for project {}", pid)
        await asyncio.to_thread(
            get_file_from_bucket, settings.S3_BUCKET_NAME, src_key, str(src_path)
        )

        log.info("Converting to web-mercator COG for project {}", pid)
        await asyncio.to_thread(_generate_cog, src_path, dst_path)

        log.info("Uploading COG to {}", dst_key)
        await asyncio.to_thread(
            add_file_to_bucket, settings.S3_BUCKET_NAME, str(dst_path), dst_key
        )

    await _set_ready_flag(db_pool, pid, "cog_ready", True)
    log.info("COG ready for project {}", pid)
    return {"status": "completed", "project_id": project_id, "cog_key": dst_key}


async def generate_3d_tiles(
    ctx: Dict[Any, Any],
    *,
    project_id: str,
    force: bool = False,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Produce a 3D Tiles tree from the project-level textured OBJ output."""
    pid = uuid.UUID(project_id)
    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("db_pool missing from arq ctx")

    if not force and await _get_ready_flag(db_pool, pid, "tiles_ready"):
        log.info("3D tiles already ready for project {}; skipping", pid)
        return {"status": "skipped", "reason": "already_ready"}

    reference_key = _REFERENCE_LLA_KEY.format(pid=pid)
    texturing_prefix = _TEXTURING_PREFIX.format(pid=pid)
    tiles_prefix = cloudnative_3d_tiles_prefix(pid)

    ref_exists = await asyncio.to_thread(
        s3_object_exists, settings.S3_BUCKET_NAME, reference_key
    )
    if not ref_exists:
        log.warning(
            "OpenSfM reference_lla.json missing at s3://{}/{}; cannot generate 3D tiles",
            settings.S3_BUCKET_NAME,
            reference_key,
        )
        return {"status": "skipped", "reason": "source_missing"}

    with tempfile.TemporaryDirectory(prefix="3d-tiles-") as tmp:
        tmp_path = Path(tmp)
        texturing_dir = tmp_path / "odm_texturing"
        output_dir = tmp_path / "output"
        ref_path = tmp_path / "reference_lla.json"

        log.info("Downloading reference_lla.json for project {}", pid)
        await asyncio.to_thread(
            get_file_from_bucket,
            settings.S3_BUCKET_NAME,
            reference_key,
            str(ref_path),
        )
        ref = json.loads(ref_path.read_text())
        try:
            lat = float(ref["latitude"])
            lon = float(ref["longitude"])
            alt = float(ref["altitude"])
        except (KeyError, TypeError, ValueError) as e:
            raise RuntimeError(
                f"Invalid reference_lla.json for project {pid}: {e}"
            ) from e

        log.info("Mirroring odm_texturing/ for project {}", pid)
        texturing_dir.mkdir(parents=True, exist_ok=True)
        downloaded = await asyncio.to_thread(
            _download_prefix_to_dir, texturing_prefix, texturing_dir
        )
        if downloaded == 0:
            log.warning(
                "No files under s3://{}/{}; cannot generate 3D tiles",
                settings.S3_BUCKET_NAME,
                texturing_prefix,
            )
            return {"status": "skipped", "reason": "no_texturing_assets"}

        obj_path = texturing_dir / _OBJ_FILE_NAME
        if not obj_path.exists():
            log.warning(
                "Expected OBJ {} not found in {}",
                _OBJ_FILE_NAME,
                texturing_dir,
            )
            return {"status": "skipped", "reason": "obj_missing"}

        output_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(_run_obj2tiles, obj_path, output_dir, lat, lon, alt)

        # Clear any stale tile tree before uploading the new one. Trailing
        # slash so we don't match sibling prefixes.
        await asyncio.to_thread(
            delete_objects_by_prefix,
            settings.S3_BUCKET_NAME,
            f"{tiles_prefix}/",
        )

        log.info("Uploading 3D tiles tree to {}", tiles_prefix)
        uploaded = await asyncio.to_thread(
            _upload_tree_to_prefix, output_dir, tiles_prefix
        )
        log.info("Uploaded {} 3D tile files for project {}", uploaded, pid)

    await _set_ready_flag(db_pool, pid, "tiles_ready", True)
    log.info("3D tiles ready for project {}", pid)
    return {
        "status": "completed",
        "project_id": project_id,
        "tiles_prefix": tiles_prefix,
    }
