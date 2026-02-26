"""Tests for batch map data retrieval with GPS and non-GPS images."""

import uuid
import pytest
from shapely.geometry import box

from app.models.enums import ImageStatus
from app.images.image_classification import ImageClassifier


@pytest.mark.asyncio
async def test_get_batch_map_data_with_mixed_gps(db, create_test_project, auth_user):
    """Test that get_batch_map_data returns both located and unlocated images."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

    # Create a test task
    outline = box(-8.34, 115.50, -8.33, 115.51)
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326))
            """,
            (str(task_id), str(project_id), 1, outline.wkt),
        )

    # Insert image WITH GPS location
    image_with_gps_id = uuid.uuid4()
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO project_images
            (id, project_id, task_id, filename, s3_key, hash_md5, batch_id, status, location, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
            """,
            (
                str(image_with_gps_id),
                str(project_id),
                str(task_id),
                "image_with_gps.jpg",
                "images/image_with_gps.jpg",
                "abc123abc123abc123abc123",
                str(batch_id),
                ImageStatus.ASSIGNED.value,
                115.505,  # longitude
                -8.335,  # latitude
                auth_user.id,
            ),
        )

    # Insert image WITHOUT GPS location (null geometry)
    image_without_gps_id = uuid.uuid4()
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO project_images
            (id, project_id, task_id, filename, s3_key, hash_md5, batch_id, status, rejection_reason, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(image_without_gps_id),
                str(project_id),
                str(task_id),
                "image_no_gps.jpg",
                "images/image_no_gps.jpg",
                "def456def456def456def456",
                str(batch_id),
                ImageStatus.INVALID_EXIF.value,
                "No GPS coordinates found in EXIF",
                auth_user.id,
            ),
        )

    await db.commit()

    # Get batch map data
    map_data = await ImageClassifier.get_batch_map_data(db, batch_id, project_id)

    # Verify response structure
    assert map_data["batch_id"] == str(batch_id)
    assert "tasks" in map_data
    assert "images" in map_data
    assert "total_tasks" in map_data
    assert "total_images" in map_data
    assert "total_images_with_gps" in map_data
    assert "total_images_without_gps" in map_data

    # Verify counts
    assert map_data["total_tasks"] == 1
    assert map_data["total_images"] == 2  # Both images included
    assert map_data["total_images_with_gps"] == 1
    assert map_data["total_images_without_gps"] == 1

    # Verify image features
    image_features = map_data["images"]["features"]
    assert len(image_features) == 2

    # Find images by filename
    located_feature = next(
        f for f in image_features if f["properties"]["filename"] == "image_with_gps.jpg"
    )
    unlocated_feature = next(
        f for f in image_features if f["properties"]["filename"] == "image_no_gps.jpg"
    )

    # Verify located image has Point geometry
    assert located_feature["geometry"] is not None
    assert located_feature["geometry"]["type"] == "Point"
    assert located_feature["properties"]["status"] == ImageStatus.ASSIGNED.value

    # Verify unlocated image has null geometry but properties preserved
    assert unlocated_feature["geometry"] is None
    assert unlocated_feature["properties"]["filename"] == "image_no_gps.jpg"
    assert unlocated_feature["properties"]["status"] == ImageStatus.INVALID_EXIF.value
    assert (
        unlocated_feature["properties"]["rejection_reason"]
        == "No GPS coordinates found in EXIF"
    )


@pytest.mark.asyncio
async def test_get_batch_map_data_empty_batch(db, create_test_project, auth_user):
    """Test that get_batch_map_data handles empty batches gracefully."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()

    # Get batch map data for non-existent batch
    map_data = await ImageClassifier.get_batch_map_data(db, batch_id, project_id)

    # Verify response is valid but empty
    assert map_data["batch_id"] == str(batch_id)
    assert map_data["total_tasks"] == 0
    assert map_data["total_images"] == 0
    assert map_data["total_images_with_gps"] == 0
    assert map_data["total_images_without_gps"] == 0
    assert len(map_data["tasks"]["features"]) == 0
    assert len(map_data["images"]["features"]) == 0


@pytest.mark.asyncio
async def test_get_batch_map_data_all_without_gps(db, create_test_project, auth_user):
    """Test batch with only images missing GPS coordinates."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()

    # Insert 3 images without GPS
    for i in range(3):
        image_id = uuid.uuid4()
        async with db.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO project_images
                (id, project_id, filename, s3_key, hash_md5, batch_id, status, rejection_reason, uploaded_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(image_id),
                    str(project_id),
                    f"image_{i}.jpg",
                    f"images/image_{i}.jpg",
                    f"hash{i:0>24}",
                    str(batch_id),
                    ImageStatus.INVALID_EXIF.value,
                    "Missing GPS",
                    auth_user.id,
                ),
            )

    await db.commit()

    # Get batch map data
    map_data = await ImageClassifier.get_batch_map_data(db, batch_id, project_id)

    # Verify all images are returned as unlocated
    assert map_data["total_images"] == 3
    assert map_data["total_images_with_gps"] == 0
    assert map_data["total_images_without_gps"] == 3

    # Verify all features have null geometry
    for feature in map_data["images"]["features"]:
        assert feature["geometry"] is None
        assert feature["properties"]["rejection_reason"] == "Missing GPS"
