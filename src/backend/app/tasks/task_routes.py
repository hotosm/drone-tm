import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.config import settings
from app.models.enums import EventType, HTTPStatus, State, UserRole
from app.tasks import task_schemas, task_crud
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.users.user_crud import get_user_by_id
from databases import Database
from app.db import database
from app.utils import send_notification_email, render_email_template
from app.projects.project_crud import get_project_by_id


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/tasks",
    tags=["tasks"],
    responses={404: {"description": "Not found"}},
)


@router.get("/{task_id}")
async def read_task(
    task_id: uuid.UUID,
    db: Database = Depends(database.get_db),
    user_data: AuthUser = Depends(login_required),
):
    "Retrieve details of a specific task by its ID."
    try:
        query = """
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
                task_events.task_id = :task_id
        """
        records = await db.fetch_one(query, values={"task_id": task_id})
        return records
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch tasks. {e}",
        )


@router.get("/statistics/")
async def get_task_stats(
    db: Database = Depends(database.get_db),
    user_data: AuthUser = Depends(login_required),
):
    "Retrieve statistics related to tasks for the authenticated user."
    user_id = user_data.id
    query = """SELECT role FROM user_profile WHERE user_id = :user_id"""
    records = await db.fetch_all(query, {"user_id": user_id})

    if not records:
        raise HTTPException(status_code=404, detail="User profile not found")

    roles = [record["role"] for record in records]
    if UserRole.PROJECT_CREATOR.name in roles:
        role = "PROJECT_CREATOR"
    else:
        role = "DRONE_PILOT"

    raw_sql = """WITH latest_task_events AS (
        SELECT
            te.task_id,
            te.state,
            te.user_id,
            ROW_NUMBER() OVER (PARTITION BY te.task_id ORDER BY te.created_at DESC) AS rn
        FROM task_events te
        WHERE
            (:role = 'DRONE_PILOT' AND te.user_id = :user_id)
            OR
            (:role != 'DRONE_PILOT' AND te.task_id IN (
                SELECT t.id
                FROM tasks t
                WHERE t.project_id IN (SELECT id FROM projects WHERE author_id = :user_id)
            ))
    )
    SELECT
        COUNT(CASE WHEN lte.state = 'REQUEST_FOR_MAPPING' THEN 1 END) AS request_logs,
        COUNT(CASE WHEN lte.state = 'LOCKED_FOR_MAPPING' THEN 1 END) AS ongoing_tasks,
        COUNT(CASE WHEN lte.state = 'UNLOCKED_DONE' THEN 1 END) AS completed_tasks,
        COUNT(CASE WHEN lte.state = 'UNFLYABLE_TASK' THEN 1 END) AS unflyable_tasks
    FROM latest_task_events lte
    WHERE lte.rn = 1;
    """

    try:
        db_counts = await db.fetch_one(
            query=raw_sql, values={"user_id": user_id, "role": role}
        )
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch task counts. {e}",
        )
    return db_counts


@router.get("/", response_model=list[task_schemas.UserTasksStatsOut])
async def list_tasks(
    db: Database = Depends(database.get_db),
    user_data: AuthUser = Depends(login_required),
):
    """Get all tasks for a all user."""

    user_id = user_data.id
    query = """SELECT role FROM user_profile WHERE user_id = :user_id"""
    records = await db.fetch_all(query, {"user_id": user_id})

    roles = [record["role"] for record in records]
    if UserRole.PROJECT_CREATOR.name in roles:
        role = 'PROJECT_CREATOR'
    else:
        role = "DRONE_PILOT"

    if not records:
        raise HTTPException(status_code=404, detail="User profile not found")

    return await task_crud.get_tasks_by_user(user_id, db, role)


@router.get("/states/{project_id}")
async def task_states(project_id: uuid.UUID, db: Database = Depends(database.get_db)):
    """Get all tasks states for a project."""

    return await task_crud.all_tasks_states(db, project_id)


