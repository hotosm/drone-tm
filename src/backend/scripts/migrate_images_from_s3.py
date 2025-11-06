import hashlib
import json
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

from loguru import logger as log
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings
from app.db.db_models import DbProject, DbProjectImage, DbTask
from app.models.enums import ImageStatus


S3_PUBLIC_ENDPOINT = os.getenv("S3_PUBLIC_ENDPOINT", "https://drone-tm-public.s3.amazonaws.com")


def fetch_images_json(project_id: str, task_id: str) -> list | None:
    url = f"{S3_PUBLIC_ENDPOINT}/dtm-data/projects/{project_id}/{task_id}/images.json"

    try:
        with urlopen(url, timeout=30) as response:
            data = response.read()
            return json.loads(data)
    except HTTPError as e:
        if e.code == 404:
            log.warning(f"images.json not found for project {project_id}, task {task_id}")
        else:
            log.error(f"Failed to fetch {url}: {e.code}")
        return None
    except (URLError, json.JSONDecodeError) as e:
        log.error(f"Error fetching {url}: {e}")
        return None


def create_image_hash(filename: str, project_id: str, task_id: str) -> str:
    hash_string = f"{project_id}:{task_id}:{filename}"
    return hashlib.md5(hash_string.encode()).hexdigest()


def migrate_images_for_task(
    session: Session,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    uploaded_by: str | None = None
) -> int:
    images_data = fetch_images_json(str(project_id), str(task_id))

    if not images_data:
        return 0

    inserted_count = 0

    for image_data in images_data:
        filename = image_data.get("filename")
        if not filename:
            continue

        s3_key = f"dtm-data/projects/{project_id}/{task_id}/{filename}"
        hash_md5 = create_image_hash(filename, str(project_id), str(task_id))

        existing = session.query(DbProjectImage).filter(
            DbProjectImage.hash_md5 == hash_md5
        ).first()

        if existing:
            log.debug(f"Image {filename} already exists, skipping")
            continue

        exif_data = {
            "width": image_data.get("width"),
            "height": image_data.get("height"),
            "camera_make": image_data.get("camera_make"),
            "camera_model": image_data.get("camera_model"),
            "orientation": image_data.get("orientation"),
            "altitude": image_data.get("altitude"),
            "fnumber": image_data.get("fnumber"),
            "exposure_time": image_data.get("exposure_time"),
            "iso_speed": image_data.get("iso_speed"),
            "utc_time": image_data.get("utc_time"),
            "yaw": image_data.get("yaw"),
            "pitch": image_data.get("pitch"),
            "roll": image_data.get("roll"),
            "omega": image_data.get("omega"),
            "phi": image_data.get("phi"),
            "kappa": image_data.get("kappa"),
            "exif_width": image_data.get("exif_width"),
            "exif_height": image_data.get("exif_height"),
        }

        exif_data = {k: v for k, v in exif_data.items() if v is not None}

        latitude = image_data.get("latitude")
        longitude = image_data.get("longitude")

        new_image = DbProjectImage(
            id=uuid.uuid4(),
            project_id=project_id,
            task_id=task_id,
            filename=filename,
            s3_key=s3_key,
            hash_md5=hash_md5,
            exif=exif_data,
            uploaded_by=uploaded_by,
            uploaded_at=datetime.utcnow(),
            status=ImageStatus.UPLOADED,
        )

        if latitude is not None and longitude is not None:
            new_image.location = f"SRID=4326;POINT({longitude} {latitude})"

        session.add(new_image)
        inserted_count += 1

    return inserted_count


def migrate_all_projects():
    engine = create_engine(
        settings.DTM_DB_URL.unicode_string(),
        echo=False
    )

    with Session(engine) as session:
        projects = session.query(DbProject).all()

        log.info(f"Found {len(projects)} projects")

        total_images = 0

        for project in projects:
            log.info(f"Processing project: {project.name} ({project.id})")

            tasks = session.query(DbTask).filter(
                DbTask.project_id == project.id
            ).all()

            log.info(f"  Found {len(tasks)} tasks for project {project.id}")

            for task in tasks:
                count = migrate_images_for_task(
                    session,
                    project.id,
                    task.id,
                    uploaded_by=project.author_id
                )

                if count > 0:
                    log.info(f"  Inserted {count} images for task {task.id}")
                    total_images += count

            session.commit()

        log.info(f"Migration complete. Total images inserted: {total_images}")


if __name__ == "__main__":
    log.info("Starting image migration from S3")
    migrate_all_projects()
