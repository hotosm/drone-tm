import uuid
from app.config import settings
from fastapi import APIRouter, Depends
from app.waypoints import waypoint_schemas
from app.gcp import gcp_crud
from typing import List
from psycopg import Connection
from app.db import database
from typing import Annotated
from app.tasks.task_logic import list_task_id_for_project


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/gcp",
    tags=["gcp"],
    responses={404: {"description": "Not found"}},
)


@router.post("/find-images/")
async def find_images(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    point: waypoint_schemas.PointField = None,
) -> List[str]:
    """Find images that contain a specified point."""

    fov_degree = 82.1  # For DJI Mini 4 Pro
    altitude = 100  # TODO: Get this from db

    return await gcp_crud.find_images_in_a_task_for_point(
        project_id, task_id, point, fov_degree, altitude
    )


@router.post("/find-project-images/")
async def find_images_for_a_project(
    project_id: uuid.UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    point: waypoint_schemas.PointField = None,
) -> List[str]:
    """Find images that contain a specified point in a project."""

    fov_degree = 82.1  # For DJI Mini 4 Pro
    altitude = 100  # TODO: Get this from db

    # Get all task IDs for the project from database
    task_id_list = await list_task_id_for_project(db, project_id)

    return await gcp_crud.find_images_in_a_project_for_point(
        project_id, task_id_list, point, fov_degree, altitude
    )
