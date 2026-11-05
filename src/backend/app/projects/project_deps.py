"""Dependencies for Project endpoints."""

import json
from typing import Annotated
from uuid import UUID

import geojson as geojson_lib
import psycopg
from app.db import database
from app.db.enums import HTTPStatus
from app.projects.project_schemas import DbProject
from app.utils import multipolygon_to_polygon
from fastapi import Depends, File, Form, HTTPException, Path, UploadFile
from geojson import FeatureCollection
from geojson_aoi import parse_aoi_async
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row


async def get_tasks_by_project_id(project_id: UUID, db: Connection):
    """Get tasks by project id."""
    try:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """SELECT id FROM tasks WHERE project_id = %(project_id)s""",
                {"project_id": project_id},
            )

            data = await cur.fetchall()

            if data is None:
                raise HTTPException(
                    status_code=HTTPStatus.FORBIDDEN,
                    detail="No tasks found for this project.",
                )
            return data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def get_project_by_id(
    project_id: Annotated[
        str,
        Path(
            description="The project ID (UUID) or slug.",
        ),
    ],
    db: Annotated[Connection, Depends(database.get_db)],
) -> DbProject:
    """Get a single project by id or slug."""
    try:
        # Try UUID first (str() handles callers that pass a UUID object)
        parsed_id = UUID(str(project_id))
        return await DbProject.one(db, parsed_id)
    except (ValueError, KeyError):
        pass
    # Fall back to slug lookup
    try:
        return await DbProject.one_by_slug(db, project_id)
    except KeyError as e:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN,
            detail=f"Project with ID or slug {project_id} not found.",
        ) from e


async def geojson_upload(
    geojson: Annotated[
        UploadFile,
        File(
            description="A GeoJSON file.",
        ),
    ],
) -> FeatureCollection:
    """Normalise a geojson upload to a FeatureCollection.

    MultiPolygons will be exploded into Polygon features.
    """
    log.debug("Reading geojson data from uploaded file")
    bytes_data = await geojson.read()

    try:
        task_boundaries = json.loads(bytes_data)
        geojson_data = multipolygon_to_polygon(task_boundaries)

    except json.decoder.JSONDecodeError as e:
        msg = "Failed to read uploaded GeoJSON file. Is it valid?"
        log.warning(msg)
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY, detail=msg
        ) from e

    return geojson_data


async def normalize_aoi(
    db: Annotated[Connection, Depends(database.get_db)],
    project_geojson: UploadFile = File(...),
    merge: bool = Form(False),
) -> geojson_lib.FeatureCollection:
    """Normalise an uploaded AOI GeoJSON to a FeatureCollection of Polygons.

    Accepts any GeoJSON type (Polygon, MultiPolygon, Feature,
    FeatureCollection, GeometryCollection). Disjoint areas stay as separate
    Polygons, unless merge is set, which joins them by their convex hull.

    Holes are dropped, as no-fly zones are uploaded separately.
    """
    file_ext = (project_geojson.filename or "").rsplit(".", 1)[-1].lower()
    if file_ext not in ("geojson", "json"):
        raise HTTPException(status_code=400, detail="Provide a valid .geojson file")

    content = await project_geojson.read()

    try:
        featcol = await parse_aoi_async(db, content, merge=merge)
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
        log.warning(f"Could not read uploaded AOI: {e}")
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            detail="The file could not be read as GeoJSON.",
        ) from e
    except ValueError as e:
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY, detail=str(e)
        ) from e
    except psycopg.Error as e:
        log.warning(f"PostGIS rejected uploaded AOI: {e}")
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            detail="The AOI contains invalid geometry. Please fix it and retry.",
        ) from e

    for feature in featcol["features"]:
        feature["geometry"]["coordinates"] = feature["geometry"]["coordinates"][:1]

    return featcol
