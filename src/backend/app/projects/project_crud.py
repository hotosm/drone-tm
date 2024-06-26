import json
from sqlalchemy.orm import Session
from app.projects import project_schemas
from app.db import db_models
from loguru import logger as log
import shapely.wkb as wkblib
from shapely.geometry import shape
from fastapi import HTTPException
from app.utils import merge_multipolygon
from fmtm_splitter.splitter import split_by_square
from fastapi.concurrency import run_in_threadpool


async def create_project_with_project_info(
    db: Session, project_metadata: project_schemas.ProjectIn
):
    """Create a project in database."""
    db_project = db_models.DbProject(
        author_id=1, **project_metadata.model_dump(exclude=["outline_geojson"])
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


async def create_tasks_from_geojson(
    db: Session,
    project_id: int,
    boundaries: str,
):
    """Create tasks for a project, from provided task boundaries."""
    try:
        if isinstance(boundaries, str):
            boundaries = json.loads(boundaries)

        # Update the boundary polyon on the database.
        if boundaries["type"] == "Feature":
            polygons = [boundaries]
        else:
            polygons = boundaries["features"]
        log.debug(f"Processing {len(polygons)} task geometries")
        for index, polygon in enumerate(polygons):
            # If the polygon is a MultiPolygon, convert it to a Polygon
            if polygon["geometry"]["type"] == "MultiPolygon":
                log.debug("Converting MultiPolygon to Polygon")
                polygon["geometry"]["type"] = "Polygon"
                polygon["geometry"]["coordinates"] = polygon["geometry"]["coordinates"][
                    0
                ]
            values={
                "project_id": project_id,
                "outline": wkblib.dumps(shape(polygon["geometry"]), hex=True),
                "project_task_index": index + 1,
            }    
            query = """ INSERT INTO tasks (project_id,outline,project_task_index) VALUES ( :project_id, :outline, :project_task_index);"""
            
            await db.execute(query, values=values)
            # db.add(db_task)
            log.debug(
                "Created database task | "
                f"Project ID {project_id} | "
                f"Task index {index}"
            )
        log.debug("COMPLETE: creating project boundary, based on task boundaries")

        return True
    except Exception as e:
        log.exception(e)
        raise HTTPException(e) from e


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
