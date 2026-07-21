import json
import logging
import re
import uuid
from datetime import datetime

from fastapi import BackgroundTasks, HTTPException
from psycopg import Connection
from psycopg.rows import class_row, dict_row

from app.config import settings
from app.models.enums import EventType, HTTPStatus, State, UserRole
from app.tasks.task_schemas import NewEvent, TaskStats
from app.users.user_schemas import DbUser, AuthUser
from app.utils import (
    render_email_template,
    sanitize_sensitive_text,
    send_notification_email,
)


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
                            te.user_id = %(user_id)s
                            AND te.state::text NOT IN ('UNLOCKED')
                        )
                        OR
                        te.project_id IN (
                            SELECT p.id
                            FROM projects p
                            WHERE p.author_id = %(user_id)s
                        )
                    ORDER BY te.task_id, te.created_at DESC
                ) AS te;
            """

            await cur.execute(raw_sql, {"user_id": user_data.id})
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
            RETURNING project_id, task_id, state, comment;
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


# Matches the comment we write for revert events. State tokens are always
# upper-case enum names, which keeps this from matching prose like
# "Task reverted from fully flown back to locked" produced by UNMARK_FLOWN.
_REVERT_COMMENT_RE = re.compile(r"^Task reverted from [A-Z_]+ to [A-Z_]+ by .+\.$")


def _is_revert_comment(comment: str | None) -> bool:
    if not comment:
        return False
    return bool(_REVERT_COMMENT_RE.match(comment))


def _resolve_revert_target(
    events: list[dict], current_state: str
) -> tuple[str, str] | None:
    """Find the (state, user_id) the next revert should land on.

    `events` must be ordered most-recent-first. Returns None when no prior
    distinct state exists, so the caller falls back to UNLOCKED.

    A prior revert "shadows" the non-revert event it reverted away from, so
    we keep a skip counter: each revert seen while walking back consumes one
    upcoming non-revert event with a different state. Without this, a second
    revert lands on the state we just reverted out of, undoing the undo.
    """
    skip = 0
    for event in events:
        if _is_revert_comment(event.get("comment")):
            skip += 1
            continue
        if event["state"] == current_state:
            continue
        if skip > 0:
            skip -= 1
            continue
        return event["state"], event["user_id"]
    return None


async def revert_task_state(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    current_state: str,
    current_user_id: str,
    actor_name: str,
    updated_at: datetime,
):
    """Step a task back one event in its history.

    The new event preserves the user_id of the prior state so the task
    remains shown as held by the original pilot; the actor performing the
    revert is recorded in the comment for audit. LOCKED always reverts to
    UNLOCKED regardless of what came before (e.g. AWAITING_APPROVAL) so a
    plain "unlock" matches user expectation. If there is no prior distinct
    state in history, the task reverts to UNLOCKED.

    Successive reverts walk further back through the original event history
    rather than ping-ponging between two adjacent states - see
    ``_resolve_revert_target``.

    Caller is responsible for verifying the task isn't already UNLOCKED
    and that the actor is authorized to revert.
    """
    async with db.cursor(row_factory=dict_row) as cur:
        if current_state == State.LOCKED.name:
            target_state = State.UNLOCKED.name
            target_user_id = current_user_id
        else:
            await cur.execute(
                """
                SELECT state::text AS state, user_id, comment
                FROM task_events
                WHERE project_id = %(project_id)s
                  AND task_id = %(task_id)s
                ORDER BY created_at DESC
                """,
                {
                    "project_id": str(project_id),
                    "task_id": str(task_id),
                },
            )
            events = await cur.fetchall()
            resolved = _resolve_revert_target(events, current_state)
            if resolved is not None:
                target_state, target_user_id = resolved
            else:
                target_state = State.UNLOCKED.name
                target_user_id = current_user_id

        await cur.execute(
            """
            INSERT INTO task_events (event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
            VALUES (gen_random_uuid(), %(project_id)s, %(task_id)s, %(user_id)s, %(state)s, %(comment)s, %(updated_at)s, now())
            RETURNING project_id, task_id, state, comment;
            """,
            {
                "project_id": str(project_id),
                "task_id": str(task_id),
                "user_id": str(target_user_id),
                "state": target_state,
                "comment": f"Task reverted from {current_state} to {target_state} by {actor_name}.",
                "updated_at": updated_at,
            },
        )
        return await cur.fetchone()


async def manual_override_task_state(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    target_state: State,
    actor_user_id: str,
    actor_name: str,
    updated_at: datetime,
):
    """Force a task into ``target_state`` as an admin failsafe.

    Sidesteps the state-machine transition checks in ``update_task_state``
    so the project author can unstick tasks that no scripted workflow can
    recover. The new event preserves the most recent task user_id (so a
    task that was held by a pilot stays attributed to them on the map);
    if there is no prior event, it falls back to the actor.

    The comment uses a distinct prefix from ``revert_task_state`` so the
    successive-revert walk-back does not mistake an override for a revert.
    Caller is responsible for authorizing the actor.
    """
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT state::text AS state, user_id
            FROM task_events
            WHERE project_id = %(project_id)s AND task_id = %(task_id)s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            {"project_id": str(project_id), "task_id": str(task_id)},
        )
        latest = await cur.fetchone()
        prev_state = latest["state"] if latest else State.UNLOCKED.name
        target_user_id = latest["user_id"] if latest else actor_user_id

        if prev_state == target_state.name:
            raise HTTPException(
                status_code=HTTPStatus.BAD_REQUEST,
                detail=f"Task is already in state {target_state.name}.",
            )

        await cur.execute(
            """
            INSERT INTO task_events (event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
            VALUES (gen_random_uuid(), %(project_id)s, %(task_id)s, %(user_id)s, %(state)s, %(comment)s, %(updated_at)s, now())
            RETURNING project_id, task_id, state, comment;
            """,
            {
                "project_id": str(project_id),
                "task_id": str(task_id),
                "user_id": str(target_user_id),
                "state": target_state.name,
                "comment": (
                    f"Task state manually overridden from {prev_state} to "
                    f"{target_state.name} by {actor_name}."
                ),
                "updated_at": updated_at,
            },
        )
        return await cur.fetchone()


async def update_task_state_system(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    comment: str,
    initial_state: State,
    final_state: State,
    updated_at: datetime,
    expected_odm_uuid: str | None = None,
):
    """Update task state without user ownership check.

    This is for system/background processes (like batch processing)
    where we need to update state without a specific user context.

    The comment is sanitized to redact sensitive values (e.g. tokens
    embedded in NodeODM URLs) before persisting to the database.

    When expected_odm_uuid is given, the transition also requires the task to
    still hold that odm_task_uuid (so a rerun that reused the row is not
    affected).
    """
    comment = sanitize_sensitive_text(comment)
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
                SELECT last.*
                FROM last
                JOIN tasks t ON t.id = %(task_id)s AND t.project_id = %(project_id)s
                WHERE last.state = %(initial_state)s
                  AND (
                      %(expected_odm_uuid)s::text IS NULL
                      OR t.odm_task_uuid = %(expected_odm_uuid)s
                  )
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
                "expected_odm_uuid": expected_odm_uuid,
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
            # Accept the mark from either LOCKED (flown but no imagery yet) or
            # HAS_IMAGERY (imagery uploaded and classified). Either is a valid
            # precursor to FULLY_FLOWN under the new pipeline.
            current_task_state = await get_task_state(db, project_id, task_id)
            current_state_name = (
                current_task_state.get("state") if current_task_state else None
            )
            if current_state_name not in (State.LOCKED.name, State.HAS_IMAGERY.name):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Task must be LOCKED or HAS_IMAGERY to mark as fully flown."
                    ),
                )
            return await update_task_state(
                db,
                project_id,
                task_id,
                user_id,
                "Task marked as fully flown",
                State[current_state_name],
                State.FULLY_FLOWN,
                detail.updated_at,
            )

        case EventType.UNMARK_FLOWN:
            # Revert to whatever the prior state was in the event history
            # (LOCKED or HAS_IMAGERY), so the unmark is symmetric to the mark.
            # revert_task_state walks task_events newest-first, skipping prior
            # revert entries, to find the most recent distinct prior state.
            current_task_state = await get_task_state(db, project_id, task_id)
            current_state_name = (
                current_task_state.get("state") if current_task_state else None
            )
            if current_state_name != State.FULLY_FLOWN.name:
                raise HTTPException(
                    status_code=400,
                    detail="Task is not in FULLY_FLOWN state.",
                )
            latest_event_user_id = current_task_state.get("user_id")
            return await revert_task_state(
                db=db,
                project_id=project_id,
                task_id=task_id,
                current_state=current_state_name,
                current_user_id=latest_event_user_id,
                actor_name=user_data.name,
                updated_at=detail.updated_at,
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
            # Drone pilots may release their own LOCKED task (-> UNLOCKED).
            # The project admin may step the task back one state at a time
            # through the event history, which is useful for recovering tasks
            # that have progressed past LOCKED (e.g. stuck at HAS_IMAGERY or
            # in a failed processing run) without wiping all prior progress
            # in one click.
            current_task_state = await get_task_state(db, project_id, task_id)
            if (
                not current_task_state
                or current_task_state.get("state") == State.UNLOCKED.name
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Task is already unlocked.",
                )

            state = current_task_state.get("state")
            latest_event_user_id = current_task_state.get("user_id")
            is_author = project["author_id"] == user_id

            if not is_author:
                if state != State.LOCKED.name:
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "Only the project creator can revert this task "
                            "in its current state."
                        ),
                    )
                if user_id != latest_event_user_id:
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "You cannot unlock this task as it is locked by "
                            "another user."
                        ),
                    )

            return await revert_task_state(
                db=db,
                project_id=project_id,
                task_id=task_id,
                current_state=state,
                current_user_id=latest_event_user_id,
                actor_name=user_data.name,
                updated_at=detail.updated_at,
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
