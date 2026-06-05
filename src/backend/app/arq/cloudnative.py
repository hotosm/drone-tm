"""ARQ jobs that produce web-optimized derivatives from final ODM output.

Both jobs are user-triggered via POST endpoints in ``project_routes``;
nothing here runs automatically when ODM finishes. Output paths are reused
on every re-conversion (no version segment) - if the user reprocesses and
re-converts, the new output overwrites the old one in place.

* ``generate_orthophoto_cog`` - reprojects the project-level
  ``odm_orthophoto.tif`` to EPSG:3857 and writes a Cloud-Optimized GeoTIFF
  (with overviews) suitable for direct range-request reads from a MapLibre
  client via ``@geomatico/maplibre-cog-protocol``.

* ``generate_3d_tiles`` - converts the textured OBJ output
  (``odm_texturing/odm_textured_model_geo.obj``) to 3D Tiles using the
  bundled ``Obj2Tiles`` binary, georeferencing it with the lat/lon/alt
  recorded in ``opensfm/reference_lla.json``.

The ``cloud_ortho_ready`` / ``cloud_mesh_ready`` flags short-circuit
re-runs unless ``force=True`` is passed.
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
    infer_content_type,
    list_objects_from_bucket,
    s3_object_exists,
)

# Cache headers for cloudnative outputs. Paths are reused on re-conversion
# so we can't go full "immutable"; a moderate max-age balances revalidation
# request count (matters for low-bandwidth users with hundreds of tiles per
# session) against how long a stale tile lingers after a re-convert. ETag
# revalidation handles the post-max-age case cheaply (304 if unchanged).
_CACHE_CONTROL = "public, max-age=3600"

# Path to the static Obj2Tiles binary, copied into the runtime image from
# ghcr.io/spwoodcock/obj2tiles in the Dockerfile.
OBJ2TILES_BIN = "Obj2Tiles"

# Source layout under the project's S3 prefix (matches ODM's final output tree).
_ORTHOPHOTO_KEY = "projects/{pid}/odm/odm_orthophoto/odm_orthophoto.tif"
_TEXTURING_PREFIX = "projects/{pid}/odm/odm_texturing/"
_REFERENCE_LLA_KEY = "projects/{pid}/odm/opensfm/reference_lla.json"
_OBJ_FILE_NAME = "odm_textured_model_geo.obj"

# Columns we toggle on completion. Hardcoded list (not user input) so the
# string-formatted UPDATEs below are not an injection risk.
_READY_COLUMNS = {"cloud_ortho_ready", "cloud_mesh_ready"}
_GENERATING_COLUMNS = {"cloud_ortho_generating", "cloud_mesh_generating"}


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


async def _set_ready_flag(db_pool: Any, project_id: uuid.UUID, column: str) -> None:
    """Mark a cloud_*_ready flag true.

    Gated on ``image_processing_status = 'SUCCESS'`` to defend against the
    stale-job-after-reprocess race: if the user reprocesses ODM while a
    conversion worker is still running, the worker's source files are now
    half-overwritten and its output is suspect. The reprocess UPDATE has
    already flipped status to PROCESSING and reset both flags, so this
    UPDATE becomes a no-op and the UI correctly shows "Convert" rather than
    "View" until the user re-triggers after the new ODM run completes.
    """
    if column not in _READY_COLUMNS:
        raise ValueError(f"Unknown ready column: {column}")
    async with db_pool.connection() as conn:
        await conn.execute(
            f"UPDATE projects SET {column} = true "
            "WHERE id = %(pid)s AND image_processing_status = 'SUCCESS'",
            {"pid": project_id},
        )
        await conn.commit()


async def _clear_ready_flag(db_pool: Any, project_id: uuid.UUID, column: str) -> None:
    """Mark a cloud_*_ready flag false.

    Used by the 3D worker before its destructive delete-then-upload so a
    failed regen doesn't leave the UI pointing at an emptied tile prefix.
    Unconditional (no SUCCESS gate); we *want* to clear stale state.
    """
    if column not in _READY_COLUMNS:
        raise ValueError(f"Unknown ready column: {column}")
    async with db_pool.connection() as conn:
        await conn.execute(
            f"UPDATE projects SET {column} = false WHERE id = %(pid)s",
            {"pid": project_id},
        )
        await conn.commit()


async def _clear_generating_flag(
    db_pool: Any, project_id: uuid.UUID, column: str
) -> None:
    """Best-effort clear of a cloud_*_generating flag in the job's finally.

    Wrapped so a DB hiccup at the end of a long job is logged rather than
    raised - the user can always retry from the UI if the flag is stuck.
    """
    if column not in _GENERATING_COLUMNS:
        raise ValueError(f"Unknown generating column: {column}")
    try:
        async with db_pool.connection() as conn:
            await conn.execute(
                f"UPDATE projects SET {column} = false WHERE id = %(pid)s",
                {"pid": project_id},
            )
            await conn.commit()
    except Exception as e:
        log.warning("Failed to clear {} for project {}: {}", column, project_id, e)


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
    # --lods 8: keep the full 8-level decimation pyramid so the viewer can
    #   reach finer detail when a user zooms in. Lower would shrink the
    #   output but cap inspection zoom.
    # --divisions 2: spatial split factor per axis. Obj2Tiles' default
    #   produces ~half as many tiles as our previous --divisions 3 setting,
    #   which means fewer HTTP round-trips through the proxy and bigger
    #   payloads per request - better for users on flaky/slow links where
    #   per-request overhead dominates.
    cmd = [
        OBJ2TILES_BIN,
        "--lods",
        "8",
        "--divisions",
        "2",
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
    """Upload every file under ``local_dir`` to ``s3://bucket/{prefix}/...``.

    Sets per-file Content-Type (so browsers parse tileset.json as JSON, GLBs
    as model/gltf-binary, etc.) and the immutable cache header. Both are
    needed for direct-from-S3/CDN serving to behave correctly.
    """
    count = 0
    for path in local_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(local_dir).as_posix()
        key = f"{prefix}/{rel}"
        add_file_to_bucket(
            settings.S3_BUCKET_NAME,
            str(path),
            key,
            content_type=infer_content_type(path.name),
            cache_control=_CACHE_CONTROL,
        )
        count += 1
    return count


async def generate_orthophoto_cog(
    ctx: Dict[Any, Any],
    *,
    project_id: str,
    force: bool = False,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Produce a web-mercator COG from the project-level orthophoto.

    Writes to a stable per-project key; re-conversion overwrites the prior
    output in place. ``cloud_ortho_generating`` is cleared in a finally so
    the UI returns to a Convert/View terminal state on every exit path.
    """
    pid = uuid.UUID(project_id)
    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("db_pool missing from arq ctx")

    try:
        if not force and await _get_ready_flag(db_pool, pid, "cloud_ortho_ready"):
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
                add_file_to_bucket,
                settings.S3_BUCKET_NAME,
                str(dst_path),
                dst_key,
                content_type="image/tiff",
                cache_control=_CACHE_CONTROL,
            )

        await _set_ready_flag(db_pool, pid, "cloud_ortho_ready")
        log.info("COG ready for project {}", pid)
        return {"status": "completed", "project_id": project_id, "cog_key": dst_key}
    finally:
        await _clear_generating_flag(db_pool, pid, "cloud_ortho_generating")


