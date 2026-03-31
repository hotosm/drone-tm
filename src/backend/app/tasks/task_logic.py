import json
import logging
import uuid
from datetime import datetime

from fastapi import BackgroundTasks, HTTPException
from psycopg import Connection
from psycopg.rows import class_row, dict_row

from app.config import settings
from app.models.enums import EventType, HTTPStatus, State, UserRole
from app.tasks.task_schemas import NewEvent, TaskStats
from app.users.user_schemas import DbUser, AuthUser
from app.utils import render_email_template, send_notification_email


log = logging.getLogger(__name__)


async def list_task_id_for_project(db: Connection, project_id: uuid.UUID):
    query = """
        SELECT id
        FROM tasks
        WHERE project_id = %(project_id)s;
    """
    async with db.cursor() as cur:
        await cur.execute(query, {"project_id": str(project_id)})
        return await cur.fetchall()


async def get_task_stats(db: Connection, user_data: AuthUser):
    try:
        async with db.cursor(row_factory=class_row(TaskStats)) as cur:
            raw_sql = """
                SELECT
                    COUNT(CASE WHEN te.state::text = 'AWAITING_APPROVAL' THEN 1 END) AS request_logs,
                    COUNT(CASE WHEN te.state::text IN ('LOCKED', 'FULLY_FLOWN', 'HAS_IMAGERY', 'READY_FOR_PROCESSING', 'IMAGE_PROCESSING_STARTED','IMAGE_PROCESSING_FAILED') THEN 1 END) AS ongoing_tasks,
                    COUNT(CASE WHEN te.state::text = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) AS completed_tasks,
                    COUNT(CASE WHEN te.state::text = 'HAS_ISSUES' THEN 1 END) AS unflyable_tasks

                FROM (
                    SELECT DISTINCT ON (te.task_id)
                        te.task_id,
                        te.state,
                        te.created_at
                    FROM task_events te
                    WHERE
                        (
                        %(role)s = 'DRONE_PILOT'
                        AND te.user_id = %(user_id)s AND te.state::text NOT IN ('UNLOCKED')
                    )
                    OR
                    (
                        %(role)s = 'PROJECT_CREATOR'
                        AND (
                            te.user_id = %(user_id)s AND te.state::text NOT IN ('AWAITING_APPROVAL')
                            OR
                            te.project_id IN (
                                SELECT p.id
                                FROM projects p
                                WHERE
                                    p.author_id = %(user_id)s
                            )
                        )
                    )
                    ORDER BY te.task_id, te.created_at DESC
                ) AS te;
            """

            await cur.execute(
                raw_sql, {"user_id": user_data.id, "role": user_data.role}
            )
            db_counts = await cur.fetchone()

        return db_counts

    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch task statistics. {e}",
        )


async def update_take_off_point_in_db(
    db: Connection, task_id: uuid.UUID, take_off_point: str
):
    """Update take_off_point in the task table"""
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE tasks
            SET take_off_point = ST_SetSRID(ST_GeomFromGeoJSON(%(take_off_point)s), 4326)
            WHERE id = %(task_id)s;
            """,
            {
                "task_id": str(task_id),
                "take_off_point": json.dumps(take_off_point),
            },
        )


async def get_take_off_point_from_db(db: Connection, task_id: uuid.UUID):
    """Get take_off_point from task table"""
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT ST_AsGeoJSON(take_off_point) as take_off_point
            FROM tasks
            WHERE id = %(task_id)s;
            """,
            {"task_id": str(task_id)},
        )

        data = await cur.fetchone()
        if data is None:
            raise HTTPException(
                status_code=HTTPStatus.NOT_FOUND, detail="Task not found"
            )
        return (
            json.loads(data["take_off_point"])
            if data.get("take_off_point") is not None
            else None
        )


