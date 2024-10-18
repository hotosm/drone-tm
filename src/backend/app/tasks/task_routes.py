import uuid
from typing import Annotated
from app.projects import project_deps, project_schemas
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.config import settings
from app.models.enums import EventType, HTTPStatus, State, UserRole
from app.tasks import task_schemas, task_logic
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.users import user_schemas
from psycopg import Connection
from app.db import database
from app.utils import send_notification_email, render_email_template
from psycopg.rows import dict_row

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
    try:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                    ST_Area(ST_Transform(tasks.outline, 3857)) / 1000000 AS task_area,
                    te.created_at,
                    te.updated_at,
                    projects.name AS project_name,
                    tasks.project_task_index,
                    projects.front_overlap AS front_overlap,
                    projects.side_overlap AS side_overlap,
                    projects.gsd_cm_px AS gsd_cm_px,
                    projects.gimble_angles_degrees AS gimble_angles_degrees
                FROM (
                    SELECT DISTINCT ON (te.task_id)
                        te.task_id,
                        te.created_at,
                        te.updated_at
                    FROM task_events te
                    WHERE te.task_id = %(task_id)s
                    ORDER BY te.task_id, te.created_at DESC
                ) AS te
                JOIN tasks ON te.task_id = tasks.id
                JOIN projects ON tasks.project_id = projects.id
                WHERE te.task_id = %(task_id)s;
                """,
                {"task_id": task_id},
            )
            records = await cur.fetchone()
            return records

    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch task. {e}",
        )


@router.get("/statistics/")
async def get_task_stats(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    "Retrieve statistics related to tasks for the authenticated user."
    user_id = user_data.id
    try:
        async with db.cursor(row_factory=dict_row) as cur:
            raw_sql = """
                SELECT
                    COUNT(CASE WHEN te.state = 'REQUEST_FOR_MAPPING' THEN 1 END) AS request_logs,
                    COUNT(CASE WHEN te.state IN ('LOCKED_FOR_MAPPING', 'IMAGE_UPLOADED') THEN 1 END) AS ongoing_tasks,
                    COUNT(CASE WHEN te.state = 'IMAGE_PROCESSED' THEN 1 END) AS completed_tasks,
                    COUNT(CASE WHEN te.state = 'UNFLYABLE_TASK' THEN 1 END) AS unflyable_tasks
                FROM (
                    SELECT DISTINCT ON (te.task_id)
                        te.task_id,
                        te.state,
                        te.created_at
                    FROM task_events te
                    WHERE
                        (
                        %(role)s = 'DRONE_PILOT'
                        AND te.user_id = %(user_id)s
                    )
                        OR
                        (%(role)s = 'PROJECT_CREATOR' AND te.project_id IN (
                            SELECT p.id
                            FROM projects p
                            WHERE p.author_id = %(user_id)s
                        ))
                    ORDER BY te.task_id, te.created_at DESC
                ) AS te;
            """

            await cur.execute(raw_sql, {"user_id": user_id, "role": user_data.role})
            db_counts = await cur.fetchone()

        return db_counts

    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch task statistics. {e}",
        )


@router.get("/", response_model=list[task_schemas.UserTasksStatsOut])
async def list_tasks(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    skip: int = 0,
    limit: int = 50,
):
    """Get all tasks for a all user."""
    user_id = user_data.id
    role = user_data.role
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

    match detail.event:
        case EventType.REQUESTS:
            # Determine the appropriate state and message
            is_author = project["author_id"] == user_id

            if user_role != UserRole.DRONE_PILOT and not is_author:
                raise HTTPException(
                    status_code=403,
                    detail="Only the project author or drone operators can request tasks for this project.",
                )

            requires_approval = project["requires_approval_from_manager_for_locking"]

            if is_author or not requires_approval:
                state_after = State.LOCKED_FOR_MAPPING
                message = "Request accepted automatically" + (
                    " as the author" if is_author else ""
                )
            else:
                state_after = State.REQUEST_FOR_MAPPING
                message = "Request for mapping"

            # Perform the mapping request
            data = await task_logic.request_mapping(
                db,
                project_id,
                task_id,
                user_id,
                message,
                State.UNLOCKED_TO_MAP,
                state_after,
                detail.updated_at,
            )
            # Send email notification if approval is required
            if state_after == State.REQUEST_FOR_MAPPING:
                author = await user_schemas.DbUser.get_user_by_id(
                    db, project["author_id"]
                )
                html_content = render_email_template(
                    folder_name="mapping",
                    template_name="requests.html",
                    context={
                        "name": author["name"],
                        "drone_operator_name": user_data.name,
                        "task_id": task_id,
                        "project_id": project_id,
                        "project_name": project["name"],
                        "description": project["description"],
                        "FRONTEND_URL": settings.FRONTEND_URL,
                    },
                )
                background_tasks.add_task(
                    send_notification_email,
                    author["email_address"],
                    "Request for mapping",
                    html_content,
                )

            return data

        case EventType.MAP:
            if user_id != project["author_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Only the project creator can approve the mapping.",
                )

            requested_user_id = await user_schemas.DbUser.get_requested_user_id(
                db, project_id, task_id
            )
            drone_operator = await user_schemas.DbUser.get_user_by_id(
                db, requested_user_id
            )
            html_content = render_email_template(
                folder_name="mapping",
                template_name="approved_or_rejected.html",
                context={
                    "email_subject": "Mapping Request Approved",
                    "email_body": "We are pleased to inform you that your mapping request has been approved. Your contribution is invaluable to our efforts in improving humanitarian responses worldwide.",
                    "task_status": "approved",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator["name"],
                    "task_id": task_id,
                    "project_id": project_id,
                    "project_name": project["name"],
                    "description": project["description"],
                    "FRONTEND_URL": settings.FRONTEND_URL,
                },
            )

            background_tasks.add_task(
                send_notification_email,
                drone_operator["email_address"],
                "Task is approved",
                html_content,
            )

            return await task_logic.update_task_state(
                db,
                project_id,
                task_id,
                requested_user_id,
                "Request accepted for mapping",
                State.REQUEST_FOR_MAPPING,
                State.LOCKED_FOR_MAPPING,
                detail.updated_at,
            )

        case EventType.REJECTED:
            if user_id != project["author_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Only the project creator can approve the mapping.",
                )

            requested_user_id = await user_schemas.DbUser.get_requested_user_id(
                db, project_id, task_id
            )
            drone_operator = await user_schemas.DbUser.get_user_by_id(
                db, requested_user_id
            )
            html_content = render_email_template(
                folder_name="mapping",
                template_name="approved_or_rejected.html",
                context={
                    "email_subject": "Mapping Request Rejected",
                    "email_body": "We are sorry to inform you that your mapping request has been rejected.",
                    "task_status": "rejected",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator["name"],
                    "task_id": task_id,
                    "project_id": project_id,
                    "project_name": project["name"],
                    "description": project["description"],
                },
            )

            background_tasks.add_task(
                send_notification_email,
                drone_operator["email_address"],
                "Task is Rejected",
                html_content,
            )

            return await task_logic.update_task_state(
                db,
                project_id,
                task_id,
                requested_user_id,
                "Request for mapping rejected",
                State.REQUEST_FOR_MAPPING,
                State.UNLOCKED_TO_MAP,
                detail.updated_at,
            )
        case EventType.FINISH:
            return await task_logic.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: unlocked to validate",
                State.LOCKED_FOR_MAPPING,
                State.UNLOCKED_TO_VALIDATE,
                detail.updated_at,
            )
        case EventType.VALIDATE:
            return task_logic.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: locked for validation",
                State.UNLOCKED_TO_VALIDATE,
                State.LOCKED_FOR_VALIDATION,
                detail.updated_at,
            )
        case EventType.GOOD:
            return await task_logic.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: Task is Good",
                State.LOCKED_FOR_VALIDATION,
                State.UNLOCKED_DONE,
                detail.updated_at,
            )

        case EventType.BAD:
            return await task_logic.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: needs to redo",
                State.LOCKED_FOR_VALIDATION,
                State.UNLOCKED_TO_MAP,
                detail.updated_at,
            )
        case EventType.COMMENT:
            return await task_logic.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                detail.comment,
                State.LOCKED_FOR_MAPPING,
                State.UNFLYABLE_TASK,
                detail.updated_at,
            )

        case EventType.UNLOCK:
            # Fetch the task state
            current_task_state = await task_logic.get_task_state(
                db, project_id, task_id
            )

            state = current_task_state.get("state")
            locked_user_id = current_task_state.get("user_id")

            # Determine error conditions
            if state != State.LOCKED_FOR_MAPPING.name:
                raise HTTPException(
                    status_code=400,
                    detail="Task state does not match expected state for unlock operation.",
                )
            if user_id != locked_user_id:
                raise HTTPException(
                    status_code=403,
                    detail="You cannot unlock this task as it is locked by another user.",
                )

            # Proceed with unlocking the task
            return await task_logic.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                f"Task has been unlock by user {user_data.name}.",
                State.LOCKED_FOR_MAPPING,
                State.UNLOCKED_TO_MAP,
                detail.updated_at,
            )

    return True
