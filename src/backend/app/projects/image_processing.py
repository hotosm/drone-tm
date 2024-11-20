import os
import uuid
import tempfile
import shutil
from pathlib import Path
from app.tasks import task_logic
from app.models.enums import State
from app.utils import timestamp
from app.db import database
from pyodm import Node
from app.s3 import get_file_from_bucket, list_objects_from_bucket, add_file_to_bucket
from loguru import logger as log
from concurrent.futures import ThreadPoolExecutor
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
        task_id: uuid.UUID,
        user_id: str,
        db: Connection,
    ):
        """
        Initializes the connection to the ODM node.
        """
        # self.node = Node(node_odm_host, node_odm_port)
        self.node = Node.from_url(node_odm_url)
        self.project_id = project_id
        self.task_id = task_id
        self.user_id = user_id
        self.db = db

    def options_list_to_dict(self, options=[]):
        """
        Converts options formatted as a list ([{'name': optionName, 'value': optionValue}, ...])
        to a dictionary {optionName: optionValue, ...}
        """
        opts = {}
        if options is not None:
            for o in options:
                opts[o["name"]] = o["value"]
        return opts

    def download_object(self, bucket_name: str, obj, images_folder: str):
        if obj.object_name.endswith(
            (".jpg", ".jpeg", ".JPG", ".png", ".PNG", ".txt", ".laz")
        ):  # Images and GCP File
            local_path = Path(images_folder) / Path(obj.object_name).name
            local_path.parent.mkdir(parents=True, exist_ok=True)
            get_file_from_bucket(bucket_name, obj.object_name, local_path)

    def download_images_from_s3(self, bucket_name, local_dir):
        """
        Downloads images from MinIO under the specified path.

        :param bucket_name: Name of the MinIO bucket.
        :param project_id: The project UUID.
        :param task_id: The task UUID.
        :param local_dir: Local directory to save the images.
        :return: List of local image file paths.
        """
        prefix = f"dtm-data/projects/{self.project_id}/{self.task_id}"

        objects = list_objects_from_bucket(bucket_name, prefix)

        # Process images concurrently
        with ThreadPoolExecutor() as executor:
            executor.map(
                lambda obj: self.download_object(bucket_name, obj, local_dir),
                objects,
            )

    def list_images(self, directory):
        """
        Lists all images in the specified directory.

        :param directory: The directory containing the images.
        :return: List of image file paths.
        """
        images = []
        path = Path(directory)

        for file in path.rglob("*"):
            if file.suffix.lower() in {
                ".jpg",
                ".jpeg",
                ".png",
                ".txt",
                ".laz",
            }:  # Images, GCP File, and align.laz
                images.append(str(file))
        return images

    def process_new_task(
        self, images, name=None, options=[], progress_callback=None, webhook=None
    ):
        """
        Sends a set of images via the API to start processing.

        :param images: List of image file paths.
        :param name: Name of the task.
        :param options: Processing options ([{'name': optionName, 'value': optionValue}, ...]).
        :param progress_callback: Callback function to report upload progress.
        :return: The created task object.
        """
        opts = self.options_list_to_dict(options)
        task = self.node.create_task(
            images, opts, name, progress_callback, webhook=webhook
        )
        return task

    def monitor_task(self, task):
        """
        Monitors the task progress until completion.

        :param task: The task object.
        """
        log.info(f"Monitoring task {task.uuid}...")
        task.wait_for_completion(interval=5)
        log.info("Task completed.")
        return task

    def download_results(self, task, output_path):
        """
        Downloads all results of the task to the specified output path.

        :param task: The task object.
        :param output_path: The directory where results will be saved.
        """
        log.info(f"Downloading results to {output_path}...")
        path = task.download_zip(output_path)
        log.info("Download completed.")
        return path

    def process_images_from_s3(self, bucket_name, name=None, options=[], webhook=None):
        """
        Processes images from MinIO storage.

        :param bucket_name: Name of the MinIO bucket.
        :param project_id: The project UUID.
        :param task_id: The task UUID.
        :param name: Name of the task.
        :param options: Processing options ([{'name': optionName, 'value': optionValue}, ...]).
        :return: The task object.
        """
        # Create a temporary directory to store downloaded images
        temp_dir = tempfile.mkdtemp()
        try:
            self.download_images_from_s3(bucket_name, temp_dir)

            images_list = self.list_images(temp_dir)

            # Start a new processing task
            task = self.process_new_task(
                images_list, name=name, options=options, webhook=webhook
            )

            # If webhook is passed, webhook does this job.
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
                    State.IMAGE_PROCESSED,
                    timestamp(),
                )
            return task

        finally:
            # Clean up temporary directory
            shutil.rmtree(temp_dir)
            pass


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