async def get_task_geojson(db: Connection, task_id: uuid.UUID):
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', jsonb_agg(
                    jsonb_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(outline)::jsonb,
                        'properties', jsonb_build_object(
                            'id', id,
                            'project_task_id', project_task_index
                        )
                    )
                )
            ) as geom
            FROM tasks
            WHERE id = %(task_id)s;
            """,
            {"task_id": str(task_id)},
        )

        data = await cur.fetchone()
        if data is None:
            raise HTTPException(
                status_code=HTTPStatus.NOT_FOUND, detail="Task not found"
            )
        return data[0]


async def update_task_state(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: str,
    comment: str,
    initial_state: State,
    final_state: State,
    updated_at: datetime,
):
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            WITH last AS (
                SELECT te.*, p.author_id
                FROM task_events te
                JOIN projects p ON te.project_id = p.id
                WHERE te.project_id = %(project_id)s AND te.task_id = %(task_id)s
                ORDER BY te.created_at DESC
                LIMIT 1
            ),
            can_modify AS (
                SELECT *
                FROM last
                WHERE state = %(initial_state)s
                AND (user_id = %(user_id)s OR author_id = %(user_id)s)
            )
            INSERT INTO task_events(event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
            SELECT gen_random_uuid(), project_id, task_id, %(user_id)s, %(final_state)s, %(comment)s, %(updated_at)s, now()
            FROM can_modify
            RETURNING project_id, task_id, comment;
            """,
            {
                "project_id": str(project_id),
                "task_id": str(task_id),
                "user_id": str(user_id),
                "comment": comment,
                "initial_state": initial_state.name,
                "final_state": final_state.name,
                "updated_at": updated_at,
            },
        )
        result = await cur.fetchone()
        if result is None:
            raise ValueError(
                f"Failed to update task state. Task {task_id} might not be in state {initial_state} "
                f"or you might not have permission to modify it."
            )
        return result


async def update_task_state_system(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    comment: str,
    initial_state: State,
    final_state: State,
    updated_at: datetime,
):
    """Update task state without user ownership check.

    This is for system/background processes (like batch processing)
    where we need to update state without a specific user context.
    """
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            WITH last AS (
                SELECT te.*
                FROM task_events te
                WHERE te.project_id = %(project_id)s AND te.task_id = %(task_id)s
                ORDER BY te.created_at DESC
                LIMIT 1
            ),
            can_modify AS (
                SELECT *
                FROM last
                WHERE state = %(initial_state)s
            )
            INSERT INTO task_events(event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
            SELECT gen_random_uuid(), project_id, task_id, user_id, %(final_state)s, %(comment)s, %(updated_at)s, now()
            FROM can_modify
            RETURNING project_id, task_id, comment;
            """,
            {
                "project_id": str(project_id),
                "task_id": str(task_id),
                "comment": comment,
                "initial_state": initial_state.name,
                "final_state": final_state.name,
                "updated_at": updated_at,
            },
        )
        result = await cur.fetchone()
        if result is None:
            log.warning(
                f"System update task state failed. Task {task_id} might not be in state {initial_state}."
            )
        return result


async def request_mapping(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: str,
    comment: str,
    initial_state: State,
    final_state: State,
    updated_at: datetime,
):
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            WITH last AS (
                SELECT *
                FROM task_events
                WHERE project_id= %(project_id)s AND task_id= %(task_id)s
                ORDER BY created_at DESC
                LIMIT 1
            ),
            released AS (
                SELECT COUNT(*) = 0 AS no_record
                FROM task_events
                WHERE project_id= %(project_id)s AND task_id= %(task_id)s AND state = %(unlocked_to_map_state)s
            )
            INSERT INTO task_events (event_id, project_id, task_id, user_id, comment, state, updated_at, created_at)

            SELECT
                gen_random_uuid(),
                %(project_id)s,
                %(task_id)s,
                %(user_id)s,
                %(comment)s,
                %(request_for_map_state)s,
                %(updated_at)s,
                now()
            FROM last
            RIGHT JOIN released ON true
            WHERE (last.state = %(unlocked_to_map_state)s OR released.no_record = true)
            RETURNING project_id, task_id, comment;
            """,
            {
                "project_id": str(project_id),
                "task_id": str(task_id),
                "user_id": str(user_id),
                "comment": comment,
                "unlocked_to_map_state": initial_state.name,
                "request_for_map_state": final_state.name,
                "updated_at": updated_at,
            },
        )
        result = await cur.fetchone()
        return result