@router.post("/event/{project_id}/{task_id}")
async def new_event(
    background_tasks: BackgroundTasks,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    detail: task_schemas.NewEvent,
    user_data: AuthUser = Depends(login_required),
    db: Database = Depends(database.get_db),
):
    user_id = user_data.id

    match detail.event:
        case EventType.REQUESTS:
            project = await get_project_by_id(db, project_id)
            if project["requires_approval_from_manager_for_locking"] is False:
                data = await task_crud.request_mapping(
                    db,
                    project_id,
                    task_id,
                    user_id,
                    "Request accepted automatically",
                    State.REQUEST_FOR_MAPPING,
                    State.LOCKED_FOR_MAPPING,
                )
            else:
                data = await task_crud.request_mapping(
                    db,
                    project_id,
                    task_id,
                    user_id,
                    "Request for mapping",
                    State.UNLOCKED_TO_MAP,
                    State.REQUEST_FOR_MAPPING,
                )
                # email notification
                author = await get_user_by_id(db, project.author_id)

                html_content = render_email_template(
                    template_name="mapping_requests.html",
                    context={
                        "name": author.name,
                        "drone_operator_name": user_data.name,
                        "task_id": task_id,
                        "project_name": project.name,
                        "description": project.description,
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
            project = await get_project_by_id(db, project_id)
            if user_id != project.author_id:
                raise HTTPException(
                    status_code=403,
                    detail="Only the project creator can approve the mapping.",
                )

            requested_user_id = await task_crud.get_requested_user_id(
                db, project_id, task_id
            )
            drone_operator = await get_user_by_id(db, requested_user_id)
            html_content = render_email_template(
                template_name="mapping_approved_or_rejected.html",
                context={
                    "email_subject": "Mapping Request Approved",
                    "email_body": "We are pleased to inform you that your mapping request has been approved. Your contribution is invaluable to our efforts in improving humanitarian responses worldwide.",
                    "task_status": "approved",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator.name,
                    "task_id": task_id,
                    "project_name": project.name,
                    "description": project.description,
                },
            )

            background_tasks.add_task(
                send_notification_email,
                drone_operator.email_address,
                "Task is approved",
                html_content,
            )

            return await task_crud.update_task_state(
                db,
                project_id,
                task_id,
                requested_user_id,
                "Request accepted for mapping",
                State.REQUEST_FOR_MAPPING,
                State.LOCKED_FOR_MAPPING,
            )

        case EventType.REJECTED:
            project = await get_project_by_id(db, project_id)
            if user_id != project.author_id:
                raise HTTPException(
                    status_code=403,
                    detail="Only the project creator can approve the mapping.",
                )

            requested_user_id = await task_crud.get_requested_user_id(
                db, project_id, task_id
            )
            drone_operator = await get_user_by_id(db, requested_user_id)
            html_content = render_email_template(
                template_name="mapping_approved_or_rejected.html",
                context={
                    "email_subject": "Mapping Request Rejected",
                    "email_body": "We are sorry to inform you that your mapping request has been rejected.",
                    "task_status": "rejected",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator.name,
                    "task_id": task_id,
                    "project_name": project.name,
                    "description": project.description,
                },
            )

            background_tasks.add_task(
                send_notification_email,
                drone_operator.email_address,
                "Task is Rejected",
                html_content,
            )

            return await task_crud.update_task_state(
                db,
                project_id,
                task_id,
                requested_user_id,
                "Request for mapping rejected",
                State.REQUEST_FOR_MAPPING,
                State.UNLOCKED_TO_MAP,
            )
        case EventType.FINISH:
            return await task_crud.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: unlocked to validate",
                State.LOCKED_FOR_MAPPING,
                State.UNLOCKED_TO_VALIDATE,
            )
        case EventType.VALIDATE:
            return await task_crud.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: locked for validation",
                State.UNLOCKED_TO_VALIDATE,
                State.LOCKED_FOR_VALIDATION,
            )
        case EventType.GOOD:
            return await task_crud.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: Task is Good",
                State.LOCKED_FOR_VALIDATION,
                State.UNLOCKED_DONE,
            )

        case EventType.BAD:
            return await task_crud.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Done: needs to redo",
                State.LOCKED_FOR_VALIDATION,
                State.UNLOCKED_TO_MAP,
            )
        case EventType.COMMENT:
            return await task_crud.update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                detail.comment,
                State.LOCKED_FOR_MAPPING,
                State.UNFLYABLE_TASK,
            )

    return True
