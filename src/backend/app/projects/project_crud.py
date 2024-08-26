import json
import uuid
import os
from app.projects import project_schemas
from loguru import logger as log
import shapely.wkb as wkblib
from shapely.geometry import shape
from fastapi import HTTPException, UploadFile
from app.utils import merge_multipolygon
from fmtm_splitter.splitter import split_by_square
from fastapi.concurrency import run_in_threadpool
from databases import Database
from app.models.enums import ProjectStatus
from app.utils import generate_slug
from app.projects.image_processing import TaskProcessor
from io import BytesIO
from app.s3 import add_obj_to_bucket
from app.config import settings
from app.s3 import list_objects_from_bucket, get_file_from_bucket
from concurrent.futures import ThreadPoolExecutor


async def update_project_dem_url(db: Database, project_id: uuid.UUID, dem_url: str):
    """Update the DEM URL for a project."""
    query = """
        UPDATE projects
        SET dem_url = :dem_url
        WHERE id = :project_id
    """
    await db.execute(query, {"dem_url": dem_url, "project_id": project_id})
    return True


async def upload_dem_to_s3(project_id: uuid.UUID, dem_file: UploadFile) -> str:
    """Upload dem into S3.

    Args:
        project_id (int): The organisation id in the database.
        dem_file (UploadFile): The logo image uploaded to FastAPI.

    Returns:
        dem_url(str): The S3 URL for the dem file.
    """
    dem_path = f"/dem/{project_id}/dem.tif"

    file_bytes = await dem_file.read()
    file_obj = BytesIO(file_bytes)

    add_obj_to_bucket(
        settings.S3_BUCKET_NAME,
        file_obj,
        dem_path,
        content_type=dem_file.content_type,
    )

    dem_url = f"{settings.S3_DOWNLOAD_ROOT}/{settings.S3_BUCKET_NAME}{dem_path}"

    return dem_url


async def create_project_with_project_info(
    db: Database, author_id: uuid.UUID, project_metadata: project_schemas.ProjectIn
):
    """Create a project in database."""
    _id = uuid.uuid4()
    query = """
        INSERT INTO projects (
            id, slug, author_id, name, description, per_task_instructions, status, visibility, outline, no_fly_zones,
            gsd_cm_px, front_overlap, side_overlap, final_output ,altitude_from_ground,is_terrain_follow, task_split_dimension, deadline_at,
            requires_approval_from_manager_for_locking, created_at)
        VALUES (
            :id,
            :slug,
            :author_id,
            :name,
            :description,
            :per_task_instructions,
            :status,
            :visibility,
            :outline,
            :no_fly_zones,
            :gsd_cm_px,
            :front_overlap,
            :side_overlap,
            :final_output,
            :altitude_from_ground,
            :is_terrain_follow,
            :task_split_dimension,
            :deadline_at,
            :requires_approval_from_manager_for_locking,
            CURRENT_TIMESTAMP
        )
        RETURNING id
    """
    try:
        project_id = await db.execute(
            query,
            values={
                "id": _id,
                "slug": generate_slug(project_metadata.name),
                "author_id": author_id,
                "name": project_metadata.name,
                "description": project_metadata.description,
                "per_task_instructions": project_metadata.per_task_instructions,
                "status": ProjectStatus.DRAFT.name,
                "visibility": project_metadata.visibility.name,
                "outline": str(project_metadata.outline),
                "gsd_cm_px": project_metadata.gsd_cm_px,
                "altitude_from_ground": project_metadata.altitude_from_ground,
                "is_terrain_follow": project_metadata.is_terrain_follow,
                "no_fly_zones": str(project_metadata.no_fly_zones)
                if project_metadata.no_fly_zones is not None
                else None,
                "task_split_dimension": project_metadata.task_split_dimension,
                "deadline_at": project_metadata.deadline_at,
                "final_output": [item.value for item in project_metadata.final_output],
                "requires_approval_from_manager_for_locking": project_metadata.requires_approval_from_manager_for_locking,
                "front_overlap": project_metadata.front_overlap,
                "side_overlap": project_metadata.side_overlap,
            },
        )
        return project_id

    except Exception as e:
        log.exception(e)
        raise HTTPException(e) from e


async def get_project_by_id(db: Database, project_id: uuid.UUID):
    "Get a single database project object by project_id"

    query = """ select * from projects where id=:project_id"""
    result = await db.fetch_one(query, {"project_id": project_id})
    return result


