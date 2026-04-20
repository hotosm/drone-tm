import uuid
import json
import hashlib
import numpy as np
import shapely.wkb as wkblib

from shapely.geometry import box
from datetime import datetime, timezone, timedelta

import pytest

from app.models.enums import ImageStatus
from app.images.image_classification import ImageClassifier, QualityThresholds


def _encode_image(gray_array: np.ndarray) -> bytes:
    import cv2

    bgr = cv2.cvtColor(gray_array, cv2.COLOR_GRAY2BGR)
    _, buf = cv2.imencode(".jpg", bgr)
    return buf.tobytes()


def _make_bgr(b: int, g: int, r: int, size: int = 100) -> np.ndarray:
    img = np.zeros((size, size, 3), dtype=np.uint8)
    img[:, :, 0] = b
    img[:, :, 1] = g
    img[:, :, 2] = r
    return img


def test_grid_sharpness_water_not_rejected():
    """Water imagery (uniform dark) should not be rejected as blurry when
    enough textured cells exist in the image."""
    h, w = 400, 400
    img = np.full((h, w), 60, dtype=np.uint8)
    for y in range(0, h // 2):
        for x in range(0, w // 2):
            img[y, x] = np.uint8((y * 7 + x * 13) % 256)

    result = ImageClassifier.calculate_sharpness_grid(_encode_image(img))
    assert result["sharpness"] >= QualityThresholds.min_sharpness
    assert result["terrain_type"] in (
        "mixed",
        "water",
        "bare_soil",
    )  # terrain_type still in grid result for internal use


def test_grid_sharpness_pure_water_not_rejected():
    """A 100% water image (all cells low-texture, blue hue) should not be
    rejected as blurry - low Laplacian variance is expected for water."""
    import cv2

    # Uniform blue image simulating open water
    bgr = _make_bgr(180, 80, 50, size=400)
    # Add very slight noise so JPEG encode doesn't collapse to a single value
    rng = np.random.RandomState(99)
    bgr = np.clip(
        bgr.astype(np.int16) + rng.randint(-3, 4, bgr.shape, dtype=np.int16),
        0,
        255,
    ).astype(np.uint8)
    _, buf = cv2.imencode(".jpg", bgr)
    image_bytes = buf.tobytes()

    result = ImageClassifier.calculate_sharpness_grid(image_bytes)
    # Sharpness will be very low (no texture), but terrain should be "water"
    assert result["sharpness"] < QualityThresholds.min_sharpness
    assert result["terrain_type"] == "water"
    # The key assertion: water terrain is in LOW_TEXTURE_TERRAINS so the
    # blur rejection should be skipped by classify_single_image.
    assert result["terrain_type"] in ImageClassifier.LOW_TEXTURE_TERRAINS


def test_grid_sharpness_pure_snow_not_rejected():
    """A 100% snow image should not be rejected as blurry."""
    import cv2

    bgr = _make_bgr(240, 240, 240, size=400)
    rng = np.random.RandomState(42)
    bgr = np.clip(
        bgr.astype(np.int16) + rng.randint(-2, 3, bgr.shape, dtype=np.int16),
        0,
        255,
    ).astype(np.uint8)
    _, buf = cv2.imencode(".jpg", bgr)
    image_bytes = buf.tobytes()

    result = ImageClassifier.calculate_sharpness_grid(image_bytes)
    assert result["sharpness"] < QualityThresholds.min_sharpness
    assert result["terrain_type"] == "snow_ice"
    assert result["terrain_type"] in ImageClassifier.LOW_TEXTURE_TERRAINS


def test_grid_sharpness_fully_blurry_still_rejected():
    """A truly blurry image (all cells low variance) with non-natural terrain
    (e.g. uniform gray - classified as mixed/vegetation/urban) is still rejected."""
    img = np.full((400, 400), 128, dtype=np.uint8)
    noise = np.random.RandomState(42).randint(-2, 3, (400, 400), dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    result = ImageClassifier.calculate_sharpness_grid(_encode_image(img))
    assert result["sharpness"] < QualityThresholds.min_sharpness
    # Uniform gray is NOT a low-texture terrain type, so blur rejection applies
    assert result["terrain_type"] not in ImageClassifier.LOW_TEXTURE_TERRAINS


def test_terrain_classification_water():
    bgr = _make_bgr(180, 80, 50)  # blue-dominant
    terrain = ImageClassifier._classify_terrain(bgr, 0.8, [])
    assert terrain == "water"


def test_terrain_classification_water_bright():
    """Bright water with sun reflection should still be classified as water, not snow."""
    bgr = _make_bgr(220, 180, 160)  # bright but still blue-dominant
    terrain = ImageClassifier._classify_terrain(bgr, 0.8, [])
    assert terrain == "water"


def test_terrain_classification_water_dirty():
    bgr = _make_bgr(60, 100, 140)  # brown/tan, no blue
    terrain = ImageClassifier._classify_terrain(bgr, 0.95, [])
    assert terrain == "water"


def test_terrain_classification_snow():
    bgr = _make_bgr(240, 240, 240)  # achromatic bright = snow
    terrain = ImageClassifier._classify_terrain(bgr, 0.8, [])
    assert terrain == "snow_ice"


def test_terrain_classification_sand():
    bgr = _make_bgr(100, 160, 200)  # warm orange-yellow in BGR
    terrain = ImageClassifier._classify_terrain(bgr, 0.8, [15.0])
    assert terrain == "sand"


def test_terrain_classification_bare_soil():
    bgr = _make_bgr(110, 115, 120)  # neutral mid-tone, low saturation
    terrain = ImageClassifier._classify_terrain(bgr, 0.7, [])
    assert terrain == "bare_soil"


def test_terrain_classification_dense_vegetation():
    bgr = _make_bgr(30, 80, 20)  # dark green
    terrain = ImageClassifier._classify_terrain(bgr, 0.1, [200.0, 300.0])
    assert terrain == "dense_vegetation"


def test_terrain_classification_urban():
    bgr = np.zeros((100, 100, 3), dtype=np.uint8)
    bgr[:50, :] = [200, 200, 200]
    bgr[50:, :] = [30, 30, 30]
    terrain = ImageClassifier._classify_terrain(bgr, 0.1, [500.0, 600.0])
    assert terrain == "urban"


def test_terrain_classification_vegetation():
    bgr = _make_bgr(40, 140, 50)  # green, moderate brightness
    terrain = ImageClassifier._classify_terrain(bgr, 0.1, [150.0])
    assert terrain == "vegetation"


def test_terrain_classification_mixed():
    bgr = _make_bgr(120, 120, 120)  # neutral
    terrain = ImageClassifier._classify_terrain(bgr, 0.4, [200.0])
    assert terrain == "mixed"


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
