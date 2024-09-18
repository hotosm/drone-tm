import os
import uuid
from pyodm import Node
import tempfile
from app.s3 import get_file_from_bucket, list_objects_from_bucket
from loguru import logger as log
from concurrent.futures import ThreadPoolExecutor


class DroneImageProcessor:
    def __init__(
        self,
        node_odm_url: str,
        project_id: uuid.UUID,
        task_id: uuid.UUID,
    ):
        """
        Initializes the connection to the ODM node.
        """
        # self.node = Node(node_odm_host, node_odm_port)
        self.node = Node.from_url(node_odm_url)
        self.project_id = project_id
        self.task_id = task_id

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
        if obj.object_name.endswith((".jpg", ".jpeg", ".JPG", ".png", ".PNG")):
            # log.info(f"Downloading image from s3 {obj.object_name}")
            local_path = f"{images_folder}/{os.path.basename(obj.object_name)}"
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            get_file_from_bucket(bucket_name, obj.object_name, local_path)

    def download_images_from_minio(self, bucket_name, project_id, task_id, local_dir):
        """
        Downloads images from MinIO under the specified path.

        :param bucket_name: Name of the MinIO bucket.
        :param project_id: The project UUID.
        :param task_id: The task UUID.
        :param local_dir: Local directory to save the images.
        :return: List of local image file paths.
        """
        prefix = f"projects/{project_id}/"

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
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file.endswith((".jpg", ".jpeg", ".JPG", ".png", ".PNG")):
                    images.append(os.path.join(root, file))
        return images

    def process_new_task(self, images, name=None, options=[], progress_callback=None):
        """
        Sends a set of images via the API to start processing.

        :param images: List of image file paths.
        :param name: Name of the task.
        :param options: Processing options ([{'name': optionName, 'value': optionValue}, ...]).
        :param progress_callback: Callback function to report upload progress.
        :return: The created task object.
        """
        opts = self.options_list_to_dict(options)

        # FIXME: take this from the function above
        opts = {"dsm": True}

        task = self.node.create_task(images, opts, name, progress_callback)
        return task

    def monitor_task(self, task):
        """
        Monitors the task progress until completion.

        :param task: The task object.
        """
        log.info(f"Monitoring task {task.uuid}...")
        task.wait_for_completion()
        log.info("Task completed.")
        return task

    def download_results(self, task, output_path):
        """
        Downloads all results of the task to the specified output path.

        :param task: The task object.
        :param output_path: The directory where results will be saved.
        """
        log.info(f"Downloading results to {output_path}...")
        task.download_all(output_path)
        log.info("Download completed.")

    def process_task_from_minio(
        self, bucket_name, project_id, task_id, name=None, options=[]
    ):
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
            self.download_images_from_minio(bucket_name, project_id, task_id, temp_dir)

            images_list = self.list_images(temp_dir)
            # print("Images list = ", images_list)

            # Start a new processing task
            task = self.process_new_task(images_list, name=name, options=options)
            # Monitor task progress
            self.monitor_task(task)
            # Optionally, download results
            self.download_results(task, output_path="output/")
            return task
        finally:
            # Clean up temporary directory
            # shutil.rmtree(temp_dir)
            pass


# # Example usage:
# if __name__ == "__main__":
#     # Initialize the processor
#     processor = DroneImageProcessor(node_url='localhost', port=3000)

#     # MinIO bucket and path details
#     bucket_name = 'dtm-data'
#     project_id = '896321bc-ed8e-415f-8769-e419a14f7d76'
#     task_id = 'd44701d1-438e-40c3-838f-d60581ad9299'

#     # Define processing options
#     options = [
#         {'name': 'dsm', 'value': True},
#         {'name': 'orthophoto-resolution', 'value': 5},
#         # Add more options as needed
#     ]

#     # Process task from MinIO
#     task = processor.process_task_from_minio(bucket_name, project_id, task_id, name='My Drone Task', options=options)

#     if task:
#         # Download the results
#         output_path = 'output/'
#         processor.download_results(task, output_path=output_path)