async def get_project_info_by_id(db: Database, project_id: uuid.UUID):
    """Get a single project &  all associated tasks by ID."""
    query = """
    SELECT
        projects.id,
        projects.slug,
        projects.name,
        projects.description,
        projects.per_task_instructions,
        projects.outline,
        projects.requires_approval_from_manager_for_locking,
        projects.no_fly_zones
    FROM projects
    WHERE projects.id = :project_id
    LIMIT 1;
    """

    project_record = await db.fetch_one(query, {"project_id": project_id})
    if not project_record:
        return None
    query = """
        WITH TaskStateCalculation AS (
            SELECT DISTINCT ON (te.task_id)
                te.task_id,
                te.user_id,
                CASE
                    WHEN te.state = 'REQUEST_FOR_MAPPING' THEN 'request logs'
                    WHEN te.state = 'LOCKED_FOR_MAPPING' THEN 'ongoing'
                    WHEN te.state = 'UNLOCKED_DONE' THEN 'completed'
                    WHEN te.state = 'UNFLYABLE_TASK' THEN 'unflyable task'
                    ELSE 'UNLOCKED_TO_MAP'
                END AS calculated_state
            FROM
                task_events te
            ORDER BY
                te.task_id, te.created_at DESC
        )
        SELECT
            t.id,
            t.project_task_index,
            t.outline,
            tsc.user_id,
            u.name,
            ST_Area(ST_Transform(t.outline, 3857)) / 1000000 AS task_area,
            COALESCE(tsc.calculated_state, 'UNLOCKED_TO_MAP') AS state
        FROM
            tasks t
        LEFT JOIN
            TaskStateCalculation tsc ON t.id = tsc.task_id
        LEFT JOIN
            users u ON tsc.user_id = u.id
        WHERE
            t.project_id = :project_id;
    """

    task_records = await db.fetch_all(query, {"project_id": project_id})
    project_record.tasks = task_records if task_records is not None else []
    project_record.task_count = len(task_records)
    return project_record


async def get_projects(
    db: Database,
    skip: int = 0,
    limit: int = 100,
):
    """Get all projects."""
    raw_sql = """
        SELECT id, slug, name, description, per_task_instructions, outline, requires_approval_from_manager_for_locking
        FROM projects
        ORDER BY created_at DESC
        OFFSET :skip
        LIMIT :limit;
        """
    db_projects = await db.fetch_all(raw_sql, {"skip": skip, "limit": limit})

    return db_projects


async def create_tasks_from_geojson(
    db: Database,
    project_id: uuid.UUID,
    boundaries: str,
):
    """Create tasks for a project, from provided task boundaries."""
    try:
        if isinstance(boundaries, str):
            boundaries = json.loads(boundaries)

        # Update the boundary polyon on the database.
        if boundaries["type"] == "Feature":
            polygons = [boundaries]
        else:
            polygons = boundaries["features"]
        log.debug(f"Processing {len(polygons)} task geometries")
        for index, polygon in enumerate(polygons):
            try:
                # If the polygon is a MultiPolygon, convert it to a Polygon
                if polygon["geometry"]["type"] == "MultiPolygon":
                    log.debug("Converting MultiPolygon to Polygon")
                    polygon["geometry"]["type"] = "Polygon"
                    polygon["geometry"]["coordinates"] = polygon["geometry"][
                        "coordinates"
                    ][0]

                task_id = str(uuid.uuid4())
                query = """
                    INSERT INTO tasks (id, project_id, outline, project_task_index)
                    VALUES (:id, :project_id, :outline, :project_task_index);"""

                result = await db.execute(
                    query,
                    values={
                        "id": task_id,
                        "project_id": project_id,
                        "outline": wkblib.dumps(shape(polygon["geometry"]), hex=True),
                        "project_task_index": index + 1,
                    },
                )

                if result:
                    log.debug(
                        "Created database task | "
                        f"Project ID {project_id} | "
                        f"Task index {index}"
                    )
                    log.debug(
                        "COMPLETE: creating project boundary, based on task boundaries"
                    )
                    return True
            except Exception as e:
                log.exception(e)
                raise HTTPException(e) from e
    except Exception as e:
        log.exception(e)
        raise HTTPException(e) from e


async def preview_split_by_square(boundary: str, meters: int):
    """Preview split by square for a project boundary.

    Use a lambda function to remove the "z" dimension from each
    coordinate in the feature's geometry.
    """
    boundary = merge_multipolygon(boundary)

    return await run_in_threadpool(
        lambda: split_by_square(
            boundary,
            meters=meters,
        )
    )


def process_imagery_in_nodeodm(
    images_folder: str, project_name: str, odm_task_id: uuid.UUID
):
    token = ""
    task_name = project_name
    images_dir = images_folder
    node_odm_docker_url = settings.NODE_ODM_URL
    task_processor = TaskProcessor(
        token, task_name, images_dir, node_odm_docker_url, odm_task_id
    )
    task_processor.process()


def download_object(bucket_name: str, obj, images_folder: str):
    if obj.object_name.endswith((".jpg", ".jpeg", ".JPG", ".png", ".PNG")):
        log.info(f"Downloading image from s3 {obj.object_name}")
        local_path = f"{images_folder}/{os.path.basename(obj.object_name)}"
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        get_file_from_bucket(bucket_name, obj.object_name, local_path)


def process_images_concurrently(
    project_id: uuid.UUID, task_id: uuid.UUID, odm_task_id: uuid.UUID
):
    objects = list_objects_from_bucket(
        settings.S3_BUCKET_NAME, f"publicuploads/{project_id}"
    )

    # Construct the images folder path
    images_folder = (
        f"/tmp/{project_id}/{task_id}"  # NOTE: local path is set to /tmp/ folder.
    )
    project_name = "Testing Project"  # FIXME: Use real Project name here

    # Process images concurrently
    with ThreadPoolExecutor() as executor:
        executor.map(
            lambda obj: download_object(settings.S3_BUCKET_NAME, obj, images_folder),
            objects,
        )

    # Call process_imagery_in_nodeodm after images are downloaded
    process_imagery_in_nodeodm(images_folder, project_name, odm_task_id)
