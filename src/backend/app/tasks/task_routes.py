import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from psycopg import Connection
from psycopg.rows import dict_row

from app.db import database
from app.models.enums import HTTPStatus
from app.projects import project_deps, project_schemas
from app.tasks import task_logic, task_schemas
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser

router = APIRouter(
    prefix="/tasks",
    tags=["tasks"],
    responses={404: {"description": "Not found"}},
)


async def _resolve_project_id(db: Connection, project_id: str) -> uuid.UUID:
    """Resolve a project identifier (UUID or slug) to a UUID."""
    try:
        return uuid.UUID(str(project_id))
    except ValueError:
        pass
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT id FROM projects WHERE slug = %(slug)s",
            {"slug": project_id},
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=HTTPStatus.NOT_FOUND, detail="Project not found"
            )
        return row["id"]


@router.get("/project/{project_id}/{task_index}")
async def read_task_by_index(
    project_id: str,
    task_index: int,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    """Retrieve task details by project identifier and task index."""
    resolved_id = await _resolve_project_id(db, project_id)
    return await task_schemas.TaskDetailsOut.get_task_by_project_and_index(
        db, resolved_id, task_index
    )


@router.get("/{task_id}")
async def read_task(
    task_id: uuid.UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    """Retrieve details of a specific task by its ID."""
    return await task_schemas.TaskDetailsOut.get_task_details(db, task_id)


@router.get("/statistics/")
async def get_task_stats(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    """Retrieve statistics related to tasks for the authenticated user."""
    return await task_logic.get_task_stats(db, user_data)


@router.get("/")
async def list_tasks(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    skip: int = 0,
    limit: int = 50,
):
    """Get all tasks for a user."""
    user_id = user_data.id
    return await task_schemas.UserTasksOut.get_tasks_by_user(db, user_id, skip, limit)


@router.get("/states/{project_id}")
async def task_states(
    db: Annotated[Connection, Depends(database.get_db)], project_id: str
):
    """Get all tasks states for a project."""
    resolved_id = await _resolve_project_id(db, project_id)
    return await task_schemas.Task.all(db, resolved_id)


@router.post("/event/{project_id}/{task_id}")
async def new_event(
    db: Annotated[Connection, Depends(database.get_db)],
    background_tasks: BackgroundTasks,
    project_id: str,
    task_id: uuid.UUID,
    detail: task_schemas.NewEvent,
    user_data: Annotated[AuthUser, Depends(login_required)],
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
):
    user_id = user_data.id
    resolved_project_id = await _resolve_project_id(db, project_id)
    project = project.model_dump()
    user_role = user_data.role
    return await task_logic.handle_event(
        db,
        resolved_project_id,
        task_id,
        user_id,
        project,
        user_role,
        detail,
        user_data,
        background_tasks,
    )
