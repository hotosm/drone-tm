import uuid
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import HTTPException
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import class_row, dict_row
from pydantic import BaseModel, model_validator
from pydantic.functional_validators import field_validator

from app.config import settings
from app.models.enums import EventType, HTTPStatus, State
from app.s3 import maybe_presign_s3_key


class Geometry(BaseModel):
    type: Literal["ST_Polygon"]
    coordinates: List[List[List[float]]]


class Properties(BaseModel):
    id: uuid.UUID
    bbox: List[float]


class Outline(BaseModel):
    id: uuid.UUID
    type: Literal["Feature"]
    geometry: Geometry
    properties: Properties


class NewEvent(BaseModel):
    event: EventType
    comment: Optional[str] = None
    updated_at: Optional[datetime] = None


class Task(BaseModel):
    task_id: Optional[uuid.UUID] = None
    state: Optional[str] = None
    project_id: Optional[uuid.UUID] = None
    outline: Optional[str] = None

    @staticmethod
    async def get_task_geometry(
        db: Connection,
        project_id: uuid.UUID,
        task_id: Optional[uuid.UUID] = None,
        split_area: Optional[bool] = False,
    ) -> str:
        """Fetches the geometry of a single task or all tasks in a project.

        Args:
            db (Connection): The database connection.
            project_id (UUID): The ID of the project.
            task_id (UUID, optional): The ID of a specific task. Defaults to None.

        Returns:
            str: The GeoJSON representation of the task or project geometry.
        """
        try:
            async with db.cursor(row_factory=class_row(Task)) as cur:
                if task_id:
                    await cur.execute(
                        """
                        SELECT ST_AsGeoJSON(outline) AS outline
                        FROM tasks
                        WHERE project_id = %(project_id)s AND id = %(task_id)s
                    """,
                        {"project_id": project_id, "task_id": task_id},
                    )
                    row = await cur.fetchone()
                    if row:
                        return row.outline
                    else:
                        raise HTTPException(status_code=404, detail="Task not found.")
                else:
                    if split_area:
                        await cur.execute(
                            """
                            SELECT jsonb_build_object(
                                'type',     'FeatureCollection',
                                'features', jsonb_agg(
                                    jsonb_build_object(
                                        'type',       'Feature',
                                        'geometry',   ST_AsGeoJSON(outline)::jsonb,
                                        'properties', jsonb_build_object(
                                            'unique_id',           project_id,
                                            'project_task_id',     project_task_index,
                                            'take_off_point',      CASE
                                                                      WHEN take_off_point IS NOT NULL
                                                                      THEN jsonb_build_array(
                                                                          ST_X(take_off_point),
                                                                          ST_Y(take_off_point)
                                                                      )
                                                                      ELSE NULL
                                                                    END,
                                            'total_area_sqkm',     total_area_sqkm,
                                            'flight_time_minutes', flight_time_minutes,
                                            'flight_distance_km',  flight_distance_km
                                        )
                                    )
                                )
                            )::text AS outline
                            FROM tasks
                            WHERE project_id = %(project_id)s
                        """,
                            {"project_id": project_id},
                        )
                        row = await cur.fetchone()
                        if row and row.outline:
                            return row.outline
                        else:
                            raise HTTPException(
                                status_code=404,
                                detail="No tasks found for this project.",
                            )
                    else:
                        await cur.execute(
                            """
                            SELECT ST_AsGeoJSON(ST_Union(outline)) AS outline
                            FROM tasks
                            WHERE project_id = %(project_id)s
                        """,
                            {"project_id": project_id},
                        )
                        row = await cur.fetchone()
                        if row and row.outline:
                            # Create a FeatureCollection with empty properties
                            feature_collection = f'{{"type": "FeatureCollection", "features": [{{"type": "Feature", "geometry": {row.outline}, "properties": {{}}}}]}}'
                            return feature_collection
                        else:
                            raise HTTPException(
                                status_code=404,
                                detail="No tasks found for this project.",
                            )
        except Exception as e:
            log.error(f"Error fetching task geometry: {e}")
            raise HTTPException(status_code=500, detail="Internal server error.")

    @staticmethod
    async def get_all_tasks(db: Connection, project_id: uuid.UUID):
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """SELECT id FROM tasks WHERE project_id = %(project_id)s""",
                {"project_id": str(project_id)},
            )

            data = await cur.fetchall()

            # Extracting the list of IDs from the data
            task_ids = [task["id"] for task in data]

            return task_ids

    @staticmethod
    async def all(db: Connection, project_id: uuid.UUID):
        async with db.cursor(row_factory=class_row(Task)) as cur:
            await cur.execute(
                """SELECT DISTINCT ON (task_id) project_id, task_id, state
                FROM task_events
                WHERE project_id = %(project_id)s
                ORDER BY task_id, created_at DESC
            """,
                {"project_id": project_id},
            )

            existing_tasks = await cur.fetchall()
            # Get all task_ids from the tasks table
            task_ids = await Task.get_all_tasks(db, project_id)

            # Create a set of existing task_ids for quick lookup
            existing_task_ids = {task.task_id for task in existing_tasks}

            # task ids that are not in task_events table
            remaining_task_ids = [x for x in task_ids if x not in existing_task_ids]

            # Add missing tasks with state as "UNLOCKED"
            remaining_tasks = [
                {
                    "project_id": str(project_id),
                    "task_id": task_id,
                    "state": State.UNLOCKED.name,
                }
                for task_id in remaining_task_ids
            ]
            # Combine both existing tasks and remaining tasks
            combined_tasks = existing_tasks + remaining_tasks
            return combined_tasks


