from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.projects import project_schemas, project_crud
from app.db import database
from app.models.enums import HTTPStatus

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

    project = await project_crud.create_project_with_project_info(db, project_info)
    if not project:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project creation failed"
        )

    return project
