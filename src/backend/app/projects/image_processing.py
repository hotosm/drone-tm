import os
import time
import requests
from loguru import logger as log


class TaskProcessor:
    def __init__(self, token, task_name, images_dir, base_url, task_id=None):
        self.base_url = base_url
        self.token = token
        self.task_name = task_name
        self.images_dir = images_dir
        self.task_uuid = task_id
        self.status = None

    def init_task(self):
        url = f"{self.base_url}/task/new/init"
        payload = {
            "name": self.task_name,
            "webhook": "",
            "skipPostProcessing": True,
            "options": [],
        }

        headers = {}
        if self.task_uuid:
            headers["set-uuid"] = str(self.task_uuid)

        response = requests.post(
            url, headers=headers, params={"token": self.token}, json=payload
        )
        response.raise_for_status()
        self.task_uuid = response.json()["uuid"]
        log.info(f"Task initialized with UUID: {self.task_uuid}")

    def upload_images(self):
        for image_file in os.listdir(self.images_dir):
            image_path = os.path.join(self.images_dir, image_file)
            if os.path.isfile(image_path):
                self.upload_image(image_path)
                log.info(f"Uploaded {image_file} successfully.")

    def upload_image(self, image_path):
        url = f"{self.base_url}/task/new/upload/{self.task_uuid}"
        with open(image_path, "rb") as image_file:
            files = {"images": image_file}
            response = requests.post(url, params={"token": self.token}, files=files)
            response.raise_for_status()
        return response.json()["success"]

    def commit_task(self):
        url = f"{self.base_url}/task/new/commit/{self.task_uuid}"
        response = requests.post(url, params={"token": self.token}, json={})
        response.raise_for_status()
        log.info(f"Task committed with UUID: {self.task_uuid}")

    def track_progress(self):
        url = f"{self.base_url}/task/{self.task_uuid}/info"
        while True:
            response = requests.get(url, params={"token": self.token})
            if response.status_code == 200:
                task_info = response.json()
                if task_info["progress"] == 100:
                    # Check task status
                    if (
                        str(task_info["status"]["code"]) == "30"
                    ):  # Node ODM Status Code for failed task
                        self.status = "Failed"
                        log.error(
                            f"Task Failed : {task_info['status']['errorMessage']}"
                        )
                    elif (
                        str(task_info["status"]["code"]) == "40"
                    ):  # Node ODM Status Code for successful task
                        self.status = "Completed"
                        log.info("Task processing complete.")
                    break
                else:
                    log.info(f"Task progress: {task_info['progress']}%")
                    self.status = "In Process"
            else:
                log.info(
                    f"Unexpected response status: {response.status_code}. Retrying in 5 seconds..."
                )
            time.sleep(5)  # Poll every 5 seconds

    def download_assets(self):
        url = f"{self.base_url}/task/{self.task_uuid}/download/all.zip"
        response = requests.get(url, params={"token": self.token}, stream=True)
        response.raise_for_status()
        with open("all_assets.zip", "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        log.info("Assets downloaded as all_assets.zip")

    def process(self):
        self.init_task()
        self.upload_images()
        self.commit_task()
        self.track_progress()
        self.download_assets()


# Example usage
# import uuid
# token = ""
# task_name = "Your Task Name"
# images_dir = "/home/niraj/Images.zip"
# base_url="http://localhost:3001"
# task_id = uuid.uuid4()
# task_processor = TaskProcessor(token, task_name, images_dir, base_url, task_id)
# task_processor.process()
