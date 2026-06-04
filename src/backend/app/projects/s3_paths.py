"""S3 object key conventions for project artefacts.

Centralizes the path layout so route handlers, arq jobs, and admin scripts agree
on where things live in the bucket. Web-optimized output formats sit under
``projects/{pid}/cloudnative/`` so they can be added/extended without colliding
with the raw ODM output tree at ``projects/{pid}/``.
"""

import uuid


def cloudnative_3d_tiles_prefix(project_id: uuid.UUID | str) -> str:
    """Prefix for the 3D Tiles tree (tileset.json + .b3dm/.glb/...)."""
    return f"projects/{project_id}/cloudnative/3d-tiles"


def cloudnative_3d_tile_key(project_id: uuid.UUID | str, file_path: str) -> str:
    """S3 key for a single tile file under the 3D tiles tree."""
    return f"{cloudnative_3d_tiles_prefix(project_id)}/{file_path}"


def cloudnative_cog_prefix(project_id: uuid.UUID | str) -> str:
    """Prefix for COG outputs."""
    return f"projects/{project_id}/cloudnative/cog"


def cloudnative_orthophoto_cog_key(project_id: uuid.UUID | str) -> str:
    """S3 key for the web-mercator orthophoto COG."""
    return f"{cloudnative_cog_prefix(project_id)}/orthophoto.tif"
