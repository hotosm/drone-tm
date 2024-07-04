import json
from typing import List, Optional
from app.projects import project_schemas
from app.db import db_models
from loguru import logger as log
import shapely.wkb as wkblib
from shapely.geometry import shape
from fastapi import HTTPException
from app.utils import merge_multipolygon, str_to_geojson
from fmtm_splitter.splitter import split_by_square
from fastapi.concurrency import run_in_threadpool
from app.db import database
from fastapi import Depends
from asyncio import gather
from app.models.enums import HTTPStatus
from databases import Database

async def create_project_with_project_info(
    db: Database, project_metadata: project_schemas.ProjectIn
):
    """Create a project in database."""
    query = """
        INSERT INTO projects (
            author_id, name, short_description, description, per_task_instructions, status, visibility, mapper_level, priority, outline, created
        )
        VALUES (
            :author_id,
            :name,
            :short_description,
            :description,
            :per_task_instructions,
            :status,
            :visibility,
            :mapper_level,
            :priority,
            :outline,
            CURRENT_TIMESTAMP
        )
        RETURNING id
    """
    new_project_id = await db.execute(query, values = {
        "author_id": 1,
        "name": project_metadata.name,
        "short_description": project_metadata.short_description,
        "description": project_metadata.description,
        "per_task_instructions": project_metadata.per_task_instructions,
        "status": "DRAFT",
        "visibility": "PUBLIC",
        "mapper_level": "INTERMEDIATE",
        "priority": "MEDIUM",
        "outline": str(project_metadata.outline),
    })

    if not new_project_id:
        raise HTTPException(status_code=500, detail="Project could not be created")
    # Fetch the newly created project using the returned ID
    select_query = """
        SELECT id, name, short_description, description, per_task_instructions, outline
        FROM projects
        WHERE id = :new_project_id
    """
    
    new_project = await db.fetch_one(select_query,{"new_project_id": new_project_id})
    return new_project


async def get_project_by_id(
    db: Database = Depends(database.encode_db), project_id: Optional[int] = None
):
    """Get a single project &  all associated tasks by ID."""
    # check the project in Database
    raw_sql = """
    SELECT
        projects.id,
        projects.name,
        projects.short_description,
        projects.description,
        projects.per_task_instructions,
        projects.author_id,
        projects.outline,
        users.name AS author_name
    FROM projects
    JOIN users ON projects.author_id = users.id
    WHERE projects.id = :project_id
    LIMIT 1;
    """

    project_record = await db.fetch_one(raw_sql, {"project_id": project_id})
    query = """ SELECT * from tasks WHERE project_id = :project_id;"""
    task_records = await db.fetch_all(query, {"project_id": project_id})
   
    return  {
        "id": project_record["id"],
        "name": project_record["name"],
        "short_description": project_record["short_description"],
        "description": project_record["description"],
        "per_task_instructions": project_record["per_task_instructions"],
        "outline": project_record["outline"],
        "tasks": task_records,
        "task_count": len(task_records)
    }


async def get_projects(
    db: Database,
    skip: int = 0,
    limit: int = 100,
):
    """Get all projects."""
    raw_sql = """
        SELECT id, name, short_description, description, per_task_instructions, outline
        FROM projects
        ORDER BY id DESC
        OFFSET :skip
        LIMIT :limit;
        """
    db_projects = await db.fetch_all(raw_sql, {"skip": skip, "limit": limit})
    return db_projects


async def create_tasks_from_geojson(
    db: Database,
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
            query = """
                INSERT INTO tasks (project_id, outline, project_task_index)
                VALUES (:project_id, :outline, :project_task_index);"""
                
            result = await db.execute(query, values = {
                "project_id": project_id,
                "outline": wkblib.dumps(shape(polygon["geometry"]), hex=True),
                "project_task_index": index + 1,
            })
            if result:
                log.debug(
                    "Created database task | "
                    f"Project ID {project_id} | "
                    f"Task index {index}"
                )
                log.debug(
                    "COMPLETE: creating project boundary, based on task boundaries"
                )
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
