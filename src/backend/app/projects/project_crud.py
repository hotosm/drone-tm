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
        projects.short_description,
        projects.description,
        projects.author_id,
        users.name AS author_name
    FROM projects
    JOIN users ON projects.author_id = users.id
    WHERE projects.id = :project_id
    LIMIT 1;
    """

    project_record = await db.fetch_one(raw_sql, {"project_id": project_id})
    if not project_record:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project not found."
        )

    # get tasks of project
    query = """ SELECT * from tasks WHERE project_id = :project_id;"""
    task_records = await db.fetch_all(query, {"project_id": project_id})
    tasks = await convert_to_app_tasks(task_records)
    # Count the total tasks
    task_count = len(tasks)
    return {
        "project": project_record,
        "task_count": task_count,
        "tasks": tasks,
    }


async def convert_to_app_tasks(
    db_tasks: List[db_models.DbTask],
) -> List[project_schemas.TaskOut]:
    """Legacy function to convert db models --> Pydantic.

    TODO refactor to use Pydantic model methods instead.
    """
    if db_tasks and len(db_tasks) > 0:

        async def convert_task(task):
            return project_schemas.TaskOut(
                id=task.id,
                project_task_index=task.project_task_index,
                project_task_name=task.project_task_name,
                outline=task.outline
            )
        app_tasks = await gather(*[convert_task(task) for task in db_tasks])
        return [task for task in app_tasks if task is not None]
    else:
        return []


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
    return await convert_to_app_projects(db_projects)


async def convert_to_app_projects(
    db_projects: List[db_models.DbProject],
) -> List[project_schemas.ProjectOut]:
    """Legacy function to convert db models --> Pydantic.

    TODO refactor to use Pydantic model methods instead.
    """
    if db_projects and len(db_projects) > 0:

        async def convert_project(project):
            return await convert_to_app_project(project)

        app_projects = await gather(
            *[convert_project(project) for project in db_projects]
        )
        return [project for project in app_projects if project is not None]
    else:
        return []


async def convert_to_app_project(db_project: db_models.DbProject):
    """Legacy function to convert db models --> Pydantic."""
    if not db_project:
        log.debug("convert_to_app_project called, but no project provided")
        return None
    app_project = db_project

    if db_project.outline:
        app_project.outline_geojson = str_to_geojson(
            db_project.outline, {"id": db_project.id}, db_project.id
        )
    return app_project


async def convert_to_app_task(db_task: db_models.DbTask):
    """Legacy function to convert db models --> Pydantic."""
    if not db_task:
        return None
    app_task = db_task

    if app_task.outline:
        
        app_task = str_to_geojson(
            app_task.outline, {"id": app_task.id}, app_task.id
        )
    return app_task


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
