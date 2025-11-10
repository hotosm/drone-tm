import json
import uuid
from datetime import date, datetime
from typing import Annotated, List, Optional, Union

import geojson
from fastapi import HTTPException
from geojson_pydantic import Feature, FeatureCollection, MultiPolygon, Point, Polygon
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import class_row, dict_row
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    computed_field,
    model_validator,
)
from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import AfterValidator
from slugify import slugify

from app.config import settings
from app.models.enums import (
    FinalOutput,
    HTTPStatus,
    IntEnum,
    ProjectCompletionStatus,
    ProjectStatus,
    ProjectVisibility,
    RegulatorApprovalStatus,
    UserRole,
)
from app.s3 import (
    generate_presigned_download_url,
    generate_static_url,
    get_assets_url_for_project,
    get_orthophoto_url_for_project,
)
from app.utils import (
    merge_multipolygon,
)


class CentroidOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    centroid: dict
    total_task_count: int
    ongoing_task_count: int
    completed_task_count: int
    status: str = None

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


class AssetsInfo(BaseModel):
    project_id: str
    task_id: str
    image_count: int
    assets_url: Optional[str]
    state: Optional[UserRole] = None


def validate_geojson(
    value: FeatureCollection | Feature | Polygon,
) -> geojson.FeatureCollection:
    """Convert the upload GeoJSON to standardised FeatureCollection."""
    if value:
        return merge_multipolygon(value.model_dump())
    else:
        return None


