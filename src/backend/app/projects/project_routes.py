import os
import json
import uuid
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
import geojson
from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from loguru import logger as log
from app.projects import project_schemas, project_crud
from app.db import database
from app.models.enums import HTTPStatus
from app.utils import multipolygon_to_polygon
from app.s3 import s3_client
from app.config import settings
from databases import Database
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/projects",
    responses={404: {"description": "Not found"}},
)


@router.delete("/{project_id}", tags=["Projects"])
async def delete_project_by_id(
    project_id: uuid.UUID,
    db: Database = Depends(database.get_db),
    user: AuthUser = Depends(login_required),
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
    delete_query = """
        WITH deleted_project AS (
            DELETE FROM projects
            WHERE id = :project_id
            RETURNING id
        ), deleted_tasks AS (
            DELETE FROM tasks
            WHERE project_id = :project_id
            RETURNING id
        ), deleted_task_events AS (
            DELETE FROM task_events
            WHERE project_id = :project_id
            RETURNING event_id
        )
        SELECT id FROM deleted_project
    """

    result = await db.fetch_one(query=delete_query, values={"project_id": project_id})

    if not result:
        raise HTTPException(status_code=404)

    return {"message": f"Project ID: {project_id} is deleted successfully."}

@router.post("/create_project", tags=["Projects"])
async def create_project(
    project_info: project_schemas.ProjectIn,
    db: Database = Depends(database.get_db),
    user_data: AuthUser = Depends(login_required),
):
    """Create a project in  database."""
    author_id = user_data.id
    project_id = await project_crud.create_project_with_project_info(
        db, author_id, project_info
    )
    if not project_id:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project creation failed"
        )
    return {"message": "Project successfully created", "project_id": project_id}


@router.post("/{project_id}/upload-task-boundaries", tags=["Projects"])
async def upload_project_task_boundaries(
    project_id: uuid.UUID,
    task_geojson: UploadFile = File(...),
    db: Database = Depends(database.get_db),
    user: AuthUser = Depends(login_required),
):
    """Set project task boundaries using split GeoJSON from frontend.

    Each polygon in the uploaded geojson are made into single task.

    Required Parameters:
        project_id (id): ID for associated project.
        task_geojson (UploadFile): Multi-polygon GeoJSON file.

    Returns:
        dict: JSON containing success message, project ID, and number of tasks.
    """
    # check the project in Database
    raw_sql = f"""SELECT id FROM projects WHERE id = '{project_id}' LIMIT 1;"""
    project = await db.fetch_one(query=raw_sql)
    if not project:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project not found."
        )
    # read entire file
    content = await task_geojson.read()
    task_boundaries = json.loads(content)
    task_boundaries = multipolygon_to_polygon(task_boundaries)

    log.debug("Creating tasks for each polygon in project")
    await project_crud.create_tasks_from_geojson(db, project_id, task_boundaries)

    return {"message": "Project Boundary Uploaded", "project_id": f"{project_id}"}


@router.post("/preview-split-by-square/", tags=["Projects"])
async def preview_split_by_square(
    project_geojson: UploadFile = File(...),
    no_fly_zones: UploadFile = File(default=None),
    dimension: int = Form(100),
    user: AuthUser = Depends(login_required),
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

    result = await project_crud.preview_split_by_square(result_geojson, dimension)

    return result


@router.post("/generate-presigned-url/", tags=["Image Upload"])
async def generate_presigned_url(
    data: project_schemas.PresignedUrlRequest, user: AuthUser = Depends(login_required)
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
    skip: int = 0,
    limit: int = 100,
    db: Database = Depends(database.get_db),
    user_data: AuthUser = Depends(login_required),
):
    "Return all projects"
    projects = await project_crud.get_projects(db, skip, limit)
    return projects


@router.get(
    "/{project_id}", tags=["Projects"], response_model=project_schemas.ProjectOut
)
async def read_project(
    project_id: uuid.UUID,
    db: Database = Depends(database.get_db),
    user_data: AuthUser = Depends(login_required),
):
    """Get a specific project and all associated tasks by ID."""
    project = await project_crud.get_project_info_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