async def generate_3d_tiles(
    ctx: Dict[Any, Any],
    *,
    project_id: str,
    force: bool = False,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Produce a 3D Tiles tree from the project-level textured OBJ output.

    Writes to a stable per-project prefix; the prior tree is wiped before
    upload so the new tileset.json is consistent with the new tile files.
    ``cloud_mesh_generating`` is cleared in a finally on every exit path.
    """
    pid = uuid.UUID(project_id)
    db_pool = ctx.get("db_pool")
    if not db_pool:
        raise RuntimeError("db_pool missing from arq ctx")

    try:
        if not force and await _get_ready_flag(db_pool, pid, "cloud_mesh_ready"):
            log.info("3D tiles already ready for project {}; skipping", pid)
            return {"status": "skipped", "reason": "already_ready"}

        # No final_output gate here: ODM always generates the textured mesh
        # unless explicitly disabled, and the file's existence in S3 is the
        # true gate (checked via source_missing below).
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

            # Mark not-ready *before* wiping the tile tree so that a
            # failure during upload leaves the project in a "Convert" UI
            # state rather than a "View" state pointing at an empty
            # prefix. Restored by _set_ready_flag below on success.
            # Only relevant for force=True / admin re-runs - first-time
            # generation comes in with ready already false.
            await _clear_ready_flag(db_pool, pid, "cloud_mesh_ready")

            # Wipe the existing tile tree before re-uploading. The new
            # tileset.json references new tile filenames; leaving stragglers
            # behind would waste S3 storage and confuse anyone debugging.
            # Trailing slash so a sibling prefix is never matched.
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

        await _set_ready_flag(db_pool, pid, "cloud_mesh_ready")
        log.info("3D tiles ready for project {}", pid)
        return {
            "status": "completed",
            "project_id": project_id,
            "tiles_prefix": tiles_prefix,
        }
    finally:
        await _clear_generating_flag(db_pool, pid, "cloud_mesh_generating")
