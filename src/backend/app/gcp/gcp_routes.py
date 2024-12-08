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
    return await gcp_crud.process_images_for_point(project_id, task_id, point)
