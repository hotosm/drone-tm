import os
import tempfile
import uuid
from typing import Annotated, List

from fastapi import APIRouter, Depends, File, UploadFile
from loguru import logger as log
from psycopg import Connection

from app.config import settings
from app.db import database
from app.gcp import gcp_crud
from app.projects import project_deps, project_schemas
from app.s3 import add_file_to_bucket
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.waypoints import waypoint_schemas

router = APIRouter(
    prefix="/gcp",
    tags=["gcp"],
    responses={404: {"description": "Not found"}},
)


@router.post("/find-project-images/")
async def find_images_for_a_project(
    project_id: uuid.UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    point: waypoint_schemas.PointField = None,
) -> List[str]:
    """Find images whose footprint contains a GCP point.

    Uses PostGIS spatial query on the project_images table to find images
    near the given coordinate, then filters by computed footprint intersection.
    Returns presigned URLs for matching images (max 5).
    """
    result = await project_schemas.DbProject.one(db, project_id)

    fov_degree = 82.1  # DJI Mini 4 Pro default
    # Default to 120m if altitude not set for the project
    altitude = result.altitude_from_ground or 120.0

    return await gcp_crud.find_images_for_point_db(
        db, project_id, point, fov_degree, altitude
    )


@router.post("/save/{project_id}/")
async def save_gcp_file(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    user_data: Annotated[AuthUser, Depends(login_required)],
    gcp_file: UploadFile = File(...),
):
    """Save a GCP file to S3 for the project without starting processing.

    The file is stored at `projects/{project_id}/gcp.txt` in S3
    and will be automatically included when final processing is triggered.
    """
    # Write the upload to a temp file and clean it up after the S3 put.
    # Using delete=False + manual unlink is cross-platform safe because
    # add_file_to_bucket needs to reopen the file by path.
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(await gcp_file.read())
        gcp_file_path = tmp.name

    try:
        s3_path = f"projects/{project.id}/gcp.txt"
        add_file_to_bucket(settings.S3_BUCKET_NAME, gcp_file_path, s3_path)
    finally:
        os.unlink(gcp_file_path)
    log.info(f"GCP file saved for project {project.id} by user {user_data.id}")

    return {"message": "GCP file saved successfully", "project_id": str(project.id)}
