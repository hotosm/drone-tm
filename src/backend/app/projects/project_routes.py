import os
import json
import geojson

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session
from loguru import logger as log

from app.projects import project_schemas, project_crud
from app.db import database
from app.models.enums import HTTPStatus
from app.utils import multipolygon_to_polygon


router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    responses={404: {"description": "Not found"}},
)


@router.post("/create_project", response_model=project_schemas.ProjectOut)
async def create_project(
    project_info: project_schemas.ProjectIn,
    db: Session = Depends(database.get_db),
):
    """Create a project in  database."""

    log.info(
        f"Attempting creation of project "
        f"{project_info.name} in organisation {project_info.organisation_id}"
    )

    project = await project_crud.create_project_with_project_info(db, project_info)
    if not project:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project creation failed"
        )

    return project


@router.post("/{project_id}/upload-task-boundaries")
async def upload_project_task_boundaries(
    project_id: int,
    task_geojson: UploadFile = File(...),
    db: Session = Depends(database.get_db),
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


@router.post("/preview-split-by-square/")
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
