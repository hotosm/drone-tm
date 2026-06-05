"""S3 object key conventions for project artefacts.

Centralizes the path layout so route handlers, arq jobs, and admin scripts
agree on where things live in the bucket.

Cloudnative outputs (3D tiles + orthophoto COG) sit under
``publicuploads/cloudnative/{project_id}/...`` so the browser can fetch them
directly from the public S3/CDN endpoint without going through a FastAPI
proxy. Paths are reused on every re-conversion - the user explicitly opts
into "regenerate overwrites in place" by clicking Convert; we trade a
short-lived browser-cache stale window (bounded by the Cache-Control
max-age set at upload time) for a much simpler storage layout.

Raw ODM output continues to live under ``projects/{pid}/`` and stays
private. The QField export ZIP lives under ``publicuploads/qfield/{id}.zip``
and is also tracked here so project-delete can sweep it.
"""

import uuid

from app.config import settings
from app.s3 import build_browser_object_url


def cloudnative_project_root_prefix(project_id: uuid.UUID | str) -> str:
    """Root prefix for all cloudnative artefacts of a project.

    Sweep this on project-delete to cover both the 3D tile tree and the
    COG output in one call.
    """
    return f"publicuploads/cloudnative/{project_id}"


def cloudnative_3d_tiles_prefix(project_id: uuid.UUID | str) -> str:
    """Prefix for the 3D Tiles tree (tileset.json + tile binaries)."""
    return f"{cloudnative_project_root_prefix(project_id)}/3d-tiles"


def cloudnative_3d_tile_key(project_id: uuid.UUID | str, file_path: str) -> str:
    """S3 key for a single tile file under the 3D tiles tree."""
    return f"{cloudnative_3d_tiles_prefix(project_id)}/{file_path}"


def cloudnative_cog_prefix(project_id: uuid.UUID | str) -> str:
    """Prefix for COG outputs."""
    return f"{cloudnative_project_root_prefix(project_id)}/cog"


def cloudnative_orthophoto_cog_key(project_id: uuid.UUID | str) -> str:
    """S3 key for the web-mercator orthophoto COG."""
    return f"{cloudnative_cog_prefix(project_id)}/orthophoto.tif"


def cloudnative_3d_tileset_browser_url(project_id: uuid.UUID | str) -> str:
    """Direct browser URL for the 3D Tiles entry point (tileset.json)."""
    key = cloudnative_3d_tile_key(project_id, "tileset.json")
    return build_browser_object_url(settings.S3_BUCKET_NAME, key)


def cloudnative_orthophoto_cog_browser_url(project_id: uuid.UUID | str) -> str:
    """Direct browser URL for the orthophoto COG."""
    key = cloudnative_orthophoto_cog_key(project_id)
    return build_browser_object_url(settings.S3_BUCKET_NAME, key)


def public_qfield_zip_key(project_id: uuid.UUID | str) -> str:
    """S3 key for the QField export ZIP (single object per project)."""
    return f"publicuploads/qfield/{project_id}.zip"
