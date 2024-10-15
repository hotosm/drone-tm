import json
import uuid
from loguru import logger as log
from fastapi import HTTPException, UploadFile
from app.tasks.task_splitter import split_by_square
from fastapi.concurrency import run_in_threadpool
from psycopg import Connection
from app.utils import merge_multipolygon
import shapely.wkb as wkblib
from shapely.geometry import shape
from io import BytesIO
from app.s3 import (
    add_obj_to_bucket,
    list_objects_from_bucket,
    get_presigned_url,
    get_object_metadata,
)
from app.config import settings
from app.projects.image_processing import DroneImageProcessor
from app.projects import project_schemas
from minio import S3Error


async def upload_file_to_s3(
    project_id: uuid.UUID, file: UploadFile, file_name: str
) -> str:
    """
    Upload a file (image or DEM) to S3.

    Args:
        project_id (uuid.UUID): The project ID in the database.
        file (UploadFile): The file to be uploaded.
        folder (str): The folder name in the S3 bucket.
        file_extension (str): The file extension (e.g., 'png', 'tif').

    Returns:
        str: The S3 URL for the uploaded file.
    """
    # Define the S3 file path
    file_path = f"/projects/{project_id}/{file_name}"

    # Read the file bytes
    file_bytes = await file.read()
    file_obj = BytesIO(file_bytes)

    # Upload the file to the S3 bucket
    add_obj_to_bucket(
        settings.S3_BUCKET_NAME,
        file_obj,
        file_path,
        file.content_type,
    )

    # Construct the S3 URL for the file
    file_url = f"{settings.S3_DOWNLOAD_ROOT}/{settings.S3_BUCKET_NAME}{file_path}"

    return file_url


async def update_url(db: Connection, project_id: uuid.UUID, url: str):
    """
    Update the URL (DEM or image) for a project in the database.

    Args:
        db (Connection): The database connection.
        project_id (uuid.UUID): The project ID in the database.
        url (str): The URL to be updated.
        url_type (str): The column name for the URL (e.g., 'dem_url', 'image_url').

    Returns:
        bool: True if the update was successful.
    """
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET dem_url = %(url)s
            WHERE id = %(project_id)s""",
            {"url": url, "project_id": project_id},
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
                if not polygon["geometry"]:
                    continue
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


def process_drone_images(
    project_id: uuid.UUID, task_id: uuid.UUID, user_id: str, db: Connection
):
    # Initialize the processor
    processor = DroneImageProcessor(
        settings.NODE_ODM_URL, project_id, task_id, user_id, db
    )

    # Define processing options
    options = [
        {"name": "dsm", "value": True},
        {"name": "orthophoto-resolution", "value": 5},
    ]

    webhook_url = (
        f"{settings.BACKEND_URL}/api/projects/odm/webhook/{project_id}/{task_id}"
    )

    processor.process_images_from_s3(
        settings.S3_BUCKET_NAME,
        name=f"DTM-Task-{task_id}",
        options=options,
        webhook=webhook_url,
    )


def get_project_info_from_s3(project_id: uuid.UUID, task_id: uuid.UUID):
    """
    Helper function to get the number of images and the URL to download the assets.
    """
    try:
        # Prefix for the images
        images_prefix = f"projects/{project_id}/{task_id}/images/"

        # List and count the images
        objects = list_objects_from_bucket(
            settings.S3_BUCKET_NAME, prefix=images_prefix
        )
        image_extensions = (".jpg", ".jpeg", ".png", ".tif", ".tiff")
        image_count = sum(
            1 for obj in objects if obj.object_name.lower().endswith(image_extensions)
        )

        # Generate a presigned URL for the assets ZIP file
        try:
            # Check if the object exists
            assets_path = f"projects/{project_id}/{task_id}/assets.zip"
            get_object_metadata(settings.S3_BUCKET_NAME, assets_path)

            # If it exists, generate the presigned URL
            presigned_url = get_presigned_url(
                settings.S3_BUCKET_NAME, assets_path, expires=2
            )
        except S3Error as e:
            if e.code == "NoSuchKey":
                # The object does not exist
                log.info(
                    f"Assets ZIP file not found for project {project_id}, task {task_id}."
                )
                presigned_url = None
            else:
                # An unexpected error occurred
                log.error(f"An error occurred while accessing assets file: {e}")
                raise HTTPException(status_code=500, detail=str(e))

        return project_schemas.AssetsInfo(
            project_id=str(project_id),
            task_id=str(task_id),
            image_count=image_count,
            assets_url=presigned_url,
        )
    except Exception as e:
        log.exception(f"An error occurred while retrieving assets info: {e}")
        raise HTTPException(status_code=500, detail=str(e))
