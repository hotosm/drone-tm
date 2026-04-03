"""Dependencies for Project endpoints."""

import json
from typing import Annotated
from uuid import UUID

import geojson as geojson_lib
from fastapi import Depends, File, HTTPException, Path, UploadFile
from geojson import FeatureCollection
from geojson_aoi import parse_aoi_async
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

from app.db import database
from app.models.enums import HTTPStatus
from app.projects.project_schemas import DbProject
from app.utils import multipolygon_to_polygon


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
        raise HTTPException(status_code=HTTPStatus.FORBIDDEN) from e


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
) -> geojson_lib.FeatureCollection:
    """Normalise an uploaded AOI GeoJSON to a single-polygon FeatureCollection.

    Accepts any GeoJSON type (Polygon, MultiPolygon, Feature,
    FeatureCollection, GeometryCollection) and returns a FeatureCollection
    containing one merged Polygon.

    Uses geojson-aoi-parser for PostGIS-based normalisation (z-removal,
    polygon orientation, type coercion) with merge=True to combine
    multiple features into a single polygon via ST_UnaryUnion.
    """
    file_ext = (project_geojson.filename or "").rsplit(".", 1)[-1].lower()
    if file_ext not in ("geojson", "json"):
        raise HTTPException(status_code=400, detail="Provide a valid .geojson file")

    content = await project_geojson.read()

    try:
        featcol = await parse_aoi_async(db, content, merge=True)
    except Exception as e:
        log.warning(f"geojson-aoi-parser failed: {e}")
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            detail=f"Invalid GeoJSON: {e}",
        ) from e

    features = featcol.get("features", [])
    if not features:
        raise HTTPException(status_code=400, detail="GeoJSON contains no geometries")

    feature_geom_types = {
        feature.get("geometry", {}).get("type")
        for feature in features
        if feature.get("geometry")
    }

    # Merge multipart AOIs into a single polygon via PostGIS.
    # geojson-aoi-parser currently normalizes structure, but may still return
    # either multiple features or a single MultiPolygon geometry.
    # Once merge=True guarantees a single Polygon this block can be removed.
    if len(features) > 1 or "MultiPolygon" in feature_geom_types:
        geom_jsons = [json.dumps(f["geometry"]) for f in features]
        async with db.cursor() as cur:
            await cur.execute(
                """
                SELECT ST_AsGeoJSON(
                    CASE
                        WHEN ST_GeometryType(merged_geom) = 'ST_MultiPolygon'
                            THEN ST_ConvexHull(merged_geom)
                        ELSE merged_geom
                    END
                )
                FROM (
                    SELECT ST_UnaryUnion(ST_Collect(ST_GeomFromGeoJSON(geom))) AS merged_geom
                    FROM unnest(%s::text[]) AS geom
                ) merged
                """,
                (geom_jsons,),
            )
            row = await cur.fetchone()
            if row and row[0]:
                featcol = geojson_lib.FeatureCollection(
                    [geojson_lib.Feature(geometry=json.loads(row[0]))]
                )

    return featcol