async def download_and_upload_assets_from_odm_to_s3(
    node_odm_url: str,
    task_id: str,
    dtm_project_id: uuid.UUID,
    dtm_task_id: uuid.UUID,
    user_id: str,
    current_state: State,
    comment: str,
):
    """
    Downloads results from ODM, reprojects the orthophoto to EPSG:3857, and uploads it to S3.

    :param task_id: UUID of the ODM task.
    :param dtm_project_id: UUID of the project.
    :param dtm_task_id: UUID of the task.
    :param current_state: Current state of the task (IMAGE_UPLOADED or IMAGE_PROCESSING_FAILED).
    """
    log.info(f"Starting download for task {task_id}")

    # Replace with actual ODM node details and URL
    node = Node.from_url(node_odm_url)

    try:
        # Get the task object using the task_id
        task = node.get_task(task_id)

        # Create a temporary directory to store the results
        output_file_path = f"/tmp/{dtm_project_id}"

        log.info(f"Downloading results for task {task_id} to {output_file_path}")

        # Download results as a zip file
        assets_path = task.download_zip(output_file_path)

        # Upload the results into S3 (Minio)
        s3_path = f"dtm-data/projects/{dtm_project_id}/{dtm_task_id}/assets.zip"
        log.info(f"Uploading {output_file_path} to S3 path: {s3_path}")
        add_file_to_bucket(settings.S3_BUCKET_NAME, assets_path, s3_path)

        log.info(f"Assets for task {task_id} successfully uploaded to S3.")

        # Extract the zip file to find the orthophoto
        with zipfile.ZipFile(assets_path, "r") as zip_ref:
            zip_ref.extractall(output_file_path)

        orthophoto_path = os.path.join(
            output_file_path, "odm_orthophoto", "odm_orthophoto.tif"
        )
        if not os.path.exists(orthophoto_path):
            log.error(f"Orthophoto file not found at {orthophoto_path}")
            raise FileNotFoundError(f"Orthophoto not found in {output_file_path}")

        log.info(f"Orthophoto found at {orthophoto_path}")

        # NOTE: Reproject the orthophoto to EPSG:3857, overwriting the original file
        reproject_to_web_mercator(orthophoto_path, orthophoto_path)

        # Upload the reprojected orthophoto to S3
        s3_ortho_path = f"dtm-data/projects/{dtm_project_id}/{dtm_task_id}/orthophoto/odm_orthophoto.tif"
        log.info(f"Uploading reprojected orthophoto to S3 path: {s3_ortho_path}")
        add_file_to_bucket(settings.S3_BUCKET_NAME, orthophoto_path, s3_ortho_path)

        log.info(
            f"Reprojected orthophoto for task {task_id} successfully uploaded to S3 at {s3_ortho_path}"
        )
        # NOTE: This function uses a separate database connection pool because it is called by an internal server
        # and doesn't rely on FastAPI's request context. This allows independent database access outside FastAPI's lifecycle.

        pool = await database.get_db_connection_pool()
        async with pool as pool_instance:
            async with pool_instance.connection() as conn:
                await task_logic.update_task_state(
                    db=conn,
                    project_id=dtm_project_id,
                    task_id=dtm_task_id,
                    user_id=user_id,
                    comment=comment,
                    initial_state=current_state,
                    final_state=State.IMAGE_PROCESSED,
                    updated_at=timestamp(),
                )
                log.info(
                    f"Task {dtm_task_id} state updated to IMAGE_PROCESSED in the database."
                )

    except Exception as e:
        log.error(
            f"An error occurred during processing for task {task_id}. Details: {e}"
        )

    finally:
        if os.path.exists(output_file_path):
            try:
                shutil.rmtree(output_file_path)
                log.info(f"Temporary directory {output_file_path} cleaned up.")
            except Exception as cleanup_error:
                log.error(
                    f"Error cleaning up temporary directory {output_file_path}: {cleanup_error}"
                )