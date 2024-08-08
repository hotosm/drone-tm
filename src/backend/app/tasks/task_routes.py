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


@router.post("/{task_id}")
async def create_task_comment(
    input: task_schemas.TaskComment,
    task_id: uuid.UUID,
    db: Database = Depends(database.get_db),
    user_data: AuthUser = Depends(login_required),
):
    """
    Create or update a comment for a specific task.

    Args:
        comment (task_schemas.TaskComment): The comment data.
        task_id (uuid.UUID): The unique identifier of the task.
        db (Database): The database session dependency.
        user_data (AuthUser): The authenticated user data.

    Returns:
        dict: A message indicating the success of the operation.

    Raises:
        HTTPException: If updating the task comment fails.
    """
    try:
        raw_sql = """
            UPDATE task_events
            SET state = :state, comment = :comment
            WHERE task_id = :task_id
            """
        await db.execute(
            raw_sql,
            {"task_id": task_id, "state": "UNFLYABLE_TASK", "comment": input.comment},
        )
        return {"detail": "Successfully created the task comment."}

    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Failed to update task comment. {e}",
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
    raw_sql = """
        SELECT
        COUNT(CASE WHEN te.state = 'LOCKED_FOR_MAPPING' THEN 1 END) AS ongoing_tasks,
        COUNT(CASE WHEN te.state = 'REQUEST_FOR_MAPPING' THEN 1 END) AS request_logs,
        COUNT(CASE WHEN te.state = 'UNLOCKED_DONE' THEN 1 END) AS completed_tasks,
        COUNT(CASE WHEN te.state = 'UNFLYABLE_TASK' THEN 1 END) AS unflyable_tasks
        FROM tasks t
        LEFT JOIN task_events te ON t.id = te.task_id
        WHERE t.project_id IN (SELECT id FROM projects WHERE author_id = :user_id);
        """

    try:
        db_counts = await db.fetch_one(query=raw_sql, values={"user_id": user_id})
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
    """Get all tasks for a drone user."""

    user_id = user_data.id
    return await task_crud.get_tasks_by_user(user_id, db)


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
            # TODO: Combine the logic of `update_or_create_task_state` and `request_mapping` functions into a single function if possible. Will do later.
            project = await get_project_by_id(db, project_id)
            if project["requires_approval_from_manager_for_locking"] is False:
                data = await task_crud.update_or_create_task_state(
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

    return True


@router.get("/requested_tasks/pending")
async def get_pending_tasks(
    user_data: AuthUser = Depends(login_required),
    db: Database = Depends(database.get_db),
):
    """Get a list of pending tasks for a project creator."""
    user_id = user_data.id
    query = """SELECT role FROM user_profile WHERE user_id = :user_id"""
    records = await db.fetch_all(query, {"user_id": user_id})
    if not records:
        raise HTTPException(status_code=404, detail="User profile not found")

    roles = [record["role"] for record in records]
    if UserRole.PROJECT_CREATOR.name not in roles:
        raise HTTPException(
            status_code=403, detail="Access forbidden for non-Project Creator users"
        )
    pending_tasks = await task_crud.get_project_task_by_id(db, user_id)
    if pending_tasks is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return pending_tasks
