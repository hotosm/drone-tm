"""Integration tests for the project-scoped classification endpoints.

These tests hit real Postgres (via docker-compose) and exercise the
classification_routes.py router through the ASGI test client.
"""

import json
import uuid
from datetime import datetime, timezone
from io import BytesIO

import pytest
import pytest_asyncio

from app.images import image_classification
from app.arq.tasks import (
    get_redis_pool,
    ingest_existing_uploads as ingest_existing_uploads_task,
)
from app.config import settings
from app.db.database import get_db_connection_pool
from app.s3 import add_obj_to_bucket, delete_objects_by_prefix

# ─── Shared helpers ──────────────────────────────────────────────────────────

# Task outline that covers a known point (used by _insert_image_with_gps)
TASK_OUTLINE = {
    "type": "Polygon",
    "coordinates": [
        [
            [-69.497, 18.630],
            [-69.485, 18.617],
            [-69.541, 18.608],
            [-69.541, 18.615],
            [-69.497, 18.630],
        ]
    ],
}

# A point inside TASK_OUTLINE
INSIDE_LON, INSIDE_LAT = -69.51, 18.62

# A point outside all tasks
OUTSIDE_LON, OUTSIDE_LAT = 0.0, 0.0


async def _insert_task(db, *, project_id: str, task_index: int = 1) -> str:
    task_id = str(uuid.uuid4())
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """,
            (task_id, project_id, task_index, json.dumps(TASK_OUTLINE)),
        )
    await db.commit()
    return task_id


async def _insert_image(
    db,
    *,
    project_id: str,
    uploaded_by: str,
    status: str = "staged",
    task_id: str | None = None,
    batch_id: str | None = None,
    lon: float | None = None,
    lat: float | None = None,
    rejection_reason: str | None = None,
    filename: str | None = None,
    classified_at: str | None = None,
) -> str:
    image_id = str(uuid.uuid4())
    batch_id = batch_id or str(uuid.uuid4())
    filename = filename or f"{image_id}.jpg"

    location_expr = (
        "ST_SetSRID(ST_MakePoint(%s, %s), 4326)" if lon is not None else "NULL"
    )

    async with db.cursor() as cur:
        sql = f"""
            INSERT INTO project_images (
                id, project_id, filename, s3_key, hash_md5, batch_id,
                task_id, status, uploaded_by, location, rejection_reason,
                uploaded_at, classified_at
            )
            VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, {location_expr}, %s,
                CURRENT_TIMESTAMP, %s
            )
        """
        params = [
            image_id,
            project_id,
            filename,
            f"projects/{project_id}/{image_id}.jpg",
            uuid.uuid4().hex,
            batch_id,
            task_id,
            status,
            uploaded_by,
        ]
        if lon is not None:
            params.extend([lon, lat])
        params.append(rejection_reason)
        params.append(classified_at)

        await cur.execute(sql, tuple(params))
    await db.commit()
    return image_id


@pytest_asyncio.fixture
async def redis_pool():
    redis = await get_redis_pool()
    await redis.flushdb()
    try:
        yield redis
    finally:
        await redis.flushdb()
        await redis.aclose()


@pytest_asyncio.fixture
async def arq_ctx(redis_pool):
    db_pool = await get_db_connection_pool()
    try:
        yield {"redis": redis_pool, "db_pool": db_pool, "job_id": "test-ingest-job"}
    finally:
        await db_pool.close()


# ─── /classify/ ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_start_project_classification_returns_no_job_when_no_staged_images(
    client, app, create_test_project
):
    project_id = create_test_project

    class FakeRedis:
        def __init__(self):
            self.jobs = []

        async def enqueue_job(self, *args, **kwargs):
            self.jobs.append((args, kwargs))
            return None

    fake_redis = FakeRedis()
    app.dependency_overrides[get_redis_pool] = lambda: fake_redis

    resp = await client.post(f"/api/projects/{project_id}/classify/")

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "message": "No images available for classification",
        "project_id": project_id,
        "image_count": 0,
    }
    assert fake_redis.jobs == []


@pytest.mark.asyncio
async def test_start_project_classification_enqueues_job_for_staged_images(
    client, app, db, auth_user, create_test_project
):
    project_id = create_test_project
    await _insert_image(
        db, project_id=project_id, uploaded_by=auth_user.id, status="staged"
    )
    await _insert_image(
        db, project_id=project_id, uploaded_by=auth_user.id, status="assigned"
    )

    class FakeJob:
        job_id = "job-123"

    class FakeRedis:
        def __init__(self):
            self.jobs = []

        async def enqueue_job(self, *args, **kwargs):
            self.jobs.append((args, kwargs))
            return FakeJob()

    fake_redis = FakeRedis()
    app.dependency_overrides[get_redis_pool] = lambda: fake_redis

    resp = await client.post(f"/api/projects/{project_id}/classify/")

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "message": "Project classification started",
        "job_id": "job-123",
        "project_id": project_id,
        "image_count": 1,
    }
    assert fake_redis.jobs == [
        (
            ("classify_project_images", project_id),
            {"_queue_name": "default_queue"},
        )
    ]


@pytest.mark.asyncio
async def test_ingest_existing_uploads_route_deduplicates_top_level_job(
    client, redis_pool, create_test_project
):
    project_id = create_test_project

    resp1 = await client.post(f"/api/projects/{project_id}/ingest-uploads/")
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert body1["message"] == "Ingestion job queued"
    assert body1["job_id"] == f"ingest-uploads:{project_id}"

    resp2 = await client.post(f"/api/projects/{project_id}/ingest-uploads/")
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert body2["message"] == "Ingestion job already queued"
    assert body2["job_id"] == f"ingest-uploads:{project_id}"

    queued = await redis_pool.queued_jobs(queue_name="default_queue")
    ingest_jobs = [job for job in queued if job.function == "ingest_existing_uploads"]
    assert len(ingest_jobs) == 1
    assert ingest_jobs[0].job_id == f"ingest-uploads:{project_id}"
    assert ingest_jobs[0].args == (
        project_id,
        "101039844375937810000",
        body1["batch_id"],
    )


# ─── /imagery/status/ ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_imagery_status_empty_project(client, create_test_project):
    project_id = create_test_project
    resp = await client.get(f"/api/projects/{project_id}/imagery/status/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0


@pytest.mark.asyncio
async def test_ingest_existing_uploads_task_enqueues_child_jobs_once(
    arq_ctx, db, auth_user, create_test_project
):
    project_id = create_test_project
    bucket = settings.S3_BUCKET_NAME
    prefix = f"projects/{project_id}/user-uploads/"
    keys = [
        f"{prefix}alpha.jpg",
        f"{prefix}beta.JPG",
        f"{prefix}thumb_gamma.jpg",
        f"{prefix}notes.txt",
    ]

    for key in keys:
        add_obj_to_bucket(
            bucket, BytesIO(b"test-bytes"), key, content_type="image/jpeg"
        )

    # One object is already tracked and should be skipped.
    tracked_key = f"{prefix}alpha.jpg"
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="staged",
        filename="alpha.jpg",
    )
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE project_images
            SET s3_key = %(s3_key)s
            WHERE project_id = %(project_id)s AND filename = 'alpha.jpg'
            """,
            {"s3_key": tracked_key, "project_id": project_id},
        )
    await db.commit()

    batch_id = str(uuid.uuid4())
    try:
        result1 = await ingest_existing_uploads_task(
            arq_ctx, project_id, auth_user.id, batch_id
        )
        result2 = await ingest_existing_uploads_task(
            arq_ctx, project_id, auth_user.id, str(uuid.uuid4())
        )

        assert result1["enqueued"] == 1
        assert result2["enqueued"] == 0

        queued = await arq_ctx["redis"].queued_jobs(queue_name="default_queue")
        child_jobs = [job for job in queued if job.function == "process_uploaded_image"]

        assert len(child_jobs) == 1
        assert child_jobs[0].args[0] == project_id
        assert child_jobs[0].args[1] == f"{prefix}beta.JPG"
        assert child_jobs[0].args[2] == "beta.JPG"
    finally:
        delete_objects_by_prefix(bucket, prefix)


