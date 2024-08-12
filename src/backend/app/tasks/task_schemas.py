from pydantic import BaseModel
from app.models.enums import EventType, HTTPStatus
import uuid
from datetime import datetime
from psycopg import Connection
from loguru import logger as log
from fastapi import HTTPException
from psycopg.rows import class_row


class NewEvent(BaseModel):
    event: EventType


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
