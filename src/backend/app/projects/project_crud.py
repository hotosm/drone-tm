import json
import uuid
from typing import Optional
from app.projects import project_schemas
from loguru import logger as log
import shapely.wkb as wkblib
from shapely.geometry import shape
from fastapi import HTTPException
from app.utils import merge_multipolygon
from fmtm_splitter.splitter import split_by_square
from fastapi.concurrency import run_in_threadpool
from databases import Database
from app.models.enums import ProjectStatus


async def create_project_with_project_info(
    db: Database, author_id: uuid.UUID, project_metadata: project_schemas.ProjectIn
):
    """Create a project in database."""
    _id = uuid.uuid4()
    query = """
        INSERT INTO projects (
            id, author_id, name, description, per_task_instructions, status, visibility, outline, no_fly_zones, dem_url, output_orthophoto_url, output_pointcloud_url, output_raw_url, task_split_dimension, deadline_at, created_at)
        VALUES (
            :id,
            :author_id,
            :name,
            :description,
            :per_task_instructions,
            :status,
            :visibility,
            :outline,
            :no_fly_zones,
            :dem_url,
            :output_orthophoto_url,
            :output_pointcloud_url,
            :output_raw_url,
            :task_split_dimension,
            :deadline_at,
            CURRENT_TIMESTAMP
        )
        RETURNING id
    """
    try:
        project_id = await db.execute(
            query,
            values={
                "id": _id,
                "author_id": author_id,
                "name": project_metadata.name,
                "description": project_metadata.description,
                "per_task_instructions": project_metadata.per_task_instructions,
                "status": ProjectStatus.DRAFT.name,
                "visibility": project_metadata.visibility.name,
                "outline": str(project_metadata.outline),
                "no_fly_zones": str(project_metadata.no_fly_zones)
                if project_metadata.no_fly_zones is not None
                else None,
                "dem_url": project_metadata.dem_url,
                "output_orthophoto_url": project_metadata.output_orthophoto_url,
                "output_pointcloud_url": project_metadata.output_pointcloud_url,
                "output_raw_url": project_metadata.output_raw_url,
                "task_split_dimension": project_metadata.task_split_dimension,
                "deadline_at": project_metadata.deadline_at,
            },
        )
        return project_id

    except Exception as e:
        log.exception(e)
        raise HTTPException(e) from e


async def get_project_by_id(
    db: Database, author_id: uuid.UUID, project_id: Optional[int] = None
):
    """Get a single project &  all associated tasks by ID."""
    raw_sql = """
    SELECT
        projects.id,
        projects.name,
        projects.description,
        projects.per_task_instructions,
        projects.outline
    FROM projects
    WHERE projects.author_id = :author_id
    LIMIT 1;
    """

    project_record = await db.fetch_one(raw_sql, {"author_id": author_id})
    query = """
    SELECT
        tasks.id As id,
        tasks.project_task_index AS project_task_index,
        tasks.outline AS outline,
        task_events.state AS state,
        users.name AS contributor

    FROM tasks
    LEFT JOIN task_events ON tasks.id = task_events.task_id
    LEFT JOIN users ON task_events.user_id = users.id
    WHERE tasks.project_id = :project_id;
    """

    task_records = await db.fetch_all(query, {"project_id": project_id})
    project_record.tasks = task_records
    project_record.task_count = len(task_records)
    return project_record


async def get_projects(
    db: Database,
    skip: int = 0,
    limit: int = 100,
):
    """Get all projects."""
    raw_sql = """
        SELECT id, name, description, per_task_instructions, outline
        FROM projects
        ORDER BY created_at DESC
        OFFSET :skip
        LIMIT :limit;
        """
    db_projects = await db.fetch_all(raw_sql, {"skip": skip, "limit": limit})

    return db_projects


async def create_tasks_from_geojson(
    db: Database,
    project_id: uuid.UUID,
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
            try:
                # If the polygon is a MultiPolygon, convert it to a Polygon
                if polygon["geometry"]["type"] == "MultiPolygon":
                    log.debug("Converting MultiPolygon to Polygon")
                    polygon["geometry"]["type"] = "Polygon"
                    polygon["geometry"]["coordinates"] = polygon["geometry"][
                        "coordinates"
                    ][0]

                task_id = str(uuid.uuid4())
                query = """
                    INSERT INTO tasks (id, project_id, outline, project_task_index)
                    VALUES (:id, :project_id, :outline, :project_task_index);"""

                result = await db.execute(
                    query,
                    values={
                        "id": task_id,
                        "project_id": project_id,
                        "outline": wkblib.dumps(shape(polygon["geometry"]), hex=True),
                        "project_task_index": index + 1,
                    },
                )

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
