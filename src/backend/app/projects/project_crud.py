import json
import uuid
from loguru import logger as log
from fastapi import HTTPException
from fmtm_splitter.splitter import split_by_square
from fastapi.concurrency import run_in_threadpool
from psycopg import Connection
from geojson_pydantic import FeatureCollection
from app.models.enums import HTTPStatus
from app.utils import merge_multipolygon

async def update_project_dem_url(db: Connection, project_id: uuid.UUID, dem_url: str):
    """Update the DEM URL for a project."""
   
    async with db.cursor() as cur:
        await cur.execute("""
            UPDATE projects
            SET dem_url = %(dem_url)s
            WHERE id = %(project_id)s""", {"dem_url": dem_url, "project_id": project_id})
    
    return True

async def create_tasks_from_geojson(
    db: Connection,
    project_id: uuid.UUID,
    boundaries: FeatureCollection,
):
    """Create tasks for a project, from provided task boundaries."""
    # TODO this should probably drop existing boundaries before creating new?
    try:
        polygons = boundaries["features"]
        log.debug(f"Processing {len(polygons)} task geometries")

        # Prepare the data for bulk insert
        task_data = [
            (project_id, index + 1, json.dumps(polygon["geometry"]))
            for index, polygon in enumerate(polygons)
        ]

        # Perform bulk insert
        async with db.cursor() as cur:
            await cur.executemany(
                """
                INSERT INTO tasks (id, project_id, project_task_index, outline)
                VALUES (
                    gen_random_uuid(),
                    (%s),
                    (%s),
                    ST_GeomFromGeoJSON(%s)
                );
                """,
                task_data,
            )

        log.debug(f"Created database tasks for project ID {project_id}")
        return True

    except Exception as e:
        log.exception(e)
        raise HTTPException(status_code=HTTPStatus.UNPROCESSABLE_ENTITY, detail=str(e))


async def preview_split_by_square(boundary: str, meters: int):
    """Preview split by square for a project boundary.

    Use a lambda function to remove the "z" dimension from each
    coordinate in the feature's geometry.
    """
    boundary = merge_multipolygon(boundary)

    return await run_in_threadpool(
        lambda: split_by_square(
            boundary,
            meters=meters,
        )
    )
