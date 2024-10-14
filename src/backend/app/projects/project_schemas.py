import json
import uuid
from typing import Annotated, Optional, List
from datetime import datetime, date
import geojson
from loguru import logger as log
from pydantic import BaseModel, computed_field, Field, model_validator, root_validator
from pydantic.functional_validators import AfterValidator
from pydantic.functional_serializers import PlainSerializer
from geojson_pydantic import Feature, FeatureCollection, Polygon, Point, MultiPolygon
from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import class_row
from slugify import slugify
from app.models.enums import FinalOutput, ProjectVisibility
from app.models.enums import (
    IntEnum,
    ProjectStatus,
    HTTPStatus,
)
from app.utils import (
    merge_multipolygon,
)
from psycopg.rows import dict_row
from app.config import settings
from app.s3 import get_presigned_url


class AssetsInfo(BaseModel):
    project_id: str
    task_id: str
    image_count: int
    assets_url: Optional[str]


def validate_geojson(
    value: FeatureCollection | Feature | Polygon,
) -> geojson.FeatureCollection:
    """Convert the upload GeoJSON to standardised FeatureCollection."""
    if value:
        return merge_multipolygon(value.model_dump())
    else:
        return None


def enum_to_str(value: IntEnum) -> str:
    """Get the string value of the enum for db insert."""
    return value.name


class ProjectIn(BaseModel):
    """Upload new project."""

    name: str
    description: str
    per_task_instructions: Optional[str] = None
    task_split_dimension: Optional[int] = None
    gsd_cm_px: Optional[float] = None
    altitude_from_ground: Optional[float] = None
    front_overlap: Optional[float] = None
    side_overlap: Optional[float] = None
    is_terrain_follow: bool = False
    outline: Annotated[
        FeatureCollection | Feature | Polygon, AfterValidator(validate_geojson)
    ]
    no_fly_zones: Annotated[
        Optional[FeatureCollection | Feature | Polygon],
        AfterValidator(validate_geojson),
    ] = None
    output_orthophoto_url: Optional[str] = None
    output_pointcloud_url: Optional[str] = None
    output_raw_url: Optional[str] = None
    deadline_at: Optional[date] = None
    visibility: Annotated[ProjectVisibility | str, PlainSerializer(enum_to_str)] = (
        ProjectVisibility.PUBLIC
    )
    status: Annotated[ProjectStatus | str, PlainSerializer(enum_to_str)] = (
        ProjectStatus.PUBLISHED
    )
    final_output: List[FinalOutput] = Field(
        ...,
        example=[
            "ORTHOPHOTO_2D",
            "ORTHOPHOTO_3D",
            "DIGITAL_TERRAIN_MODEL",
            "DIGITAL_SURFACE_MODEL",
        ],
    )
    requires_approval_from_manager_for_locking: Optional[bool] = False
    front_overlap: Optional[float] = None
    side_overlap: Optional[float] = None

    @computed_field
    @property
    def slug(self) -> str:
        """
        Generate a unique slug based on the provided name.

        The slug is created by converting the given name into a URL-friendly format and appending
        the current date and time to ensure uniqueness. The date and time are formatted as
        "ddmmyyyyHHMM" to create a timestamp.

        Args:
            name (str): The name from which the slug will be generated.

        Returns:
            str: The generated slug, which includes the URL-friendly version of the name and
                a timestamp. If an error occurs during the generation, an empty string is returned.

        Raises:
            Exception: If an error occurs during the slug generation process.
        """
        try:
            slug = slugify(self.name)
            now = datetime.now()
            date_time_str = now.strftime("%d%m%Y%H%M")
            slug_with_date = f"{slug}-{date_time_str}"
            return slug_with_date
        except Exception as e:
            log.error(f"An error occurred while generating the slug: {e}")
            return ""

    @model_validator(mode="before")
    @classmethod
    def validate_to_json(cls, value):
        if isinstance(value, str):
            return cls(**json.loads(value))
        return value


class AssetsInfoData(BaseModel):
    project_id: int


class TaskOut(BaseModel):
    """Base project model."""

    id: uuid.UUID
    project_id: uuid.UUID
    project_task_index: int
    outline: Optional[Polygon | Feature | FeatureCollection] = None
    state: Optional[str] = None
    user_id: Optional[str] = None
    task_area: Optional[float] = None
    name: Optional[str] = None
    image_count: Optional[int] = None
    assets_url: Optional[str] = None

    # @model_validator(mode="after")
    # def set_assets_url(cls, values):
    #     """Set image_url and image count before rendering the model."""
    #     task_id = values.id
    #     project_id = values.project_id

    #     if task_id and project_id:
    #         data = project_logic.get_project_info_from_s3(project_id, task_id)
    #         if data:
    #             return values.copy(
    #                 update={
    #                     "assets_url": data.assets_url,
    #                     "image_count": data.image_count,
    #                 }
    #             )

    #     return values


