import os
from typing import Any, Dict, List, Optional
import uuid
import tempfile
import shutil
import asyncio
import aiohttp
from pathlib import Path
from app.tasks import task_logic
from app.models.enums import State, ImageProcessingStatus
from app.utils import timestamp
from app.db import database
from app.projects import project_logic
from pyodm import Node
from app.s3 import (
    get_file_from_bucket,
    list_objects_from_bucket,
    add_file_to_bucket,
    get_presigned_url,
)
from loguru import logger as log
from psycopg import Connection
from asgiref.sync import async_to_sync
from app.config import settings
import zipfile
from osgeo import gdal


class DroneImageProcessor:
    def __init__(
        self,
        node_odm_url: str,
        project_id: uuid.UUID,
        user_id: str,
        db: Connection,
        task_id: Optional[uuid.UUID] = None,
        task_ids: Optional[List[uuid.UUID]] = None,
    ):
        """
        Base initialization for drone image processing.

        :param node_odm_url: URL of the ODM node
        :param project_id: Project UUID
        :param user_id: User ID
        :param db: Database connection
        :param task_id: Optional single task ID
        :param task_ids: Optional list of task IDs
        """
        self.node = Node.from_url(node_odm_url)
        self.project_id = project_id
        self.user_id = user_id
        self.db = db
        self.task_id = task_id
        self.task_ids = task_ids or ([] if task_id is None else [task_id])
        self.max_concurrent_downloads = 4

    def options_list_to_dict(
        self, options: List[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Convert options list to a dictionary.

        :param options: List of option dictionaries
        :return: Dictionary of options
        """
        opts = {}
        if options is not None:
            for o in options:
                opts[o["name"]] = o["value"]
        return opts

    def list_images(self, directory: str) -> List[str]:
        """
        List all image files in a directory.

        :param directory: Directory path
        :return: List of image file paths
        """
        images = []
        path = Path(directory)

        for file in path.rglob("*"):
            if file.suffix.lower() in {".jpg", ".jpeg", ".png", ".txt", ".laz"}:
                images.append(str(file))
        return images

    async def download_image(self, session, url, save_path):
        try:
            async with session.get(url) as response:
                if response.status == 200:
                    with open(save_path, "wb") as f:
                        f.write(await response.read())
                else:
                    log.error(f"Failed to download {url}, status: {response.status}")
        except Exception as e:
            log.error(f"Error downloading {url}: {e}")

    async def download_images_from_s3(
        self,
        bucket_name: str,
        local_dir: str,
        task_id: Optional[uuid.UUID] = None,
        batch_size: int = 20,
    ):
        """
        Asynchronously download images from S3 in batches.

        :param bucket_name: Bucket name
        :param local_dir: Local directory to save images
        :param task_id: Optional specific task ID
        :param batch_size: Number of images to download concurrently
        """
        prefix = (
            f"dtm-data/projects/{self.project_id}/{task_id}"
            if task_id
            else f"dtm-data/projects/{self.project_id}"
        )
        objects = list_objects_from_bucket(bucket_name, prefix)

        if not objects:
            log.warning(f"No images found in S3 for task {task_id}")
            return

        log.info(f"Downloading images from S3 for task {task_id}...")

        s3_download_url = settings.S3_DOWNLOAD_ROOT
        if s3_download_url:
            object_urls = [f"{s3_download_url}/{obj.object_name}" for obj in objects]
        else:
            # generate pre-signed URL for each object
            object_urls = [
                get_presigned_url(bucket_name, obj.object_name, 12) for obj in objects
            ]

        async with aiohttp.ClientSession() as session:
            for i in range(0, len(object_urls), batch_size):
                batch = object_urls[i : i + batch_size]

                tasks = [
                    self.download_image(
                        session, url, os.path.join(local_dir, f"file_{i + 1}.jpg")
                    )
                    for i, url in enumerate(batch)
                ]
                await asyncio.gather(*tasks)

    def process_new_task(
        self,
        images: List[str],
        name: Optional[str] = None,
        options: Optional[List[Dict[str, Any]]] = None,
        progress_callback: Optional[Any] = None,
        webhook: Optional[str] = None,
    ):
        """
        Create a new processing task.

        :param images: List of image file paths
        :param name: Task name
        :param options: Processing options
        :param progress_callback: Progress tracking callback
        :param webhook: Webhook URL
        :return: Created task object
        """
        opts = self.options_list_to_dict(options)
        task = self.node.create_task(
            images, opts, name, progress_callback, webhook=webhook
        )
        return task

    async def _process_images(
        self,
        bucket_name: str,
        name: Optional[str] = None,
        options: Optional[List[Dict[str, Any]]] = None,
        webhook: Optional[str] = None,
        single_task: bool = True,
    ):
        """
        Internal method to process images for a single task or multiple tasks.

        :param bucket_name: Bucket name
        :param name: Task name
        :param options: Processing options
        :param webhook: Webhook URL
        :param single_task: Whether processing a single or multiple tasks
        :return: Created task object
        """
        # Create a temporary directory to store downloaded images
        temp_dir = tempfile.mkdtemp()
        try:
            images_list = []
            # Download images based on single or multiple task processing
            if single_task:  # and self.task_id:
                await self.download_images_from_s3(bucket_name, temp_dir, self.task_id)
                images_list = self.list_images(temp_dir)
            else:
                gcp_list_file = f"dtm-data/projects/{self.project_id}/gcp/gcp_list.txt"
                gcp_file_path = os.path.join(temp_dir, "gcp_list.txt")

                # Check and add the GCP file to the images list if it exists
                if get_file_from_bucket(bucket_name, gcp_list_file, gcp_file_path):
                    images_list.append(gcp_file_path)
                else:
                    log.info(
                        f"GCP file not available for project ID {self.project_id}."
                    )

                for task_id in self.task_ids:
                    await self.download_images_from_s3(bucket_name, temp_dir, task_id)
                    images_list.extend(self.list_images(temp_dir))

            # Start a new processing task
            task = self.process_new_task(
                list(set(images_list)),
                name=name
                or (
                    f"DTM-Task-{self.task_id}"
                    if single_task
                    else f"DTM-Project-{self.project_id}"
                ),
                options=options,
                webhook=webhook,
            )

            return task
        finally:
            # Clean up temporary directory
            shutil.rmtree(temp_dir)

    async def process_single_task(
        self,
        bucket_name: str,
        name: Optional[str] = None,
        options: Optional[List[Dict[str, Any]]] = None,
        webhook: Optional[str] = None,
    ):
        """
        Process images for a single task.

        :param bucket_name: Bucket name
        :param name: Task name
        :param options: Processing options
        :param webhook: Webhook URL
        :return: Created task object
        """
        return await self._process_images(
            bucket_name, name=name, options=options, webhook=webhook, single_task=True
        )

    async def process_multiple_tasks(
        self,
        bucket_name: str,
        name: Optional[str] = None,
        options: Optional[List[Dict[str, Any]]] = None,
        webhook: Optional[str] = None,
    ):
        """
        Process images for multiple tasks.

        :param bucket_name: Bucket name
        :param name: Task name
        :param options: Processing options
        :param webhook: Webhook URL
        :return: Created task object
        """
        return await self._process_images(
            bucket_name, name=name, options=options, webhook=webhook, single_task=False
        )

    def monitor_task(self, task):
        """
        Monitors the task progress until completion.

        :param task: The task object.
        """
        log.info(f"Monitoring task {task.uuid}...")
        task.wait_for_completion(interval=5)
        log.info("Task completed.")
        return task

    async def process_images_from_s3(
        self,
        bucket_name: str,
        name: Optional[str] = None,
        options: Optional[List[Dict[str, Any]]] = None,
        webhook: Optional[str] = None,
    ):
        """
        Process images from S3 for a single task.
        """
        task = await self.process_single_task(
            bucket_name, name=name, options=options, webhook=webhook
        )

        if not webhook:
            #   If webhook is passed, webhook does this job.
            if not webhook:
                # Monitor task progress
                self.monitor_task(task)

                # Optionally, download results
                output_file_path = f"/tmp/{self.project_id}"
                path_to_download = self.download_results(
                    task, output_path=output_file_path
                )

                # Upload the results into s3
                s3_path = (
                    f"dtm-data/projects/{self.project_id}/{self.task_id}/assets.zip"
                )
                add_file_to_bucket(bucket_name, path_to_download, s3_path)
                # now update the task as completed in Db.
                # Call the async function using asyncio

                # Update background task status to COMPLETED
                update_task_status_sync = async_to_sync(task_logic.update_task_state)
                update_task_status_sync(
                    self.db,
                    self.project_id,
                    self.task_id,
                    self.user_id,
                    "Task completed.",
                    State.IMAGE_UPLOADED,
                    State.IMAGE_PROCESSING_FINISHED,
                    timestamp(),
                )
            return task

        return task

    async def process_images_for_all_tasks(
        self,
        bucket_name: str,
        name_prefix: Optional[str] = None,
        options: Optional[List[Dict[str, Any]]] = None,
        webhook: Optional[str] = None,
    ):
        """
        Process images for all tasks in a project.
        """
        task = await self.process_multiple_tasks(
            bucket_name, name=name_prefix, options=options, webhook=webhook
        )

        return task


def reproject_to_web_mercator(input_file, output_file):
    """
    Reprojects a COG file to Web Mercator (EPSG:3857) using GDAL.

    Args:
        input_file (str): Path to the input COG file.
        output_file (str): Path to the output reprojected COG file.
    """
    try:
        # Define the target projection (Web Mercator)
        target_srs = "EPSG:3857"

        # Use gdal.Warp to perform the reprojection
        gdal.Warp(
            output_file,
            input_file,
            dstSRS=target_srs,
            format="COG",  # Output format as Cloud Optimized GeoTIFF
            resampleAlg="near",  # Resampling method, 'near' for nearest neighbor
        )
        log.info(f"File reprojected to Web Mercator and saved as {output_file}")

    except Exception as e:
        log.error(f"An error occurred during reprojection: {e}")
        raise


async def process_assets_from_odm(
    node_odm_url: str,
    dtm_project_id: uuid.UUID,
    odm_task_id: str,
    state=None,
    message=None,
    dtm_task_id=None,
    dtm_user_id=None,
    odm_status_code: Optional[int] = None,
):
    """
    Downloads results from ODM, reprojects the orthophoto, and uploads assets to S3.
    Updates task state if required.

    :param node_odm_url: URL of the ODM node.
    :param dtm_project_id: UUID of the project.
    :param odm_task_id: UUID of the ODM task.
    :param state: Current state of the task.
    :param message: Message to log upon completion.
    :param dtm_task_id: Task ID for state updates.
    :param dtm_user_id: User ID for state updates.
    """
    log.info(f"Starting processing for project {dtm_project_id}")
    node = Node.from_url(node_odm_url)
    output_file_path = f"/tmp/{uuid.uuid4()}"

    try:
        os.makedirs(output_file_path, exist_ok=True)
        task = node.get_task(odm_task_id)
        log.info(f"Downloading results for task {odm_task_id} to {output_file_path}")

        if str(odm_status_code) == "30":
            status = ImageProcessingStatus.FAILED
        elif str(odm_status_code) == "40":
            assets_path = task.download_zip(output_file_path)
            if not os.path.exists(assets_path):
                log.error(f"Downloaded file not found: {assets_path}")
                raise
            log.info(f"Successfully downloaded ZIP to {assets_path}")

            # Construct the S3 path dynamically to avoid empty segments
            task_segment = f"{dtm_task_id}/" if dtm_task_id else ""
            s3_path = f"dtm-data/projects/{dtm_project_id}/{task_segment}assets.zip"
            log.info(f"Uploading {assets_path} to S3 path: {s3_path}")
            add_file_to_bucket(settings.S3_BUCKET_NAME, assets_path, s3_path)

            with zipfile.ZipFile(assets_path, "r") as zip_ref:
                zip_ref.extractall(output_file_path)

            orthophoto_path = os.path.join(
                output_file_path, "odm_orthophoto", "odm_orthophoto.tif"
            )
            if not os.path.exists(orthophoto_path):
                log.error(f"Orthophoto not found at {orthophoto_path}")
                raise FileNotFoundError("Orthophoto file is missing")

            reproject_to_web_mercator(orthophoto_path, orthophoto_path)
            s3_ortho_path = f"dtm-data/projects/{dtm_project_id}/{task_segment}orthophoto/odm_orthophoto.tif"
            log.info(f"Uploading reprojected orthophoto to S3 path: {s3_ortho_path}")
            add_file_to_bucket(settings.S3_BUCKET_NAME, orthophoto_path, s3_ortho_path)

            images_json_path = os.path.join(output_file_path, "images.json")
            if os.path.exists(images_json_path):
                s3_images_json_path = (
                    f"dtm-data/projects/{dtm_project_id}/{task_segment}images.json"
                )
                log.info(f"Uploading images.json to S3 path: {s3_images_json_path}")
                add_file_to_bucket(
                    settings.S3_BUCKET_NAME, images_json_path, s3_images_json_path
                )
            else:
                log.warning(f"images.json not found in {output_file_path}")

            log.info(f"Processing complete for project {dtm_project_id}")

            if state and dtm_task_id and dtm_user_id:
                # NOTE: This function uses a separate database connection pool because it is called by an internal server
                # and doesn't rely on FastAPI's request context. This allows independent database access outside FastAPI's lifecycle.
                pool = await database.get_db_connection_pool()
                async with pool as pool_instance:
                    async with pool_instance.connection() as conn:
                        await task_logic.update_task_state(
                            db=conn,
                            project_id=dtm_project_id,
                            task_id=dtm_task_id,
                            user_id=dtm_user_id,
                            comment=message,
                            initial_state=state,
                            final_state=State.IMAGE_PROCESSING_FINISHED,
                            updated_at=timestamp(),
                        )
                        log.info(
                            f"Task {dtm_task_id} state updated to IMAGE_PROCESSING_FINISHED in the database."
                        )

                        s3_path_url = f"dtm-data/projects/{dtm_project_id}/{dtm_task_id}/assets.zip"
                        # update the task table
                        await project_logic.update_task_field(
                            conn, dtm_project_id, dtm_task_id, "assets_url", s3_path_url
                        )

            status = ImageProcessingStatus.SUCCESS
        if not dtm_task_id:
            # Update the image processing status
            pool = await database.get_db_connection_pool()
            async with pool as pool_instance:
                async with pool_instance.connection() as conn:
                    await project_logic.update_processing_status(
                        conn, dtm_project_id, status
                    )

    except Exception as e:
        log.error(f"Error during processing for project {dtm_project_id}: {e}")

    finally:
        if os.path.exists(output_file_path):
            try:
                shutil.rmtree(output_file_path)
                log.info(f"Temporary directory {output_file_path} cleaned up.")
            except Exception as cleanup_error:
                log.error(
                    f"Error cleaning up directory {output_file_path}: {cleanup_error}"
                )
