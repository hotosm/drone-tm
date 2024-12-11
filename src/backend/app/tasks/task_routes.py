import uuid
from typing import Annotated
from app.projects import project_deps, project_schemas
from fastapi import APIRouter, BackgroundTasks, Depends
from app.config import settings
from app.tasks import task_schemas, task_logic
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from psycopg import Connection
from app.db import database
from loguru import logger as log

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/tasks",
    tags=["tasks"],
    responses={404: {"description": "Not found"}},
)


@router.get("/{task_id}")
async def read_task(
    task_id: uuid.UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    "Retrieve details of a specific task by its ID."
    return await task_schemas.TaskDetailsOut.get_task_details(db, task_id)


@router.get("/statistics/")
async def get_task_stats(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    "Retrieve statistics related to tasks for the authenticated user."
    return await task_logic.get_task_stats(db, user_data)


@router.get("/")
async def list_tasks(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    skip: int = 0,
    limit: int = 50,
):
    """Get all tasks for a all user."""
    user_id = user_data.id
    role = user_data.role
    log.info(f"Fetching tasks for user {user_id} with role: {role}")
    return await task_schemas.UserTasksStatsOut.get_tasks_by_user(
        db, user_id, role, skip, limit
    )


@router.get("/states/{project_id}")
async def task_states(
    db: Annotated[Connection, Depends(database.get_db)], project_id: uuid.UUID
):
    """Get all tasks states for a project."""
    return await task_schemas.Task.all(db, project_id)


@router.post("/event/{project_id}/{task_id}")
async def new_event(
    db: Annotated[Connection, Depends(database.get_db)],
    background_tasks: BackgroundTasks,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    detail: task_schemas.NewEvent,
    user_data: Annotated[AuthUser, Depends(login_required)],
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
):
    user_id = user_data.id
    project = project.model_dump()
    user_role = user_data.role
    return await task_logic.handle_event(
        db,
        project_id,
        task_id,
        user_id,
        project,
        user_role,
        detail,
        user_data,
        background_tasks,
    )
