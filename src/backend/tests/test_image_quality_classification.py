import uuid
import json
import hashlib
import numpy as np
import shapely.wkb as wkblib

from shapely.geometry import box
from datetime import datetime, timezone, timedelta

import pytest

from app.models.enums import ImageStatus
from app.projects.image_classification import ImageClassifier, QualityThresholds


def test_classifier_exposure_detects_lens_cap():
    """Verifies _exposure_issues flags very dark images (Lens Cap)."""
    # Dark image
    dark_image = np.full((100, 100), 10, dtype=np.uint8)

    issues, metrics = ImageClassifier._exposure_issues(dark_image)
    assert any(
        "Image appears mostly black (lens cap or severe underexposure)" in issue
        for issue in issues
    )
    assert metrics["mean"] == 10.0


def test_classifier_exposure_detects_sun_glare():
    """Verifies _exposure_issues flags overexposed images (Sun/Whiteout)."""
    # Overexposed image
    bright_image = np.full((100, 100), 250, dtype=np.uint8)

    issues, metrics = ImageClassifier._exposure_issues(bright_image)

    assert any(
        "Image appears overexposed (mostly white / blown highlights)" in issue
        for issue in issues
    )
    assert metrics["mean"] == 250.0


def test_classifier_rough_distance():
    """Verifies the _rough_distance_km correctly identifies outside coordinates is 'Far Away' from current project."""
    # Project centroid
    project_lat, project_lon = -8.34, 115.50
    # Far away coordinates (from agung-1 FAR_AWAY.JPG)
    outside_lat, outside_lon = 48.8566, 2.3522

    km_approx = ImageClassifier._rough_distance_km(
        project_lat, project_lon, outside_lat, outside_lon
    )

    assert km_approx > 10000
    assert km_approx > QualityThresholds().far_from_project_km


@pytest.mark.asyncio
async def test_reject_gimbal_errors(db, create_test_project, auth_user):
    """Verifies images are rejected where gimbal is 0 (horizon) or +30 (up)."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    # Project box
    geom = box(115.4, -8.4, 115.6, -8.2)
    outline_wkb = wkblib.dumps(geom, hex=True)

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (
                id,
                project_id,
                project_task_index,
                outline
            )
            VALUES (
                %s,
                %s,
                %s,
                %s
            )
            """,
            (task_id, project_id, 1, outline_wkb),
        )

    # Gimbal errors from drone-testdata-agung-1/image_metadata.csv
    gimbal_errors = [
        {
            "name": "DJI_20251002134045_0858_D_GIMBAL_HORIZON.JPG",
            "pitch": "0.0",
            "lon": 115.461,
            "lat": -8.301,
        },
        {
            "name": "DJI_20251002134053_0862_D_GIMBAL_UP.JPG",
            "pitch": "30.0",
            "lon": 115.462,
            "lat": -8.302,
        },
    ]

    image_ids = []
    async with db.cursor() as cur:
        for i, e in enumerate(gimbal_errors):
            filename = e["name"]
            s3_key = f"dtm-data/projects/{project_id}/user-uploads/{filename}"
            hash_md5 = hashlib.md5(filename.encode("utf-8")).hexdigest()
            uploaded_at = now + timedelta(seconds=i)
            # Intentional gimbal errors
            exif_data = json.dumps({"GimbalPitchDegree": e["pitch"]})

            await cur.execute(
                """
                INSERT INTO project_images (
                    project_id,
                    filename,
                    s3_key,
                    hash_md5,
                    batch_id,
                    task_id,
                    location,
                    uploaded_by,
                    status,
                    uploaded_at,
                    exif
                )
                VALUES (
                    %(project_id)s,
                    %(filename)s,
                    %(s3_key)s,
                    %(hash_md5)s,
                    %(batch_id)s,
                    %(task_id)s,
                    ST_SetSRID(ST_MakePoint(115.5, -8.3), 4326),
                    %(uploaded_by)s,
                    'assigned',
                    %(uploaded_at)s,
                    %(exif)s
                )
                RETURNING id
                """,
                {
                    "project_id": str(project_id),
                    "filename": filename,
                    "s3_key": s3_key,
                    "hash_md5": hash_md5,
                    "batch_id": str(batch_id),
                    "task_id": str(task_id),
                    "uploaded_by": auth_user.id,
                    "uploaded_at": uploaded_at,
                    "exif": exif_data,
                },
            )
            image_ids.append((await cur.fetchone())[0])

    await db.commit()

    for image_id in image_ids:
        result = await ImageClassifier.classify_single_image(db, image_id, project_id)
        assert result["status"].value == "rejected"
        assert "Camera must point down" in result["reason"]


