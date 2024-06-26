import os
import json
import geojson
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session
from loguru import logger as log

from app.projects import project_schemas, project_crud
from app.db import database
from app.models.enums import HTTPStatus
from app.utils import multipolygon_to_polygon
from app.s3 import s3_client
from app.config import settings
from databases import Database

router = APIRouter(
    prefix="/projects",
    responses={404: {"description": "Not found"}},
)

@router.post("/create_project", tags=["Projects"], response_model=project_schemas.ProjectInfo)
async def create_project(
    project_metadata: project_schemas.ProjectIn,
    db: Database = Depends(database.encode_db),
):
    """
    Create a project in the database using a raw SQL query.
    """
    # Prepare the values
    values = {
        "author_id": 1,
        "name": project_metadata.name,
        "short_description": project_metadata.short_description,
        "description": project_metadata.description,
        "per_task_instructions": project_metadata.per_task_instructions,
        "status": "DRAFT",
        "visibility": "PUBLIC",
        "mapper_level":"INTERMEDIATE",
        "priority": "MEDIUM",
        "outline":str(project_metadata.outline)
    }
    # Construct the SQL query
    query = """
        INSERT INTO projects (
            author_id, name, short_description, description, per_task_instructions, status, visibility,mapper_level,priority, outline, created
        )
        VALUES (
            :author_id, :name, :short_description, :description, :per_task_instructions, :status, :visibility, :mapper_level, :priority, :outline, CURRENT_TIMESTAMP
        )
        RETURNING id
    """
    new_project_id = await db.execute(query, values=values)

    if not new_project_id:
        raise HTTPException(
            status_code=500,
            detail="Project could not be created"
        )

    # Fetch the newly created project using the returned ID
    select_query = """
        SELECT *
        FROM projects
        WHERE id = :id
    """
    new_project = await db.fetch_one(query=select_query, values={"id": new_project_id})

    if not new_project:
        raise HTTPException(
            status_code=500,
            detail="Project creation failed."
        )
    return new_project


@router.post("/{project_id}/upload-task-boundaries", tags=["Projects"])
async def upload_project_task_boundaries(
    project_id: int,
    task_geojson: UploadFile = File(...),
    db: Database = Depends(database.encode_db),
):
    """Set project task boundaries using split GeoJSON from frontend.

    Each polygon in the uploaded geojson are made into single task.

    Required Parameters:
        project_id (id): ID for associated project.
        task_geojson (UploadFile): Multi-polygon GeoJSON file.

    Returns:
        dict: JSON containing success message, project ID, and number of tasks.
    """

    # read entire file
    content = await task_geojson.read()
    task_boundaries = json.loads(content)
    task_boundaries = multipolygon_to_polygon(task_boundaries)

    log.debug("Creating tasks for each polygon in project")
    await project_crud.create_tasks_from_geojson(db, project_id, task_boundaries)

    return {"message": "Project Boundary Uploaded", "project_id": f"{project_id}"}


@router.post("/preview-split-by-square/", tags=["Projects"])
async def preview_split_by_square(
    project_geojson: UploadFile = File(...), dimension: int = Form(100)
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

    result = await project_crud.preview_split_by_square(boundary, dimension)
    return result


@router.post("/generate-presigned-url/", tags=["Image Upload"])
async def generate_presigned_url(data: project_schemas.PresignedUrlRequest):
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

        url = client.presigned_put_object(
            settings.S3_BUCKET_NAME,
            f"publicuploads/{data.image_name}",
            expires=timedelta(hours=data.expiry),
        )

        return url
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to generate pre-signed URL. {e}",
        )