@pytest.mark.asyncio
async def test_ingest_existing_uploads_task_skips_when_project_lock_is_held(
    arq_ctx, auth_user, create_test_project
):
    project_id = create_test_project
    lock_key = f"lock:ingest:{project_id}"
    await arq_ctx["redis"].set(lock_key, "other-job", ex=1800)

    result = await ingest_existing_uploads_task(
        arq_ctx,
        project_id,
        auth_user.id,
        str(uuid.uuid4()),
    )

    assert result["skipped"] is True
    assert result["enqueued"] == 0

    queued = await arq_ctx["redis"].queued_jobs(queue_name="default_queue")
    child_jobs = [job for job in queued if job.function == "process_uploaded_image"]
    assert child_jobs == []


@pytest.mark.asyncio
async def test_imagery_status_counts_by_status(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)

    await _insert_image(
        db, project_id=project_id, uploaded_by=auth_user.id, status="staged"
    )
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
    )
    await _insert_image(
        db, project_id=project_id, uploaded_by=auth_user.id, status="rejected"
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/status/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert body["staged"] == 1
    assert body["assigned"] == 1
    assert body["rejected"] == 1


# ─── /imagery/images/ ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_imagery_images_returns_all(client, db, auth_user, create_test_project):
    project_id = create_test_project
    await _insert_image(
        db, project_id=project_id, uploaded_by=auth_user.id, status="staged"
    )
    await _insert_image(
        db, project_id=project_id, uploaded_by=auth_user.id, status="rejected"
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/images/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 2


@pytest.mark.asyncio
async def test_imagery_images_incremental_polling(
    client, db, auth_user, create_test_project
):
    """Incremental polling with last_timestamp should only return
    images classified after that timestamp."""
    project_id = create_test_project

    past = datetime(2020, 1, 1, tzinfo=timezone.utc).isoformat()
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        classified_at=past,
    )

    # Polling with a timestamp after the classified_at should return nothing
    future = datetime(2099, 1, 1, tzinfo=timezone.utc).isoformat()
    resp = await client.get(
        f"/api/projects/{project_id}/imagery/images/",
        params={"last_timestamp": future},
    )
    assert resp.status_code == 200
    assert resp.json()["count"] == 0

    # Polling with a timestamp before the classified_at should return the image
    before = datetime(2019, 1, 1, tzinfo=timezone.utc).isoformat()
    resp = await client.get(
        f"/api/projects/{project_id}/imagery/images/",
        params={"last_timestamp": before},
    )
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


# ─── /imagery/task/{task_id}/image-urls/ and /imagery/image-urls/ ───────────


@pytest.mark.asyncio
async def test_task_image_urls_variant_thumb_only(
    client, db, auth_user, create_test_project, monkeypatch
):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
    )

    monkeypatch.setattr(
        image_classification,
        "maybe_presign_s3_key",
        lambda key, expires_hours=1: f"signed:{key}",
    )

    resp = await client.get(
        f"/api/projects/{project_id}/imagery/task/{task_id}/image-urls/",
        params={"variant": "thumb"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["task_id"] == task_id
    assert body["images"] == [
        {
            "id": image_id,
            "thumbnail_url": None,
        }
    ]


@pytest.mark.asyncio
async def test_bulk_image_urls_returns_requested_variant_only(
    client, db, auth_user, create_test_project, monkeypatch
):
    project_id = create_test_project
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="unmatched",
    )

    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE project_images
            SET thumbnail_url = %s
            WHERE id = %s
            """,
            (f"projects/{project_id}/{image_id}-thumb.jpg", image_id),
        )
    await db.commit()

    monkeypatch.setattr(
        image_classification,
        "maybe_presign_s3_key",
        lambda key, expires_hours=1: f"signed:{key}",
    )

    resp = await client.post(
        f"/api/projects/{project_id}/imagery/image-urls/",
        json={"image_ids": [image_id], "variant": "full"},
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "images": [
            {
                "id": image_id,
                "url": f"signed:projects/{project_id}/{image_id}.jpg",
            }
        ]
    }


@pytest.mark.asyncio
async def test_bulk_image_urls_rejects_invalid_variant(client, create_test_project):
    project_id = create_test_project

    resp = await client.post(
        f"/api/projects/{project_id}/imagery/image-urls/",
        json={"image_ids": [], "variant": "bad"},
    )

    assert resp.status_code == 422


# ─── /imagery/review/ ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_review_includes_unmatched_images(
    client, db, auth_user, create_test_project
):
    """Unmatched images must appear in the review response."""
    project_id = create_test_project
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="unmatched",
        lon=OUTSIDE_LON,
        lat=OUTSIDE_LAT,
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/review/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_images"] == 1
    statuses = [
        img["status"] for group in body["task_groups"] for img in group["images"]
    ]
    assert "unmatched" in statuses


@pytest.mark.asyncio
async def test_review_groups_by_task(client, db, auth_user, create_test_project):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)

    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
    )
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
        task_id=None,
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/review/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_images"] == 2
    # Should have two groups: one for the task, one for null (unassigned)
    assert len(body["task_groups"]) == 2


# ─── /imagery/map-data/ ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_map_data_returns_all_tasks(client, db, auth_user, create_test_project):
    """Map data should return ALL tasks, even those without imagery."""
    project_id = create_test_project
    await _insert_task(db, project_id=project_id, task_index=1)
    await _insert_task(db, project_id=project_id, task_index=2)

    resp = await client.get(f"/api/projects/{project_id}/imagery/map-data/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_tasks"] == 2
    # No images inserted, so has_imagery should be false for both
    for feature in body["tasks"]["features"]:
        assert feature["properties"]["has_imagery"] is False


@pytest.mark.asyncio
async def test_map_data_includes_unmatched_images(
    client, db, auth_user, create_test_project
):
    """Map data images should include unmatched status."""
    project_id = create_test_project
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="unmatched",
        lon=OUTSIDE_LON,
        lat=OUTSIDE_LAT,
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/map-data/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_images"] == 1
    assert body["images"]["features"][0]["properties"]["status"] == "unmatched"


@pytest.mark.asyncio
async def test_map_data_has_imagery_flag(client, db, auth_user, create_test_project):
    """Tasks with assigned images should have has_imagery=True."""
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
        lon=INSIDE_LON,
        lat=INSIDE_LAT,
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/map-data/")
    assert resp.status_code == 200
    body = resp.json()
    features = body["tasks"]["features"]
    task_feature = next(f for f in features if f["properties"]["id"] == task_id)
    assert task_feature["properties"]["has_imagery"] is True


@pytest.mark.asyncio
async def test_map_data_mixed_gps_and_unlocated_images(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
        lon=INSIDE_LON,
        lat=INSIDE_LAT,
        filename="with-gps.jpg",
    )
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="invalid_exif",
        rejection_reason="No GPS coordinates found in EXIF",
        filename="no-gps.jpg",
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/map-data/")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_images"] == 2
    assert body["total_images_with_gps"] == 1
    assert body["total_images_without_gps"] == 1

    features = body["images"]["features"]
    located = next(
        feature
        for feature in features
        if feature["properties"]["filename"] == "with-gps.jpg"
    )
    unlocated = next(
        feature
        for feature in features
        if feature["properties"]["filename"] == "no-gps.jpg"
    )

    assert located["geometry"]["type"] == "Point"
    assert located["properties"]["status"] == "assigned"
    assert unlocated["geometry"] is None
    assert unlocated["properties"]["status"] == "invalid_exif"
    assert (
        unlocated["properties"]["rejection_reason"]
        == "No GPS coordinates found in EXIF"
    )


# ─── /imagery/task/{task_id}/verification/ ───────────────────────────────────


@pytest.mark.asyncio
async def test_task_verification_aggregates_assigned_images_across_batches(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)

    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
        batch_id=str(uuid.uuid4()),
        lon=INSIDE_LON,
        lat=INSIDE_LAT,
        filename="batch-a.jpg",
    )
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
        batch_id=str(uuid.uuid4()),
        lon=INSIDE_LON,
        lat=INSIDE_LAT,
        filename="batch-b.jpg",
    )
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
        task_id=task_id,
        batch_id=str(uuid.uuid4()),
        lon=INSIDE_LON,
        lat=INSIDE_LAT,
        filename="rejected.jpg",
    )

    resp = await client.get(
        f"/api/projects/{project_id}/imagery/task/{task_id}/verification/"
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["task_id"] == task_id
    assert body["image_count"] == 2
    assert body["project_task_index"] == 1
    assert body["task_geometry"]["geometry"]["type"] == "Polygon"
    assert {image["filename"] for image in body["images"]} == {
        "batch-a.jpg",
        "batch-b.jpg",
    }


@pytest.mark.asyncio
async def test_task_verification_returns_404_for_missing_task(
    client, create_test_project
):
    project_id = create_test_project
    fake_task_id = str(uuid.uuid4())

    resp = await client.get(
        f"/api/projects/{project_id}/imagery/task/{fake_task_id}/verification/"
    )

    assert resp.status_code == 404


# ─── /images/{id}/accept/ ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_accept_image_assigns_to_task(client, db, auth_user, create_test_project):
    """Accepting a rejected image with GPS inside a task should assign it."""
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
        lon=INSIDE_LON,
        lat=INSIDE_LAT,
        rejection_reason="Blurry",
    )

    resp = await client.post(f"/api/projects/{project_id}/images/{image_id}/accept/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "assigned"
    assert body["task_id"] == task_id

    # Verify persisted in DB
    async with db.cursor() as cur:
        await cur.execute(
            "SELECT status, task_id FROM project_images WHERE id = %s",
            (image_id,),
        )
        row = await cur.fetchone()
    assert row[0] == "assigned"
    assert str(row[1]) == task_id


@pytest.mark.asyncio
async def test_accept_image_unmatched_when_outside_tasks(
    client, db, auth_user, create_test_project
):
    """Accepting an image with GPS outside all tasks should mark it unmatched."""
    project_id = create_test_project
    await _insert_task(db, project_id=project_id)
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
        lon=OUTSIDE_LON,
        lat=OUTSIDE_LAT,
        rejection_reason="Bad quality",
    )

    resp = await client.post(f"/api/projects/{project_id}/images/{image_id}/accept/")
    assert resp.status_code == 200
    assert resp.json()["status"] == "unmatched"


@pytest.mark.asyncio
async def test_accept_image_fails_without_gps(
    client, db, auth_user, create_test_project
):
    """Accepting an image without GPS coordinates should fail."""
    project_id = create_test_project
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="invalid_exif",
    )

    resp = await client.post(f"/api/projects/{project_id}/images/{image_id}/accept/")
    assert resp.status_code == 400


# ─── /images/{id}/assign-task/ ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_assign_task_persists_to_db(client, db, auth_user, create_test_project):
    """Manual task assignment should be persisted (not rolled back)."""
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="unmatched",
    )

    resp = await client.post(
        f"/api/projects/{project_id}/images/{image_id}/assign-task/",
        json={"task_id": task_id},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "assigned"

    # Verify persisted - read through a fresh cursor
    async with db.cursor() as cur:
        await cur.execute(
            "SELECT status, task_id FROM project_images WHERE id = %s",
            (image_id,),
        )
        row = await cur.fetchone()
    assert row[0] == "assigned"
    assert str(row[1]) == task_id


@pytest.mark.asyncio
async def test_assign_task_rejects_already_assigned(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
    )

    resp = await client.post(
        f"/api/projects/{project_id}/images/{image_id}/assign-task/",
        json={"task_id": task_id},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_assign_task_rejects_non_unmatched(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
    )

    resp = await client.post(
        f"/api/projects/{project_id}/images/{image_id}/assign-task/",
        json={"task_id": task_id},
    )
    assert resp.status_code == 400
    assert "unmatched" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_assign_task_rejects_invalid_task_id(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="unmatched",
    )
    fake_task_id = str(uuid.uuid4())

    resp = await client.post(
        f"/api/projects/{project_id}/images/{image_id}/assign-task/",
        json={"task_id": fake_task_id},
    )
    assert resp.status_code == 400


# ─── DELETE /images/{id}/ ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_image_persists(client, db, auth_user, create_test_project):
    """Deleting an image should actually remove it from the DB."""
    project_id = create_test_project
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
    )

    resp = await client.delete(f"/api/projects/{project_id}/images/{image_id}/")
    assert resp.status_code == 200

    async with db.cursor() as cur:
        await cur.execute("SELECT id FROM project_images WHERE id = %s", (image_id,))
        row = await cur.fetchone()
    assert row is None


@pytest.mark.asyncio
async def test_delete_image_404_wrong_project(
    client, db, auth_user, create_test_project
):
    """Deleting an image from the wrong project should return 404."""
    project_id = create_test_project
    image_id = await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
    )
    fake_project = str(uuid.uuid4())

    resp = await client.delete(f"/api/projects/{fake_project}/images/{image_id}/")
    assert resp.status_code == 404


# ─── /imagery/tasks/ (per-task summary) ──────────────────────────────────────


@pytest.mark.asyncio
async def test_task_imagery_summary(client, db, auth_user, create_test_project):
    project_id = create_test_project
    task_id = await _insert_task(db, project_id=project_id)

    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
    )
    await _insert_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
        task_id=task_id,
    )

    resp = await client.get(f"/api/projects/{project_id}/imagery/tasks/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["task_id"] == task_id
    assert body[0]["total_images"] == 2
    assert body[0]["assigned_images"] == 1
    assert body[0]["rejected_images"] == 1
