import uuid
import json
from app.users.user_schemas import AuthUser
from app.tasks.task_schemas import TaskStats
from psycopg import Connection
from app.models.enums import HTTPStatus, State
from fastapi import HTTPException
from psycopg.rows import dict_row, class_row
from datetime import datetime


async def get_task_stats(db: Connection, user_data: AuthUser):
    try:
        async with db.cursor(row_factory=class_row(TaskStats)) as cur:
            raw_sql = """
                SELECT
                    COUNT(CASE WHEN te.state = 'REQUEST_FOR_MAPPING' THEN 1 END) AS request_logs,
                    COUNT(CASE WHEN te.state IN ('LOCKED_FOR_MAPPING', 'IMAGE_UPLOADED', 'IMAGE_PROCESSING_FAILED') THEN 1 END) AS ongoing_tasks,
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
                            'id', id
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
                SELECT *
                FROM task_events
                WHERE project_id = %(project_id)s AND task_id = %(task_id)s
                ORDER BY created_at DESC
                LIMIT 1
            ),
            locked AS (
                SELECT *
                FROM last
                WHERE user_id = %(user_id)s AND state = %(initial_state)s
            )
            INSERT INTO task_events(event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
            SELECT gen_random_uuid(), project_id, task_id, user_id, %(final_state)s, %(comment)s, %(updated_at)s, now()
            FROM last
            WHERE user_id = %(user_id)s
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
    """
    Retrieve the latest state of a task by querying the task_events table.

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