def enum_to_str(value: Union[IntEnum, str]) -> str:
    """Get the string value of the enum for db insert.
    Handles both IntEnum objects and string values.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, IntEnum):
        return value.name
    return value


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
        json_schema_extra=[
            "ORTHOPHOTO_2D",
            "ORTHOPHOTO_3D",
            "DIGITAL_TERRAIN_MODEL",
            "DIGITAL_SURFACE_MODEL",
        ],
    )
    requires_approval_from_manager_for_locking: Optional[bool] = False
    requires_approval_from_regulator: Optional[bool] = False
    regulator_emails: Optional[List[EmailStr]] = None
    front_overlap: Optional[float] = None
    side_overlap: Optional[float] = None

    @computed_field
    @property
    def slug(self) -> str:
        """Generate a unique slug based on the provided name.

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
    name: Optional[str] = None
    image_count: Optional[int] = None
    assets_url: Optional[str] = None
    total_area_sqkm: Optional[float] = None
    flight_time_minutes: Optional[float] = None
    flight_distance_km: Optional[float] = None
    total_image_uploaded: Optional[int] = None

    @model_validator(mode="after")
    def set_assets_url(cls, values):
        """Set image_url before rendering the model."""
        assets_url = values.assets_url
        if assets_url:
            values.assets_url = generate_static_url(settings.S3_BUCKET_NAME, assets_url)

        return values


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
    requires_approval_from_regulator: Optional[bool] = False
    regulator_emails: Optional[List[EmailStr]] = None
    regulator_approval_status: Optional[str] = None
    image_processing_status: Optional[str] = None
    oam_upload_status: Optional[str] = None
    assets_url: Optional[str] = None
    orthophoto_url: Optional[str] = None
    regulator_comment: Optional[str] = None
    commenting_regulator_id: Optional[str] = None
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    project_area: Optional[float] = None
    front_overlap: Optional[float] = None
    side_overlap: Optional[float] = None
    gsd_cm_px: Optional[float] = None
    altitude_from_ground: Optional[float] = None
    is_terrain_follow: bool = False
    image_url: Optional[str] = None
    created_at: datetime

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
                    ST_AsGeoJSON(projects.centroid)::jsonb AS centroid,
                    users.name as author_name,
                    COALESCE(SUM(ST_Area(tasks.outline::geography)) / 1000000, 0) AS project_area

                FROM
                    projects
                JOIN
                    users ON projects.author_id = users.id
                LEFT JOIN
                    tasks ON projects.id = tasks.project_id
                WHERE
                    projects.id = %(project_id)s
                GROUP BY
                    projects.id, users.name
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
                        te.state
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
                        t.total_area_sqkm,
                        t.flight_time_minutes,
                        t.flight_distance_km,
                        t.assets_url,
                        t.total_image_uploaded,
                        ST_AsGeoJSON(t.outline)::jsonb -> 'coordinates' AS coordinates,
                        ST_AsGeoJSON(t.outline)::jsonb -> 'type' AS type,
                        ST_XMin(ST_Envelope(t.outline)) AS xmin,
                        ST_YMin(ST_Envelope(t.outline)) AS ymin,
                        ST_XMax(ST_Envelope(t.outline)) AS xmax,
                        ST_YMax(ST_Envelope(t.outline)) AS ymax,
                        tsc.state AS state,
                        tsc.user_id,
                        u.name
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
                    project_id,
                    total_area_sqkm,
                    flight_distance_km,
                    flight_time_minutes,
                    total_image_uploaded,
                    assets_url,
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
        status: Optional[ProjectCompletionStatus] = None,
        skip: int = 0,
        limit: int = 100,
    ):
        """Get all projects, count total tasks and task states (ongoing, completed, etc.).
        Optionally filter by the project creator (user), search by project name, and status.
        """
        search_term = f"%{search}%" if search else "%"
        status_value = status.value if status else None

        async with db.cursor(row_factory=dict_row) as cur:
            query = """
                WITH project_stats AS (
                    SELECT
                        p.id,
                        p.slug,
                        p.name,
                        p.description,
                        p.per_task_instructions,
                        p.created_at,
                        p.author_id,
                        ST_AsGeoJSON(p.outline)::jsonb AS outline,
                        p.requires_approval_from_manager_for_locking,
                        COUNT(t.id) AS total_task_count,
                        COUNT(CASE WHEN te.state IN ('LOCKED_FOR_MAPPING', 'REQUEST_FOR_MAPPING', 'IMAGE_UPLOADED', 'UNFLYABLE_TASK') THEN 1 END) AS ongoing_task_count,
                        COUNT(CASE WHEN te.state = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) AS completed_task_count,
                        CASE
                            WHEN COUNT(CASE WHEN te.state = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) = COUNT(t.id) THEN 'completed'
                            WHEN COUNT(CASE WHEN te.state IN ('LOCKED_FOR_MAPPING', 'REQUEST_FOR_MAPPING', 'IMAGE_UPLOADED', 'UNFLYABLE_TASK') THEN 1 END) = 0
                                AND COUNT(CASE WHEN te.state = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) = 0 THEN 'not-started'
                            ELSE 'ongoing'
                        END AS calculated_status
                    FROM projects p
                    LEFT JOIN tasks t ON t.project_id = p.id
                    LEFT JOIN (
                        SELECT DISTINCT ON (te.task_id)
                            te.task_id,
                            te.state,
                            te.created_at
                        FROM task_events te
                        ORDER BY te.task_id, te.created_at DESC
                    ) AS te ON te.task_id = t.id
                    WHERE (p.author_id = COALESCE(%(user_id)s, p.author_id))
                    AND p.name ILIKE %(search)s
                    GROUP BY p.id, p.slug, p.name, p.description, p.per_task_instructions, p.created_at, p.author_id, p.outline, p.requires_approval_from_manager_for_locking
                )
                SELECT *
                FROM project_stats
                WHERE CAST(%(status)s AS text) IS NULL
                    OR calculated_status = CAST(%(status)s AS text)
                ORDER BY created_at DESC
                OFFSET %(skip)s
                LIMIT %(limit)s
            """

            await cur.execute(
                query,
                {
                    "skip": skip,
                    "limit": limit,
                    "user_id": user_id,
                    "search": search_term,
                    "status": status_value,
                },
            )
            db_projects = await cur.fetchall()

        async with db.cursor() as cur:
            count_query = """
                WITH project_stats AS (
                    SELECT
                        p.id,
                        CASE
                            WHEN COUNT(CASE WHEN te.state = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) = COUNT(t.id) THEN 'completed'
                            WHEN COUNT(CASE WHEN te.state IN ('LOCKED_FOR_MAPPING', 'REQUEST_FOR_MAPPING', 'IMAGE_UPLOADED', 'UNFLYABLE_TASK') THEN 1 END) = 0
                                AND COUNT(CASE WHEN te.state = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) = 0 THEN 'not-started'
                            ELSE 'ongoing'
                        END AS calculated_status
                    FROM projects p
                    LEFT JOIN tasks t ON t.project_id = p.id
                    LEFT JOIN (
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
                )
                SELECT COUNT(*)
                FROM project_stats
                WHERE CAST(%(status)s AS text) IS NULL
                    OR calculated_status = CAST(%(status)s AS text)
            """
            await cur.execute(
                count_query,
                {"user_id": user_id, "search": search_term, "status": status_value},
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
        # NOTE to change the approach here to pass the value
        if "regulator_emails" in model_dump.keys():
            model_dump["regulator_approval_status"] = (
                RegulatorApprovalStatus.PENDING.name
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

    @model_validator(mode="before")
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
    requires_approval_from_regulator: Optional[bool] = False
    regulator_emails: Optional[List[EmailStr]] = None
    regulator_approval_status: Optional[str] = None
    image_processing_status: Optional[str] = None
    oam_upload_status: Optional[str] = None
    assets_url: Optional[str] = None
    orthophoto_url: Optional[str] = None
    regulator_comment: Optional[str] = None
    commenting_regulator_id: Optional[str] = None
    author_name: Optional[str] = None
    project_area: Optional[float] = None
    total_task_count: int = 0
    tasks: Optional[list[TaskOut]] = []
    image_url: Optional[str] = None
    ongoing_task_count: Optional[int] = 0
    completed_task_count: Optional[int] = 0
    status: Optional[str] = "not-started"
    created_at: datetime
    author_id: str
    is_terrain_follow: bool = False

    @model_validator(mode="after")
    def set_image_url(cls, values):
        """Set image_url before rendering the model."""
        project_id = values.id
        if project_id:
            image_dir = f"dtm-data/projects/{project_id}/map_screenshot.png"
            values.image_url = generate_presigned_download_url(
                settings.S3_BUCKET_NAME, image_dir, 5
            )
        return values

    @model_validator(mode="after")
    def set_assets_url(cls, values):
        """Set assets_url before rendering the model."""
        project_id = values.id
        if project_id:
            values.assets_url = (
                get_assets_url_for_project(project_id)
                if values.image_processing_status == "SUCCESS"
                else None
            )
        return values

    @model_validator(mode="after")
    def set_orthophoto_url(cls, values):
        """Set orthophoto_url before rendering the model."""
        project_id = values.id
        if project_id:
            values.orthophoto_url = (
                get_orthophoto_url_for_project(project_id)
                if values.image_processing_status == "SUCCESS"
                else None
            )
        return values

    @model_validator(mode="after")
    def calculate_status(cls, values):
        """Set the project status based on task counts."""
        ongoing_task_count = values.ongoing_task_count
        completed_task_count = values.completed_task_count
        total_task_count = values.total_task_count

        if completed_task_count == 0 and ongoing_task_count == 0:
            values.status = ProjectCompletionStatus.NOT_STARTED
        elif completed_task_count == total_task_count:
            values.status = ProjectCompletionStatus.COMPLETED
        else:
            values.status = ProjectCompletionStatus.ON_GOING

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


class MultipartUploadRequest(BaseModel):
    project_id: uuid.UUID
    task_id: Optional[uuid.UUID] = None
    file_name: str
    staging: bool = False  # If True, upload to user-uploads staging directory


class SignPartUploadRequest(BaseModel):
    upload_id: str
    file_key: str
    part_number: int
    expiry: int = 2  # Expiry time in hours


class CompleteMultipartUploadRequest(BaseModel):
    upload_id: str
    file_key: str
    parts: List[dict]  # List of {"PartNumber": int, "ETag": str}
    project_id: uuid.UUID
    filename: str


class AbortMultipartUploadRequest(BaseModel):
    upload_id: str
    file_key: str