@pytest.mark.asyncio
async def test_reject_invalid_coordinates_range(db, create_test_project, auth_user):
    """Verifies images are rejected with invalid coordinates (e.g. Lat 250)."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()
    image_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    # Project box
    geom = box(115.4, -8.4, 115.6, -8.2)
    outline_wkb = wkblib.dumps(geom, hex=True)

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (
                id,
                project_id,
                project_task_index,
                outline
            )
            VALUES (
                %s,
                %s,
                %s,
                %s
            )
            """,
            (task_id, project_id, 1, outline_wkb),
        )

        # Invalid coordinates from drone-testdata-agung-1/image_metadata.csv
        file_name = "DJI_20251002134041_0856_D_INVALID_COORD.JPG"
        exif_data = json.dumps(
            {"GPSLatitude": "250 deg 0' 0\" N", "GPSLongitude": "325 deg 0' 0\" W"}
        )

        await cur.execute(
            """
                INSERT INTO project_images (
                    id,
                    project_id,
                    filename,
                    s3_key,
                    hash_md5,
                    batch_id,
                    task_id,
                    location,
                    uploaded_by,
                    status,
                    uploaded_at,
                    exif
                )
                VALUES (
                    %(id)s,
                    %(project_id)s,
                    %(filename)s,
                    %(s3_key)s,
                    %(hash_md5)s,
                    %(batch_id)s,
                    %(task_id)s,
                    NULL,
                    %(uploaded_by)s,
                    'assigned',
                    %(uploaded_at)s,
                    %(exif)s
                )
                """,
            {
                "id": image_id,
                "project_id": str(project_id),
                "filename": file_name,
                "s3_key": f"dtm-data/projects/{project_id}/user-uploads/{file_name}",
                "hash_md5": hashlib.md5(file_name.encode("utf-8")).hexdigest(),
                "batch_id": str(batch_id),
                "task_id": str(task_id),
                "uploaded_by": auth_user.id,
                "uploaded_at": now,
                "exif": exif_data,
            },
        )

    await db.commit()

    result = await ImageClassifier.classify_single_image(db, image_id, project_id)

    assert result["status"].value == ImageStatus.INVALID_EXIF
    assert "Invalid GPS coordinates (out of range)" in result["reason"]

    assert result.get("latitude") is None
    assert result.get("longitude") is None


@pytest.mark.asyncio
async def test_find_matching_tasks_within_project_range(db, create_test_project):
    """Verifies images fall within task boundaries."""
    project_id = uuid.UUID(create_test_project)
    task_id = uuid.uuid4()

    # Project box
    geom = box(115.4, -8.4, 115.6, -8.2)
    async with db.cursor() as cur:
        await cur.execute(
            "INSERT INTO tasks (id, project_id, outline, project_task_index) VALUES (%s, %s, %s, 1)",
            (task_id, project_id, wkblib.dumps(geom, hex=True)),
        )
    await db.commit()

    # Matches with project coordinates
    match = await ImageClassifier.find_matching_task(db, project_id, -8.3, 115.5)
    assert match == task_id

    # Ensures it does not match with far away coordinates
    no_match = await ImageClassifier.find_matching_task(db, project_id, 48.8566, 2.3522)
    assert no_match is None
