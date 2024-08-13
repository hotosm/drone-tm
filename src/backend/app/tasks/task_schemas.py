from typing import Optional
from pydantic import BaseModel, validator
from app.models.enums import EventType, HTTPStatus, State
import uuid
from datetime import datetime
from psycopg import Connection
from loguru import logger as log
from fastapi import HTTPException
from psycopg.rows import class_row


class NewEvent(BaseModel):
    event: EventType


class Task(BaseModel):
    task_id: uuid.UUID
    task_area: float = None
    created_at: datetime = None
    state: State = None
    project_id: uuid.UUID
    # final_state: Optional[State] = None
    # initial_state: Optional[State] = None

    @validator("state", pre=True, always=True)
    def validate_state(cls, v):
        if isinstance(v, str):
            # Attempt to match the string to an enum value
            try:
                return State[v]
            except KeyError:
                raise ValueError(f"Unknown state label: {v}")
        return v

    async def all(db: Connection, project_id: uuid.UUID):
        async with db.cursor(row_factory=class_row(Task)) as cur:
            await cur.execute(
                """
                WITH all_tasks AS (
                    SELECT id AS task_id
                    FROM tasks
                    WHERE project_id = %(project_id)s
                ),
                latest_task_events AS (
                    SELECT DISTINCT ON (task_id) task_id, state
                    FROM task_events
                    WHERE project_id = %(project_id)s
                    ORDER BY task_id, created_at DESC
                )
                SELECT
                    %(project_id)s AS project_id,
                    all_tasks.task_id,
                    COALESCE(latest_task_events.state, %(default_state)s) AS state
                FROM all_tasks
                LEFT JOIN latest_task_events
                ON all_tasks.task_id = latest_task_events.task_id
                """,
                {"project_id": project_id, "default_state": State.UNLOCKED_TO_MAP.name},
            )

            tasks_with_states = await cur.fetchall()
            return tasks_with_states


class UserTasksStatsOut(BaseModel):
    task_id: uuid.UUID
    task_area: float
    created_at: datetime
    state: str
    project_id: uuid.UUID

    @staticmethod
    async def get_tasks_by_user(db: Connection, user_id: str):
        async with db.cursor(row_factory=class_row(UserTasksStatsOut)) as cur:
            await cur.execute(
                """WITH task_details AS (
                SELECT
                    tasks.id AS task_id,
                    task_events.project_id AS project_id,
                    ST_Area(ST_Transform(tasks.outline, 4326)) / 1000000 AS task_area,
                    task_events.created_at,
                    task_events.state
                FROM
                    task_events
                JOIN
                    tasks ON task_events.task_id = tasks.id
                WHERE
                    task_events.user_id = %(user_id)s
            )
            SELECT
                task_details.task_id,
                task_details.project_id,
                task_details.task_area,
                task_details.created_at,
                CASE
                    WHEN task_details.state = 'REQUEST_FOR_MAPPING' THEN 'request logs'
                    WHEN task_details.state = 'LOCKED_FOR_MAPPING' THEN 'ongoing'
                    WHEN task_details.state = 'UNLOCKED_DONE' THEN 'completed'
                    WHEN task_details.state = 'UNFLYABLE_TASK' THEN 'unflyable task'
                    ELSE 'UNLOCKED_TO_MAP' -- Default case if the state does not match any expected values
                END AS state
            FROM task_details;""",
                {"user_id": user_id},
            )
            try:
                return await cur.fetchall()

            except Exception as e:
                log.exception(e)
                raise HTTPException(
                    status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                    detail="Retrieval failed",
                ) from e
