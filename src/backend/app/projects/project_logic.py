import os
import json
import uuid
from loguru import logger as log
from fastapi import HTTPException, UploadFile
from fmtm_splitter.splitter import split_by_square
from fastapi.concurrency import run_in_threadpool
from psycopg import Connection
from app.utils import merge_multipolygon
from app.projects.image_processing import TaskProcessor
import shapely.wkb as wkblib
from shapely.geometry import shape
from io import BytesIO
from app.s3 import add_obj_to_bucket, list_objects_from_bucket, get_file_from_bucket
from concurrent.futures import ThreadPoolExecutor

from app.config import settings


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


async def update_project_dem_url(db: Connection, project_id: uuid.UUID, dem_url: str):
    """Update the DEM URL for a project."""

    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET dem_url = %(dem_url)s
            WHERE id = %(project_id)s""",
            {"dem_url": dem_url, "project_id": project_id},
        )

    return True


async def create_tasks_from_geojson(
    db: Connection,
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
                async with db.cursor() as cur:
                    await cur.execute(
                        """
                    INSERT INTO tasks (id, project_id, outline, project_task_index)
                    VALUES (%(id)s, %(project_id)s, %(outline)s, %(project_task_index)s)
                    RETURNING id;
                    """,
                        {
                            "id": task_id,
                            "project_id": project_id,
                            "outline": wkblib.dumps(
                                shape(polygon["geometry"]), hex=True
                            ),
                            "project_task_index": index + 1,
                        },
                    )
                    result = await cur.fetchone()
                    if result:
                        log.debug(
                            "Created database task | "
                            f"Project ID {project_id} | "
                            f"Task index {index}"
                        )
                        log.debug(
                            "COMPLETE: creating project boundary, based on task boundaries"
                        )
            except Exception as e:
                log.exception(e)
                raise HTTPException(e) from e

        return True

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
