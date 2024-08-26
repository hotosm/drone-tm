import os
import geojson
import uuid
from typing import Annotated
from datetime import timedelta
from geojson_pydantic import FeatureCollection
from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    UploadFile,
    File,
    Form,
    BackgroundTasks,
)
from loguru import logger as log
from psycopg import Connection
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from fastapi.responses import JSONResponse

from app.projects import project_schemas, project_deps, project_logic
from app.db import database
from app.models.enums import HTTPStatus
from app.s3 import s3_client
from app.config import settings
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/projects",
    responses={404: {"description": "Not found"}},
)


@router.delete("/{project_id}", tags=["Projects"])
async def delete_project_by_id(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """
    Delete a project by its ID, along with all associated tasks.

    Args:
        project_id (uuid.UUID): The ID of the project to delete.
        db (Database): The database session dependency.

    Returns:
        dict: A confirmation message.

    Raises:
        HTTPException: If the project is not found.
    """
    project_id = await project_schemas.DbProject.delete(db, project.id)
    return {"message": f"Project successfully deleted {project_id}"}


@router.post("/", tags=["Projects"])
async def create_project(
    project_info: project_schemas.ProjectIn,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    dem: UploadFile = File(None),
):
    """Create a project in  database."""
    project_id = await project_schemas.DbProject.create(db, project_info, user_data.id)

    # Upload DEM to S3
    dem_url = await project_logic.upload_dem_to_s3(project_id, dem) if dem else None

    # Update dem url to database
    await project_logic.update_project_dem_url(db, project_id, dem_url)

    if not project_id:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project creation failed"
        )
    return {"message": "Project successfully created", "project_id": project_id}


@router.post("/{project_id}/upload-task-boundaries", tags=["Projects"])
async def upload_project_task_boundaries(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    task_featcol: Annotated[FeatureCollection, Depends(project_deps.geojson_upload)],
):
    """Set project task boundaries using split GeoJSON from frontend.

    Each polygon in the uploaded geojson are made into single task.

    Returns:
        dict: JSON containing success message, project ID, and number of tasks.
    """
    log.debug("Creating tasks for each polygon in project")
    await project_logic.create_tasks_from_geojson(db, project.id, task_featcol)
    return {"message": "Project Boundary Uploaded", "project_id": f"{project.id}"}


@router.post("/preview-split-by-square/", tags=["Projects"])
async def preview_split_by_square(
    user: Annotated[AuthUser, Depends(login_required)],
    project_geojson: UploadFile = File(...),
    no_fly_zones: UploadFile = File(default=None),
    dimension: int = Form(100),
):
    """Preview splitting by square."""

    # Validating for .geojson File.
    file_name = os.path.splitext(project_geojson.filename)
    file_ext = file_name[1]
    allowed_extensions = [".geojson", ".json"]
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Provide a valid .geojson file")

    # read entire file
    content = await project_geojson.read()
    boundary = geojson.loads(content)
    project_shape = shape(boundary["features"][0]["geometry"])

    # If no_fly_zones is provided, read and parse it
    if no_fly_zones:
        no_fly_content = await no_fly_zones.read()
        no_fly_zones_geojson = geojson.loads(no_fly_content)
        no_fly_shapes = [
            shape(feature["geometry"]) for feature in no_fly_zones_geojson["features"]
        ]
        no_fly_union = unary_union(no_fly_shapes)

        # Calculate the difference between the project shape and no-fly zones
        new_outline = project_shape.difference(no_fly_union)
    else:
        new_outline = project_shape

    result_geojson = geojson.Feature(geometry=mapping(new_outline))

    result = await project_logic.preview_split_by_square(result_geojson, dimension)

    return result


@router.post("/generate-presigned-url/", tags=["Image Upload"])
async def generate_presigned_url(
    data: project_schemas.PresignedUrlRequest,
    user: Annotated[AuthUser, Depends(login_required)],
):
    """
    Generate a pre-signed URL for uploading an image to S3 Bucket.

    This endpoint generates a pre-signed URL that allows users to upload an image to
    an S3 bucket. The URL expires after a specified duration.

    Args:

        image_name: The name of the image you want to upload
        expiry : Expiry time in hours

    Returns:

        str: The pre-signed URL to upload the image
    """
    try:
        # Generate a pre-signed URL for an object
        client = s3_client()
        urls = []
        for image in data.image_name:
            image_path = f"publicuploads/{data.project_id}/{data.task_id}/{image}"

            url = client.get_presigned_url(
                "PUT",
                settings.S3_BUCKET_NAME,
                image_path,
                expires=timedelta(hours=data.expiry),
            )
            urls.append({"image_name": image, "url": url})

        return urls
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to generate pre-signed URL. {e}",
        )


@router.get("/", tags=["Projects"], response_model=list[project_schemas.ProjectOut])
async def read_projects(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    skip: int = 0,
    limit: int = 100,
):
    "Get all projects with task count."
    try:
        return await project_schemas.DbProject.all(db, skip, limit)
    except KeyError as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND) from e


@router.get(
    "/{project_id}", tags=["Projects"], response_model=project_schemas.ProjectOut
)
async def read_project(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Get a specific project and all associated tasks by ID."""
    return project


@router.get("/process-imagery/{project_id}", tags=["Image Processing"])
async def process_imagery(
    project_id: uuid.UUID, task_id: uuid.UUID, background_tasks: BackgroundTasks
):
    """Process Drone Imageries for a Project"""
    background_tasks.add_task(
        project_crud.process_images_concurrently, project_id, task_id
    )

    return JSONResponse(
        content={"message": "Processing started", "project_id": str(project_id)}
    )
