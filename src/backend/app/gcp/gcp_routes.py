import uuid
from app.config import settings
from fastapi import APIRouter
from app.waypoints import waypoint_schemas
from app.gcp import gcp_crud
from typing import List


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/gcp",
    tags=["gcp"],
    responses={404: {"description": "Not found"}},
)


@router.post("/find-images")
async def find_images(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    point: waypoint_schemas.PointField = None,
) -> List[str]:
    """Find images that contain a specified point."""
    fov_degree = 82.1  # For DJI Mini 4 Pro
    altitude = 100  # TODO: Get this from db
    return await gcp_crud.process_images_for_point(
        project_id, task_id, point, fov_degree, altitude
    )