async def get_task_state(
    db: Connection, project_id: uuid.UUID, task_id: uuid.UUID
) -> dict:
    """Retrieve the latest state of a task by querying the task_events table.

    Args:
        db (Connection): The database connection.
        project_id (uuid.UUID): The project ID.
        task_id (uuid.UUID): The task ID.

    Returns:
        dict: A dictionary containing the task's state and associated metadata.
    """
    try:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT state, user_id, created_at, comment
                FROM task_events
                WHERE project_id = %(project_id)s AND task_id = %(task_id)s
                ORDER BY created_at DESC
                LIMIT 1;
                """,
                {
                    "project_id": str(project_id),
                    "task_id": str(task_id),
                },
            )
            result = await cur.fetchone()
            return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while retrieving the task state: {str(e)}",
        )


async def handle_event(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: str,
    project: dict,
    user_role: UserRole,
    detail: NewEvent,
    user_data: AuthUser,
    background_tasks: BackgroundTasks,
):
    match detail.event:
        case EventType.REQUEST:
            # Determine the appropriate state and message
            is_author = project["author_id"] == user_id

            requires_approval = project["requires_approval_from_manager_for_locking"]

            if is_author or not requires_approval:
                state_after = State.LOCKED
                message = "Request accepted automatically" + (
                    " as the author" if is_author else ""
                )
            else:
                state_after = State.AWAITING_APPROVAL
                message = "Request for flight"

            # Use user-provided comment if present, otherwise use auto-generated message
            comment = detail.comment if detail.comment else message

            # Perform the flight request
            data = await request_mapping(
                db,
                project_id,
                task_id,
                user_id,
                comment,
                State.UNLOCKED,
                state_after,
                detail.updated_at,
            )
            # Send email notification if approval is required
            if state_after == State.AWAITING_APPROVAL:
                author = await DbUser.get_user_by_id(db, project["author_id"])
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
                        "FRONTEND_URL": settings.PUBLIC_BASE_URL,
                    },
                )
                background_tasks.add_task(
                    send_notification_email,
                    author["email_address"],
                    "Request for flight",
                    html_content,
                )

            return data

        case EventType.FLY:
            if user_id != project["author_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Only the project creator can approve the flight request.",
                )

            requested_user_id = await DbUser.get_requested_user_id(
                db, project_id, task_id, State.AWAITING_APPROVAL
            )
            drone_operator = await DbUser.get_user_by_id(db, requested_user_id)
            html_content = render_email_template(
                folder_name="mapping",
                template_name="approved_or_rejected.html",
                context={
                    "email_subject": "Flight Request Approved",
                    "email_body": "We are pleased to inform you that your flight request has been approved. Your contribution is invaluable to our efforts in improving humanitarian responses worldwide.",
                    "task_status": "approved",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator["name"],
                    "task_id": task_id,
                    "project_id": project_id,
                    "project_name": project["name"],
                    "description": project["description"],
                    "FRONTEND_URL": settings.PUBLIC_BASE_URL,
                },
            )

            background_tasks.add_task(
                send_notification_email,
                drone_operator["email_address"],
                "Task is approved",
                html_content,
            )

            # Add an @mention so the approved operator gets the map highlight
            # that indicates the task was locked for them by the manager.
            return await update_task_state(
                db,
                project_id,
                task_id,
                requested_user_id,
                f"Request accepted for flying. @[{drone_operator['name']}]({requested_user_id})",
                State.AWAITING_APPROVAL,
                State.LOCKED,
                detail.updated_at,
            )

        case EventType.REJECT:
            if user_id != project["author_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Only the project creator can reject the flight request.",
                )

            requested_user_id = await DbUser.get_requested_user_id(
                db, project_id, task_id, State.AWAITING_APPROVAL
            )
            drone_operator = await DbUser.get_user_by_id(db, requested_user_id)
            html_content = render_email_template(
                folder_name="mapping",
                template_name="approved_or_rejected.html",
                context={
                    "email_subject": "Flight Request Rejected",
                    "email_body": "We are sorry to inform you that your flight request has been rejected.",
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

            return await update_task_state(
                db,
                project_id,
                task_id,
                requested_user_id,
                "Request for flight rejected",
                State.AWAITING_APPROVAL,
                State.UNLOCKED,
                detail.updated_at,
            )
        case EventType.MARK_FLOWN:
            return await update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Task marked as fully flown",
                State.LOCKED,
                State.FULLY_FLOWN,
                detail.updated_at,
            )

        case EventType.UNMARK_FLOWN:
            return await update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Task reverted from fully flown back to locked",
                State.FULLY_FLOWN,
                State.LOCKED,
                detail.updated_at,
            )

        case EventType.MARK_ISSUE:
            author = await DbUser.get_user_by_id(db, project["author_id"])

            requested_user_id = await DbUser.get_requested_user_id(
                db, project_id, task_id, State.LOCKED
            )
            project_task_index = next(
                (
                    task["project_task_index"]
                    for task in project["tasks"]
                    if task["id"] == task_id and task["user_id"] == requested_user_id
                ),
                None,
            )
            drone_operator = await DbUser.get_user_by_id(db, user_data.id)
            html_content = render_email_template(
                folder_name="mapping",
                template_name="task_marked_unflyable.html",
                context={
                    "email_subject": "Task Marked as Unflyable: Action Required",
                    "task_status": "unflyable",
                    "name": user_data.name,
                    "drone_operator_name": drone_operator["name"],
                    "task_id": task_id,
                    "project_task_index": project_task_index,
                    "project_name": project["name"],
                    "description": project["description"],
                },
            )

            background_tasks.add_task(
                send_notification_email,
                author["email_address"],
                "Task Marked as Unflyable",
                html_content,
            )

            return await update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                detail.comment,
                State.LOCKED,
                State.HAS_ISSUES,
                detail.updated_at,
            )

        case EventType.COMMENT:
            # Comments no longer change state; just insert a task_event row
            current_task_state = await get_task_state(db, project_id, task_id)
            current_state_name = (
                current_task_state.get("state")
                if current_task_state
                else State.UNLOCKED.name
            )
            current_state = State[current_state_name]

            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    """
                    INSERT INTO task_events(event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
                    VALUES (gen_random_uuid(), %(project_id)s, %(task_id)s, %(user_id)s, %(state)s, %(comment)s, %(updated_at)s, now())
                    RETURNING project_id, task_id, comment;
                    """,
                    {
                        "project_id": str(project_id),
                        "task_id": str(task_id),
                        "user_id": str(user_id),
                        "state": current_state.name,
                        "comment": detail.comment,
                        "updated_at": detail.updated_at,
                    },
                )
                return await cur.fetchone()

        case EventType.UNLOCK:
            # Fetch the task state
            current_task_state = await get_task_state(db, project_id, task_id)

            state = current_task_state.get("state")
            locked_user_id = current_task_state.get("user_id")
            is_author = project["author_id"] == user_id

            # Determine error conditions
            if state != State.LOCKED.name:
                raise HTTPException(
                    status_code=400,
                    detail="Task state does not match expected state for unlock operation.",
                )
            if not is_author and user_id != locked_user_id:
                raise HTTPException(
                    status_code=403,
                    detail="You cannot unlock this task as it is locked by another user.",
                )

            # Proceed with unlocking the task
            return await update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                f"Task has been unlock by user {user_data.name}.",
                State.LOCKED,
                State.UNLOCKED,
                detail.updated_at,
            )

        case EventType.IMAGE_PROCESSING_START:
            current_task_state = await get_task_state(db, project_id, task_id)
            if not current_task_state:
                raise HTTPException(
                    status_code=400, detail="Task is not ready for processing."
                )
            state = current_task_state.get("state")
            locked_user_id = current_task_state.get("user_id")

            # Current State must be READY_FOR_PROCESSING or IMAGE_PROCESSING_FAILED.
            if state not in (
                State.READY_FOR_PROCESSING.name,
                State.IMAGE_PROCESSING_FAILED.name,
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Task state does not match expected state for image processing to start.",
                )

            if user_id != locked_user_id:
                raise HTTPException(
                    status_code=403,
                    detail="You cannot upload an image for this task as it is locked by another user.",
                )

            # Preserve the actual current state so retries from FAILED use the
            # correct transition instead of always assuming READY_FOR_PROCESSING.
            initial_state = State[state]

            return await update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                f"Task image processing started by user {user_data.name}.",
                initial_state,
                State.IMAGE_PROCESSING_STARTED,
                detail.updated_at,
            )

    return True