class DbProject(BaseModel):
    """Project model for extracting from database."""

    id: uuid.UUID
    name: str
    slug: Optional[str] = None
    short_description: Optional[str] = None
    description: str = None
    per_task_instructions: Optional[str] = None
    organisation_id: Optional[int] = None
    outline: Optional[Polygon | Feature | FeatureCollection]
    centroid: Optional[Point | Feature | Polygon] = None
    no_fly_zones: Optional[MultiPolygon | Polygon | Feature] = None
    task_count: int = 0
    tasks: Optional[list[TaskOut]] = []
    requires_approval_from_manager_for_locking: Optional[bool] = None
    author_id: Optional[str] = None
    front_overlap: Optional[float] = None
    side_overlap: Optional[float] = None
    gsd_cm_px: Optional[float] = None
    altitude_from_ground: Optional[float] = None
    is_terrain_follow: bool = False
    image_url: Optional[str] = None

    async def one(db: Connection, project_id: uuid.UUID):
        """Get a single project &  all associated tasks by ID."""
        async with db.cursor(row_factory=class_row(DbProject)) as cur:
            await cur.execute(
                """
                SELECT
                    projects.*,
                    jsonb_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(projects.outline)::jsonb,
                        'properties', jsonb_build_object(
                            'id', projects.id,
                            'bbox', jsonb_build_array(
                                ST_XMin(ST_Envelope(projects.outline)),
                                ST_YMin(ST_Envelope(projects.outline)),
                                ST_XMax(ST_Envelope(projects.outline)),
                                ST_YMax(ST_Envelope(projects.outline))
                            )
                        ),
                        'id', projects.id
                    ) AS outline,
                    jsonb_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(projects.outline)::jsonb,
                        'properties', jsonb_build_object(
                            'id', projects.id,
                            'bbox', jsonb_build_array(
                                ST_XMin(ST_Envelope(projects.no_fly_zones)),
                                ST_YMin(ST_Envelope(projects.no_fly_zones)),
                                ST_XMax(ST_Envelope(projects.no_fly_zones)),
                                ST_YMax(ST_Envelope(projects.no_fly_zones))
                            )
                        ),
                        'id', projects.id
                    ) AS no_fly_zones,
                    ST_AsGeoJSON(projects.centroid)::jsonb AS centroid

                FROM
                    projects
                WHERE
                    projects.id = %(project_id)s
                LIMIT 1;
            """,
                {"project_id": project_id},
            )
            project_record = await cur.fetchone()

        if not project_record:
            raise HTTPException(
                status_code=HTTPStatus.FORBIDDEN,
                detail=f"Project with ID {project_id} not found.",
            )

        async with db.cursor(row_factory=class_row(TaskOut)) as cur:
            await cur.execute(
                """
                WITH TaskStateCalculation AS (
                    SELECT DISTINCT ON (te.task_id)
                        te.task_id,
                        te.user_id,
                        CASE
                            WHEN te.state = 'REQUEST_FOR_MAPPING' THEN 'request logs'
                            WHEN te.state = 'LOCKED_FOR_MAPPING' OR te.state = 'IMAGE_UPLOADED' THEN 'ongoing'
                            WHEN te.state = 'IMAGE_PROCESSED' THEN 'completed'
                            WHEN te.state = 'UNFLYABLE_TASK' THEN 'unflyable task'
                            ELSE ''
                        END AS calculated_state
                    FROM
                        task_events te
                    ORDER BY
                        te.task_id, te.created_at DESC
                ),
                TaskGeoJSON AS (
                    SELECT
                        t.id,
                        t.project_task_index,
                        t.project_id,
                        ST_AsGeoJSON(t.outline)::jsonb -> 'coordinates' AS coordinates,
                        ST_AsGeoJSON(t.outline)::jsonb -> 'type' AS type,
                        ST_XMin(ST_Envelope(t.outline)) AS xmin,
                        ST_YMin(ST_Envelope(t.outline)) AS ymin,
                        ST_XMax(ST_Envelope(t.outline)) AS xmax,
                        ST_YMax(ST_Envelope(t.outline)) AS ymax,
                        COALESCE(tsc.calculated_state) AS state,
                        tsc.user_id,
                        u.name,
                        ST_Area(ST_Transform(t.outline, 3857)) / 1000000 AS task_area
                    FROM
                        tasks t
                    LEFT JOIN
                        TaskStateCalculation tsc ON t.id = tsc.task_id
                    LEFT JOIN
                        users u ON tsc.user_id = u.id
                    WHERE
                        t.project_id = %(project_id)s
                )
                SELECT
                    id,
                    project_task_index,
                    state,
                    user_id,
                    name,
                    task_area,
                    project_id,
                    jsonb_build_object(
                        'type', 'Feature',
                        'geometry', jsonb_build_object(
                            'type', type,
                            'coordinates', coordinates
                        ),
                        'properties', jsonb_build_object(
                            'id', id,
                            'bbox', jsonb_build_array(xmin, ymin, xmax, ymax)
                        ),
                        'id', id
                    ) AS outline
                FROM
                    TaskGeoJSON;
                """,
                {"project_id": project_id},
            )

            task_records = await cur.fetchall()
            project_record.tasks = task_records if task_records is not None else []
            project_record.task_count = len(task_records)
            return project_record

    async def all(
        db: Connection,
        user_id: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ):
        """
        Get all projects, count total tasks and task states (ongoing, completed, etc.).
        Optionally filter by the project creator (user) and search by project name.
        """
        search_term = f"%{search}%" if search else "%"
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                    p.id, p.slug, p.name, p.description, p.per_task_instructions,
                    ST_AsGeoJSON(p.outline)::jsonb AS outline,
                    p.requires_approval_from_manager_for_locking,

                    -- Count total tasks for each project
                    COUNT(t.id) AS total_task_count,

                    -- Count based on the latest state of tasks
                    COUNT(CASE WHEN te.state IN ('LOCKED_FOR_MAPPING', 'REQUEST_FOR_MAPPING', 'IMAGE_UPLOADED', 'UNFLYABLE_TASK') THEN 1 END) AS ongoing_task_count,

                    -- Count based on the latest state of tasks
                    COUNT(CASE WHEN te.state = 'IMAGE_PROCESSED' THEN 1 END) AS completed_task_count

                FROM projects p
                LEFT JOIN tasks t ON t.project_id = p.id
                LEFT JOIN (
                    -- Get the latest event per task
                    SELECT DISTINCT ON (te.task_id)
                        te.task_id,
                        te.state,
                        te.created_at
                    FROM task_events te
                    ORDER BY te.task_id, te.created_at DESC
                ) AS te ON te.task_id = t.id

                WHERE (p.author_id = COALESCE(%(user_id)s, p.author_id))
                AND p.name ILIKE %(search)s
                GROUP BY p.id
                ORDER BY p.created_at DESC
                OFFSET %(skip)s
                LIMIT %(limit)s
                """,
                {
                    "skip": skip,
                    "limit": limit,
                    "user_id": user_id,
                    "search": search_term,
                },
            )
            db_projects = await cur.fetchall()

        async with db.cursor() as cur:
            await cur.execute(
                """
                SELECT COUNT(*) FROM projects p
                WHERE (p.author_id = COALESCE(%(user_id)s, p.author_id))
                AND p.name ILIKE %(search)s""",
                {"user_id": user_id, "search": search_term},
            )

            total_count = await cur.fetchone()

        return db_projects, total_count[0]

    @staticmethod
    async def create(db: Connection, project: ProjectIn, user_id: str) -> uuid.UUID:
        """Create a single project."""
        # NOTE we first check if a project with this name exists
        # It is easier to do this than complex upsert logic
        async with db.cursor() as cur:
            sql = """
                SELECT EXISTS (
                    SELECT 1
                    FROM projects
                    WHERE LOWER(name) = %(name)s
                )
            """
            await cur.execute(sql, {"name": project.name.lower()})
            project_exists = await cur.fetchone()
            if project_exists[0]:
                msg = f"Project name ({project.name}) already exists!"
                log.warning(f"User ({user_id}) failed project creation: {msg}")
                raise HTTPException(status_code=HTTPStatus.CONFLICT, detail=msg)
        # NOTE exclude_none is used over exclude_unset, or default value are not included
        model_dump = project.model_dump(
            exclude_none=True, exclude=["outline", "centroid"]
        )
        columns = ", ".join(model_dump.keys())
        value_placeholders = ", ".join(f"%({key})s" for key in model_dump.keys())
        sql = f"""
            INSERT INTO projects (
                id, author_id, outline, centroid, created_at, {columns}
            )
            VALUES (
                gen_random_uuid(),
                %(author_id)s,
                ST_GeomFromGeoJSON(%(outline)s),
                ST_Centroid(ST_GeomFromGeoJSON(%(outline)s)),
                NOW(),
                {value_placeholders}
            )
            RETURNING id;
        """
        # We only want the first geometry (they should be merged previously)
        outline_geometry = json.dumps(project.outline["features"][0]["geometry"])
        # Add required author_id and outline as json
        model_dump.update(
            {
                "author_id": user_id,
                "outline": outline_geometry,
            }
        )
        # Append no fly zones if they are present
        # FIXME they are merged to a single geom!
        if project.no_fly_zones:
            no_fly_geoms = json.dumps(project.no_fly_zones["features"][0]["geometry"])
            model_dump.update(
                {
                    "no_fly_zones": no_fly_geoms,
                }
            )

        async with db.cursor() as cur:
            await cur.execute(sql, model_dump)
            new_project_id = await cur.fetchone()

            if not new_project_id:
                msg = f"Unknown SQL error for data: {model_dump}"
                log.warning(f"User ({user_id}) failed project creation: {msg}")
                raise HTTPException(
                    status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=msg
                )

            return new_project_id[0]

    @staticmethod
    async def delete(db: Connection, project_id: uuid.UUID) -> uuid.UUID:
        """Delete a single project if the user is the author or a superuser."""
        sql = """
        WITH deleted_project AS (
            DELETE FROM projects
            WHERE id = %(project_id)s
            RETURNING id
        ), deleted_tasks AS (
            DELETE FROM tasks
            WHERE project_id = %(project_id)s
            RETURNING project_id
        ), deleted_task_events AS (
            DELETE FROM task_events
            WHERE project_id = %(project_id)s
            RETURNING project_id
        )
        SELECT id FROM deleted_project
        """

        async with db.cursor() as cur:
            await cur.execute(sql, {"project_id": project_id})
            deleted_project_id = await cur.fetchone()

            if not deleted_project_id:
                log.warning(f"Failed to delete project ({project_id})")
                raise HTTPException(
                    status_code=HTTPStatus.FORBIDDEN,
                    detail="User not authorized to delete it.",
                )
            return deleted_project_id[0]


class Pagination(BaseModel):
    has_next: bool
    has_prev: bool
    next_num: Optional[int]
    prev_num: Optional[int]
    page: int
    per_page: int
    total: int

    @root_validator(pre=True)
    def calculate_pagination(cls, values):
        page = values.get("page", 1)
        total = values.get("total", 1)

        values["has_next"] = page < total
        values["has_prev"] = page > 1
        values["next_num"] = page + 1 if values["has_next"] else None
        values["prev_num"] = page - 1 if values["has_prev"] else None

        return values


class ProjectInfo(BaseModel):
    """Out model for the project endpoint."""

    id: uuid.UUID
    slug: Optional[str] = None
    name: str
    description: str
    per_task_instructions: Optional[str] = None
    requires_approval_from_manager_for_locking: Optional[bool] = None
    outline: Optional[Polygon | Feature | FeatureCollection]
    no_fly_zones: Optional[Polygon | Feature | FeatureCollection | MultiPolygon] = None
    requires_approval_from_manager_for_locking: bool
    total_task_count: int = 0
    tasks: Optional[list[TaskOut]] = []
    image_url: Optional[str] = None
    ongoing_task_count: Optional[int] = 0
    completed_task_count: Optional[int] = 0
    status: Optional[str] = "not-started"

    @model_validator(mode="after")
    def set_image_url(cls, values):
        """Set image_url before rendering the model."""
        project_id = values.id
        if project_id:
            image_dir = f"projects/{project_id}/map_screenshot.png"
            # values.image_url = get_image_dir_url(settings.S3_BUCKET_NAME, image_dir)
            values.image_url = get_presigned_url(settings.S3_BUCKET_NAME, image_dir, 5)
        return values

    @model_validator(mode="after")
    def calculate_status(cls, values):
        """Set the project status based on task counts."""
        ongoing_task_count = values.ongoing_task_count
        completed_task_count = values.completed_task_count
        total_task_count = values.total_task_count

        if completed_task_count == 0 and ongoing_task_count == 0:
            values.status = "not-started"
        elif completed_task_count == total_task_count:
            values.status = "completed"
        else:
            values.status = "ongoing"

        return values


class ProjectOut(BaseModel):
    """Base project model."""

    results: Optional[list[ProjectInfo]] = []
    pagination: Optional[Pagination] = {}


class PresignedUrlRequest(BaseModel):
    project_id: uuid.UUID
    task_id: uuid.UUID
    image_name: List[str]
    expiry: int  # Expiry time in hours
