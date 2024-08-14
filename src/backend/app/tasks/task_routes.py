import uuid
from typing import Annotated
from app.projects import project_deps, project_schemas
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.config import settings
from app.models.enums import EventType, HTTPStatus, State
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
                    ST_Area(ST_Transform(tasks.outline, 4326)) / 1000000 AS task_area,
                    task_events.created_at,
                    projects.name AS project_name,
                    project_task_index,
                    projects.front_overlap AS front_overlap,
                    projects.side_overlap AS side_overlap,
                    projects.gsd_cm_px AS gsd_cm_px,
                    projects.gimble_angles_degrees AS gimble_angles_degrees
                FROM
                    task_events
                JOIN
                    tasks ON task_events.task_id = tasks.id
                JOIN
                    projects ON task_events.project_id = projects.id
                WHERE
                    task_events.task_id = %(task_id)s
            """,
                {"task_id": task_id},
            )
            task = await cur.fetchone()
            if task is None:
                raise HTTPException(
                    status_code=HTTPStatus.NOT_FOUND,
                    detail=f"Task with ID {task_id} not found.",
                )
            return task
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
        async with db.cursor() as cur:
            # Check if the user profile exists
            await cur.execute(
                """SELECT role FROM user_profile WHERE user_id = %(user_id)s""",
                {"user_id": user_id},
            )
            records = await cur.fetchone()

            if not records:
                raise HTTPException(status_code=404, detail="User profile not found")

            # Query for task statistics
            raw_sql = """
                SELECT
                    COUNT(CASE WHEN te.state = 'REQUEST_FOR_MAPPING' THEN 1 END) AS request_logs,
                    COUNT(CASE WHEN te.state = 'LOCKED_FOR_MAPPING' THEN 1 END) AS ongoing_tasks,
                    COUNT(CASE WHEN te.state = 'UNLOCKED_DONE' THEN 1 END) AS completed_tasks,
                    COUNT(CASE WHEN te.state = 'UNFLYABLE_TASK' THEN 1 END) AS unflyable_tasks
                FROM tasks t
                LEFT JOIN task_events te ON t.id = te.task_id
                WHERE t.project_id IN (SELECT id FROM projects WHERE author_id = %(user_id)s);
            """
            await cur.execute(raw_sql, {"user_id": user_id})
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
):
    """Get all tasks for a drone user."""

    user_id = user_data.id
    return await task_schemas.UserTasksStatsOut.get_tasks_by_user(db, user_id)


@router.get("/states/{project_id}")
async def task_states(
    db: Annotated[Connection, Depends(database.get_db)], project_id: uuid.UUID
):
    """Get all tasks states for a project."""
    return await task_schemas.TaskState.all(db, project_id)


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
    match detail.event:
        case EventType.REQUESTS:
            if project["requires_approval_from_manager_for_locking"] is False:
                data = await task_logic.request_mapping(
                    db,
                    project_id,
                    task_id,
                    user_id,
                    "Request accepted automatically",
                    State.UNLOCKED_TO_MAP,
                    State.LOCKED_FOR_MAPPING,
                )
            else:
                data = await task_logic.request_mapping(
                    db,
                    project_id,
                    task_id,
                    user_id,
                    "Request for mapping",
                    State.UNLOCKED_TO_MAP,
                    State.REQUEST_FOR_MAPPING,
                )
                # email notification
                author = await user_schemas.DbUser.get_user_by_id(
                    db, project["author_id"]
                )
                html_content = render_email_template(
                    template_name="mapping_requests.html",
                    context={
                        "name": author["name"],
                        "drone_operator_name": user_data.name,
                        "task_id": task_id,
                        "project_name": project["name"],
                        "description": project["description"],
                    },
                )
                background_tasks.add_task(
                    send_notification_email,
                    user_data.email,
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
                template_name="mapping_approved_or_rejected.html",
                context={
                    "email_subject": "Mapping Request Approved",
                    "email_body": "We are pleased to inform you that your mapping request has been approved. Your contribution is invaluable to our efforts in improving humanitarian responses worldwide.",
                    "task_status": "approved",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator["name"],
                    "task_id": task_id,
                    "project_name": project["name"],
                    "description": project["description"],
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
                template_name="mapping_approved_or_rejected.html",
                context={
                    "email_subject": "Mapping Request Rejected",
                    "email_body": "We are sorry to inform you that your mapping request has been rejected.",
                    "task_status": "rejected",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator["name"],
                    "task_id": task_id,
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
            )

    return True