class UserTasksOut(BaseModel):
    task_id: uuid.UUID
    total_area_sqkm: Optional[float] = None
    flight_time_minutes: Optional[float] = None
    flight_distance_km: Optional[float] = None
    created_at: datetime
    state: str
    project_id: uuid.UUID
    project_task_index: int
    project_name: str
    project_slug: Optional[str] = None
    updated_at: Optional[datetime]
    registration_certificate_url: Optional[str] = None
    certificate_url: Optional[str] = None

    @model_validator(mode="after")
    def set_urls(cls, values):
        """Set and format certificate and registration URLs."""
        values.certificate_url = maybe_presign_s3_key(values.certificate_url, 2)
        values.registration_certificate_url = maybe_presign_s3_key(
            values.registration_certificate_url, 2
        )

        return values

    @staticmethod
    async def get_tasks_by_user(
        db: Connection, user_id: str, skip: int = 0, limit: int = 50
    ):
        async with db.cursor(row_factory=class_row(UserTasksOut)) as cur:
            await cur.execute(
                """
                SELECT DISTINCT ON (tasks.id)
                    tasks.id AS task_id,
                    tasks.project_task_index AS project_task_index,
                    task_events.project_id AS project_id,
                    projects.name AS project_name,
                    projects.slug AS project_slug,
                    tasks.total_area_sqkm,
                    tasks.flight_time_minutes,
                    tasks.flight_distance_km,
                    task_events.created_at,
                    task_events.updated_at,
                    task_events.state,
                    user_profile.registration_certificate_url,
                    user_profile.certificate_url
                FROM
                    task_events
                LEFT JOIN
                    tasks ON task_events.task_id = tasks.id
                LEFT JOIN
                    projects ON task_events.project_id = projects.id
                LEFT JOIN
                    user_profile ON task_events.user_id = user_profile.user_id
                WHERE
                    (
                        task_events.user_id = %(user_id)s
                        AND task_events.state::text NOT IN ('UNLOCKED')
                    )
                    OR
                    task_events.project_id IN (
                        SELECT p.id
                        FROM projects p
                        WHERE p.author_id = %(user_id)s
                    )
                ORDER BY
                    tasks.id, task_events.created_at DESC
                OFFSET %(skip)s
                LIMIT %(limit)s;
                """,
                {"user_id": user_id, "skip": skip, "limit": limit},
            )
            try:
                return await cur.fetchall()

            except Exception as e:
                log.exception(e)
                raise HTTPException(
                    status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                    detail="Retrieval failed",
                ) from e


