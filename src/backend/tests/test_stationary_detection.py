import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import shapely.wkb as wkblib
from shapely.geometry import box

from app.images.flight_stationary_removal import (
    MIN_STATIONARY_CLUSTER,
    mark_and_remove_stationary_imagery,
)


async def _insert_task(db, project_id, task_id):
    geom = box(84.9, 26.9, 85.2, 27.2)
    outline_wkb = wkblib.dumps(geom, hex=True)
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, project_id, 1, outline_wkb),
        )


async def _insert_points(db, project_id, batch_id, task_id, auth_user, points):
    now = datetime.now(timezone.utc)
    async with db.cursor() as cur:
        for i, (lon, lat) in enumerate(points):
            filename = f"img_{i:03d}.jpg"
            await cur.execute(
                """
                INSERT INTO project_images (
                    project_id, filename, s3_key, hash_md5, batch_id, task_id,
                    location, uploaded_by, status, uploaded_at
                )
                VALUES (
                    %(project_id)s, %(filename)s, %(s3_key)s, %(hash_md5)s,
                    %(batch_id)s, %(task_id)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                    %(uploaded_by)s, 'assigned', %(uploaded_at)s
                )
                """,
                {
                    "project_id": str(project_id),
                    "filename": filename,
                    "s3_key": f"projects/{project_id}/user-uploads/{filename}",
                    "hash_md5": hashlib.md5(filename.encode("utf-8")).hexdigest(),
                    "batch_id": str(batch_id),
                    "task_id": str(task_id),
                    "lon": lon,
                    "lat": lat,
                    "uploaded_by": auth_user.id,
                    "uploaded_at": now + timedelta(seconds=i),
                },
            )
    await db.commit()


async def _rejected_count(db, project_id, batch_id):
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*)::int
            FROM project_images
            WHERE project_id = %(project_id)s
              AND batch_id = %(batch_id)s
              AND status = 'rejected'
              AND rejection_reason ILIKE 'Redundant photo:%%'
            """,
            {"project_id": str(project_id), "batch_id": str(batch_id)},
        )
        return (await cur.fetchone())[0]


@pytest.mark.asyncio
async def test_stationary_burst_keeps_first_rejects_rest(
    db, create_test_project, auth_user
):
    """A hover burst at one location keeps the first photo and rejects the rest."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()
    await _insert_task(db, project_id, task_id)

    # 10 photos at essentially the same spot (sub-metre jitter, ~0.5m).
    burst = 10
    points = [(85.0 + i * 0.000005, 27.0) for i in range(burst)]
    await _insert_points(db, project_id, batch_id, task_id, auth_user, points)

    await mark_and_remove_stationary_imagery(db, project_id, batch_id, task_id)
    await db.commit()

    assert await _rejected_count(db, project_id, batch_id) == burst - 1


@pytest.mark.asyncio
async def test_moving_flight_not_rejected(db, create_test_project, auth_user):
    """A normal grid where the drone keeps moving (>5m/frame) is untouched."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()
    await _insert_task(db, project_id, task_id)

    # 0.0001 deg latitude is ~11m, comfortably beyond the 5m tolerance.
    points = [(85.0, 27.0 + i * 0.0001) for i in range(20)]
    await _insert_points(db, project_id, batch_id, task_id, auth_user, points)

    await mark_and_remove_stationary_imagery(db, project_id, batch_id, task_id)
    await db.commit()

    assert await _rejected_count(db, project_id, batch_id) == 0


@pytest.mark.asyncio
async def test_short_pause_below_threshold_not_rejected(
    db, create_test_project, auth_user
):
    """A brief stop (fewer than MIN_STATIONARY_CLUSTER frames) is left alone."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()
    await _insert_task(db, project_id, task_id)

    # A cluster one short of the threshold, then the drone moves on.
    pause = MIN_STATIONARY_CLUSTER - 1
    points = [(85.0, 27.0) for _ in range(pause)]
    points += [(85.0, 27.0 + i * 0.0001) for i in range(1, 6)]
    await _insert_points(db, project_id, batch_id, task_id, auth_user, points)

    await mark_and_remove_stationary_imagery(db, project_id, batch_id, task_id)
    await db.commit()

    assert await _rejected_count(db, project_id, batch_id) == 0
