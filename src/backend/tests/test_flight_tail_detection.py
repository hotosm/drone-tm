import hashlib
import uuid
import json
import shapely.wkb as wkblib

from shapely.geometry import box
from datetime import datetime, timedelta, timezone

import pytest

from psycopg.rows import dict_row

from app.images.image_logic import mark_and_remove_flight_tail_imagery


@pytest.mark.asyncio
async def test_flight_tail_images_marked_rejected(db, create_test_project, auth_user):
    """
    Ensure flight-tail detection marks takeoff/landing transit imagery as rejected
    with a user-facing rejection_reason, so the UI can display the issue.
    """
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

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

    base_lon = 85.0
    base_lat = 27.0

    # Build a simple path:
    # - takeoff transit: moving north (azimuth ~0)
    # - mission: moving east (azimuth ~90)
    # - landing transit: moving south (azimuth ~180)

    # To pass the 25% safety fraction and the search_limit,
    # we need a longer mission (Total ~52 images)
    points: list[tuple[float, float]] = []

    # Use ~11m steps so distance-based filtering (MIN_DISTANCE_METERS) doesn't discard points.
    # NOTE: tail detection requires >= 20 images per segment.

    # We need at least 5 images for baseline, turn happens at index 6
    for i in range(6):
        points.append((base_lon, base_lat + i * 0.0001))

    # 40 points east
    east_start_lon, east_start_lat = points[-1]
    for i in range(1, 41):
        points.append((east_start_lon + i * 0.0001, east_start_lat))

    # 6 points south
    south_start_lon, south_start_lat = points[-1]
    for i in range(1, 7):
        points.append((south_start_lon, south_start_lat - i * 0.0001))

    now = datetime.now(timezone.utc)
    inserted_ids: list[uuid.UUID] = []

    async with db.cursor() as cur:
        for i, (lon, lat) in enumerate(points):
            filename = f"img_{i:03d}.jpg"
            s3_key = f"projects/{project_id}/user-uploads/{filename}"
            hash_md5 = hashlib.md5(filename.encode("utf-8")).hexdigest()
            uploaded_at = now + timedelta(seconds=i)

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
                    uploaded_at
                )
                VALUES (
                    %(project_id)s,
                    %(filename)s,
                    %(s3_key)s,
                    %(hash_md5)s,
                    %(batch_id)s,
                    %(task_id)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                    %(uploaded_by)s,
                    'assigned',
                    %(uploaded_at)s
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
                    "lon": lon,
                    "lat": lat,
                    "uploaded_by": auth_user.id,
                    "uploaded_at": uploaded_at,
                },
            )
            row = await cur.fetchone()
            inserted_ids.append(row[0])

    await db.commit()

    # Run detection
    await mark_and_remove_flight_tail_imagery(db, project_id, batch_id, task_id)
    await db.commit()

    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*)::int
            FROM project_images
            WHERE project_id = %(project_id)s
              AND batch_id = %(batch_id)s
              AND status = 'rejected'
              AND rejection_reason ILIKE 'Flight tail detection:%%'
            """,
            {"project_id": str(project_id), "batch_id": str(batch_id)},
        )
        rejected_count = (await cur.fetchone())[0]

    # We should reject at least a handful (takeoff and landing tails).
    assert rejected_count >= 4


@pytest.mark.asyncio
async def test_flight_tail_does_not_override_existing_rejection_reason(
    db, create_test_project, auth_user
):
    """
    Regression: if an image already has a rejection_reason set (e.g. "Blurry ..."),
    flight-tail detection must NOT override it or change the row.
    """
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

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

    base_lon = 85.0
    base_lat = 27.0

    points: list[tuple[float, float]] = []
    for i in range(8):
        points.append((base_lon, base_lat + i * 0.0001))
    east_start_lon, east_start_lat = points[-1]
    for i in range(1, 11):
        points.append((east_start_lon + i * 0.0001, east_start_lat))
    south_start_lon, south_start_lat = points[-1]
    for i in range(1, 9):
        points.append((south_start_lon, south_start_lat - i * 0.0001))

    now = datetime.now(timezone.utc)

    # Mark a couple early points as already-rejected-for-quality but leave them 'assigned'
    # to simulate the inconsistent state we want to be robust against.
    pre_rejected_idx = {1, 2}

    async with db.cursor() as cur:
        for i, (lon, lat) in enumerate(points):
            filename = f"img_{i:03d}.jpg"
            s3_key = f"projects/{project_id}/user-uploads/{filename}"
            hash_md5 = hashlib.md5(filename.encode("utf-8")).hexdigest()
            uploaded_at = now + timedelta(seconds=i)

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
                    rejection_reason,
                    uploaded_at
                )
                VALUES (
                    %(project_id)s,
                    %(filename)s,
                    %(s3_key)s,
                    %(hash_md5)s,
                    %(batch_id)s,
                    %(task_id)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                    %(uploaded_by)s,
                    'assigned',
                    %(rejection_reason)s,
                    %(uploaded_at)s
                )
                """,
                {
                    "project_id": str(project_id),
                    "filename": filename,
                    "s3_key": s3_key,
                    "hash_md5": hash_md5,
                    "batch_id": str(batch_id),
                    "task_id": str(task_id),
                    "lon": lon,
                    "lat": lat,
                    "uploaded_by": auth_user.id,
                    "uploaded_at": uploaded_at,
                    "rejection_reason": (
                        "Blurry (sharpness: 10.0, min: 100.0)"
                        if i in pre_rejected_idx
                        else None
                    ),
                },
            )

    await db.commit()

    await mark_and_remove_flight_tail_imagery(db, project_id, batch_id, task_id)
    await db.commit()

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT id, status, rejection_reason
            FROM project_images
            WHERE project_id = %(project_id)s
              AND batch_id = %(batch_id)s
            ORDER BY uploaded_at ASC
            """,
            {"project_id": str(project_id), "batch_id": str(batch_id)},
        )
        rows = await cur.fetchall()

    assert len(rows) == len(points)
    for idx in pre_rejected_idx:
        assert rows[idx]["status"] == "assigned"
        assert rows[idx]["rejection_reason"].startswith("Blurry")


@pytest.mark.asyncio
async def test_multi_flight_batch_does_not_create_false_tails(
    db, create_test_project, auth_user
):
    """
    Regression: users may upload multiple distinct flights/sorties into a single batch (large
    time gaps). Tail detection should not treat the gap as a "turn" and falsely reject images.

    This test uses a small subset of the EXIF sample the user provided (DateTimeOriginal + GPS),
    representing two flights separated by hours.
    """
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

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

    # Helper: convert DMS like '8 deg 17\' 42.56" S' to decimal degrees.
    def dms_to_decimal(dms: str) -> float:
        s = dms.strip().replace("°", " deg ")
        # Expected forms in the sample: '8 deg 17\' 42.56" S'
        parts = s.split()
        deg = float(parts[0])
        minutes = float(parts[2].replace("'", ""))
        seconds = float(parts[3].replace('"', ""))
        hemi = parts[4].upper()
        value = deg + minutes / 60.0 + seconds / 3600.0
        if hemi in ("S", "W"):
            value *= -1
        return value

    # Flight 1 (straight-ish), around 13:27:03..13:27:17
    flight1 = [
        ("2025:10:01 13:27:03", "8 deg 17' 42.56\" S", "115 deg 29' 14.67\" E"),
        ("2025:10:01 13:27:05", "8 deg 17' 42.58\" S", "115 deg 29' 15.25\" E"),
        ("2025:10:01 13:27:07", "8 deg 17' 42.60\" S", "115 deg 29' 15.98\" E"),
        ("2025:10:01 13:27:09", "8 deg 17' 42.62\" S", "115 deg 29' 16.73\" E"),
        ("2025:10:01 13:27:11", "8 deg 17' 42.64\" S", "115 deg 29' 17.47\" E"),
        ("2025:10:01 13:27:13", "8 deg 17' 42.66\" S", "115 deg 29' 18.21\" E"),
        ("2025:10:01 13:27:15", "8 deg 17' 42.68\" S", "115 deg 29' 18.93\" E"),
        ("2025:10:01 13:27:17", "8 deg 17' 42.69\" S", "115 deg 29' 19.55\" E"),
    ]

    # Flight 2, separated by hours (21:35:05..21:35:13)
    flight2 = [
        ("2025:10:01 21:35:05", "8 deg 18' 14.76\" S", "115 deg 29' 3.39\" E"),
        ("2025:10:01 21:35:07", "8 deg 18' 14.73\" S", "115 deg 29' 2.93\" E"),
        ("2025:10:01 21:35:09", "8 deg 18' 14.72\" S", "115 deg 29' 2.61\" E"),
        ("2025:10:01 21:35:11", "8 deg 18' 14.73\" S", "115 deg 29' 2.38\" E"),
        ("2025:10:01 21:35:13", "8 deg 18' 14.73\" S", "115 deg 29' 1.94\" E"),
        ("2025:10:01 21:35:15", "8 deg 18' 14.73\" S", "115 deg 29' 1.39\" E"),
        ("2025:10:01 21:35:17", "8 deg 18' 14.73\" S", "115 deg 29' 0.81\" E"),
        ("2025:10:01 21:35:19", "8 deg 18' 14.73\" S", "115 deg 29' 0.09\" E"),
    ]

    rows = []
    for idx, (dt, lat_dms, lon_dms) in enumerate(flight1 + flight2):
        lat = dms_to_decimal(lat_dms)
        lon = dms_to_decimal(lon_dms)
        rows.append((idx, dt, lon, lat))

    # Intentionally set uploaded_at out of order to ensure we rely on DateTimeOriginal for ordering.
    now = datetime.now(timezone.utc)
    uploaded_order = list(reversed(range(len(rows))))

    async with db.cursor() as cur:
        for insert_idx, (orig_idx, dt, lon, lat) in enumerate(rows):
            filename = f"sample_{orig_idx:03d}.jpg"
            s3_key = f"projects/{project_id}/user-uploads/{filename}"
            hash_md5 = hashlib.md5(filename.encode("utf-8")).hexdigest()
            uploaded_at = now + timedelta(seconds=uploaded_order[insert_idx])

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
                    exif,
                    uploaded_by,
                    status,
                    uploaded_at
                )
                VALUES (
                    %(project_id)s,
                    %(filename)s,
                    %(s3_key)s,
                    %(hash_md5)s,
                    %(batch_id)s,
                    %(task_id)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                    %(exif)s,
                    %(uploaded_by)s,
                    'assigned',
                    %(uploaded_at)s
                )
                """,
                {
                    "project_id": str(project_id),
                    "filename": filename,
                    "s3_key": s3_key,
                    "hash_md5": hash_md5,
                    "batch_id": str(batch_id),
                    "task_id": str(task_id),
                    "lon": lon,
                    "lat": lat,
                    "exif": json.dumps({"DateTimeOriginal": dt}),
                    "uploaded_by": auth_user.id,
                    "uploaded_at": uploaded_at,
                },
            )

    await db.commit()

    await mark_and_remove_flight_tail_imagery(db, project_id, batch_id, task_id)
    await db.commit()

    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*)::int
            FROM project_images
            WHERE project_id = %(project_id)s
              AND batch_id = %(batch_id)s
              AND status = 'rejected'
              AND rejection_reason ILIKE 'Flight tail detection:%%'
            """,
            {"project_id": str(project_id), "batch_id": str(batch_id)},
        )
        rejected_count = (await cur.fetchone())[0]

    assert rejected_count == 0


@pytest.mark.asyncio
async def test_vertical_takeoff_tail(db, create_test_project, auth_user):
    """Verifies detection of high-altitude takeoff tails."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

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

    async with db.cursor() as cur:
        for i in range(52):
            is_vertical = i < 6
            ts = datetime.now(timezone.utc) + timedelta(seconds=i)
            lat = -8.301 if is_vertical else -8.301 + (i * 0.0001)
            alt = 100 + (i * 10 if is_vertical else 50)

            file_name = f"flight_takeoff_{i:03d}.jpg"
            s3_key = f"dtm-data/projects/{project_id}/user-uploads/{file_name}"
            hash_md5 = hashlib.md5(file_name.encode("utf-8")).hexdigest()

            exif_data = json.dumps(
                {
                    "AbsoluteAltitude": str(alt),
                    "DateTimeOriginal": ts.strftime("%Y:%m:%d %H:%M:%S"),
                }
            )

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
                        ST_SetSRID(ST_MakePoint(115.46, %(lat)s), 4326),
                        %(uploaded_by)s,
                        'assigned',
                        %(uploaded_at)s,
                        %(exif)s
                    )
                    """,
                {
                    "project_id": project_id,
                    "filename": file_name,
                    "s3_key": s3_key,
                    "hash_md5": hash_md5,
                    "batch_id": batch_id,
                    "task_id": task_id,
                    "lat": lat,
                    "uploaded_by": auth_user.id,
                    "uploaded_at": ts,
                    "exif": exif_data,
                },
            )
        await db.commit()

        await mark_and_remove_flight_tail_imagery(db, project_id, batch_id, task_id)

        async with db.cursor() as cur:
            await cur.execute(
                "SELECT count(*) FROM project_images WHERE status = 'rejected' AND rejection_reason ILIKE 'Flight tail detection:%%'"
            )
            assert (await cur.fetchone())[0] >= 6


@pytest.mark.asyncio
async def test_multi_batch_rejections(db, create_test_project, auth_user):
    """Verifies that in a batch with multiple segments tails are caught for each flight segment."""
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

    # Creating two different flight segments separated by a 2 hour gap.
    segments = [
        {"start": now, "label": "flight_A"},
        {"start": now + timedelta(hours=2), "label": "flight_B"},
    ]

    async with db.cursor() as cur:
        for seg in segments:
            for i in range(60):
                ts = seg["start"] + timedelta(seconds=i * 2)

                # Creating a path:
                # 0-3: Vertical and moving up in altitude
                # 4-8: Moving NORTH (azimuth 0)
                # 9: Mission moving EAST (azimuth 90)

                is_vertical = i < 4
                is_transit = 4 <= i < 9

                if is_vertical:
                    lat, lon = -8.301, 115.46
                    alt = 100 + (i * 10)
                elif is_transit:
                    lat, lon = -8.301 + (i * 0.0002), 115.46
                    alt = 200
                else:
                    lat, lon = -8.301 + (8 * 0.0002), 115.46 + ((i - 8) * 0.0002)
                    alt = 200

                file_name = f"{seg['label']}_{i:03d}.jpg"
                s3_key = f"dtm-data/projects/{project_id}/user-uploads/{file_name}"
                hash_md5 = hashlib.md5(file_name.encode("utf-8")).hexdigest()

                exif_data = json.dumps(
                    {
                        "DateTimeOriginal": ts.strftime("%Y:%m:%d %H:%M:%S"),
                        "AbsoluteAltitude": str(alt),
                    }
                )

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
                        ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                        %(uploaded_by)s,
                        'assigned',
                        %(uploaded_at)s,
                        %(exif)s
                    )
                    """,
                    {
                        "project_id": project_id,
                        "filename": file_name,
                        "s3_key": s3_key,
                        "hash_md5": hash_md5,
                        "batch_id": batch_id,
                        "task_id": task_id,
                        "lon": lon,
                        "lat": lat,
                        "uploaded_by": auth_user.id,
                        "uploaded_at": ts,
                        "exif": exif_data,
                    },
                )
    await db.commit()

    await mark_and_remove_flight_tail_imagery(db, project_id, batch_id, task_id)
    await db.commit()

    # Verify rejection occurs in both flight segments
    async with db.cursor() as cur:
        # Check Flight A rejections.
        await cur.execute(
            "SELECT COUNT(*) FROM project_images WHERE status = 'rejected' AND filename LIKE 'flight_A%%'"
        )
        assert (await cur.fetchone())[0] >= 5

        # Check Flight B rejections.
        await cur.execute(
            "SELECT COUNT(*) FROM project_images WHERE status = 'rejected' AND filename LIKE 'flight_B%%'"
        )
        assert (await cur.fetchone())[0] >= 5