class TaskDetailsOut(BaseModel):
    total_area_sqkm: Optional[float] = None
    flight_time_minutes: Optional[float] = None
    flight_distance_km: Optional[float] = None
    total_image_uploaded: Optional[int] = None
    assets_url: Optional[str] = None
    outline: Outline
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    state: State
    project_id: Optional[uuid.UUID] = None
    project_slug: Optional[str] = None
    project_name: str
    project_task_index: int
    front_overlap: Optional[float] = None
    side_overlap: Optional[float] = None
    gsd_cm_px: Optional[float] = None
    gimble_angles_degrees: Optional[int] = None
    centroid: dict

    @model_validator(mode="after")
    def set_assets_url(cls, values):
        """Set assets_url to a browser-usable URL."""
        assets_url = values.assets_url
        if assets_url:
            # New ODM layout stores an S3 prefix ending in odm/ - convert to
            # the streaming export endpoint URL so the frontend gets a
            # downloadable link instead of a broken presigned prefix.
            if assets_url.startswith("projects/") and assets_url.endswith("/odm/"):
                parts = assets_url.split("/")
                if len(parts) >= 4:
                    values.assets_url = f"{settings.API_PREFIX}/projects/odm/export/{parts[1]}/{parts[2]}/"
            elif not assets_url.startswith("http"):
                values.assets_url = maybe_presign_s3_key(assets_url, 2)

        return values

    @field_validator("state", mode="after")
    @classmethod
    def integer_state_to_string(cls, value: State):
        if isinstance(value, str):
            value = value.name

        if isinstance(value, int):
            value = State(value).name
        return value

    @field_validator("state", mode="before")
    @classmethod
    def srting_state_to_integer(cls, value: State) -> str:
        if isinstance(value, str):
            value = State[value.strip()].value
        return value

    @staticmethod
    async def get_task_details(db: Connection, task_id: uuid.UUID):
        try:
            async with db.cursor(row_factory=class_row(TaskDetailsOut)) as cur:
                await cur.execute(
                    """
                    SELECT
                        tasks.total_area_sqkm,
                        tasks.flight_time_minutes,
                        tasks.flight_distance_km,
                        tasks.total_image_uploaded,
                        tasks.assets_url,
                        -- Construct the outline as a GeoJSON Feature
                        jsonb_build_object(
                            'type', 'Feature',
                            'geometry', jsonb_build_object(
                                'type', ST_GeometryType(tasks.outline)::text,  -- Get the type of the geometry (e.g., Polygon, MultiPolygon)
                                'coordinates', ST_AsGeoJSON(tasks.outline, 8)::jsonb->'coordinates'  -- Get the geometry coordinates
                            ),
                            'properties', jsonb_build_object(
                                'id', tasks.id,
                                'bbox', jsonb_build_array(  -- Build the bounding box
                                    ST_XMin(ST_Envelope(tasks.outline)),
                                    ST_YMin(ST_Envelope(tasks.outline)),
                                    ST_XMax(ST_Envelope(tasks.outline)),
                                    ST_YMax(ST_Envelope(tasks.outline))
                                )
                            ),
                            'id', tasks.id
                        ) AS outline,
                        -- Calculate the centroid of the outline
                        ST_AsGeoJSON(ST_Centroid(tasks.outline))::jsonb AS centroid,
                        te.created_at,
                        te.updated_at,
                        te.state,
                        tasks.project_id AS project_id,
                        projects.slug AS project_slug,
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
                            te.updated_at,
                            te.state
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

    @staticmethod
    async def get_task_by_project_and_index(
        db: Connection, project_id: uuid.UUID, task_index: int
    ):
        """Get task details by project ID and task index."""
        try:
            async with db.cursor(row_factory=class_row(TaskDetailsOut)) as cur:
                await cur.execute(
                    """
                    SELECT
                        tasks.total_area_sqkm,
                        tasks.flight_time_minutes,
                        tasks.flight_distance_km,
                        tasks.total_image_uploaded,
                        tasks.assets_url,
                        jsonb_build_object(
                            'type', 'Feature',
                            'geometry', jsonb_build_object(
                                'type', ST_GeometryType(tasks.outline)::text,
                                'coordinates', ST_AsGeoJSON(tasks.outline, 8)::jsonb->'coordinates'
                            ),
                            'properties', jsonb_build_object(
                                'id', tasks.id,
                                'bbox', jsonb_build_array(
                                    ST_XMin(ST_Envelope(tasks.outline)),
                                    ST_YMin(ST_Envelope(tasks.outline)),
                                    ST_XMax(ST_Envelope(tasks.outline)),
                                    ST_YMax(ST_Envelope(tasks.outline))
                                )
                            ),
                            'id', tasks.id
                        ) AS outline,
                        ST_AsGeoJSON(ST_Centroid(tasks.outline))::jsonb AS centroid,
                        te.created_at,
                        te.updated_at,
                        te.state,
                        tasks.project_id AS project_id,
                        projects.slug AS project_slug,
                        projects.name AS project_name,
                        tasks.project_task_index,
                        projects.front_overlap AS front_overlap,
                        projects.side_overlap AS side_overlap,
                        projects.gsd_cm_px AS gsd_cm_px,
                        projects.gimble_angles_degrees AS gimble_angles_degrees
                    FROM tasks
                    JOIN projects ON tasks.project_id = projects.id
                    LEFT JOIN (
                        SELECT DISTINCT ON (te.task_id)
                            te.task_id,
                            te.created_at,
                            te.updated_at,
                            te.state
                        FROM task_events te
                        ORDER BY te.task_id, te.created_at DESC
                    ) AS te ON te.task_id = tasks.id
                    WHERE tasks.project_id = %(project_id)s
                      AND tasks.project_task_index = %(task_index)s;
                    """,
                    {"project_id": project_id, "task_index": task_index},
                )
                record = await cur.fetchone()
                if not record:
                    raise HTTPException(
                        status_code=HTTPStatus.NOT_FOUND,
                        detail=f"Task with index {task_index} not found in project.",
                    )
                return record

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                detail=f"Failed to fetch task. {e}",
            )


class TaskStats(BaseModel):
    request_logs: int
    ongoing_tasks: int
    completed_tasks: int
    unflyable_tasks: int
