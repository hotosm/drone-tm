import uuid
from datetime import UTC, datetime, timedelta, timezone

import pytest
from app.images import image_logic
from app.models.enums import ImageStatus
from psycopg.types.json import Json


def _exif(**overrides):
    base = {"Make": "DJI", "Model": "FC3582"}
    base.update(overrides)
    return base


def test_prefers_a_tag_that_carries_its_own_offset():
    captured, assumed = image_logic._capture_time_from_exif(
        _exif(
            DateTimeOriginal="2026:04:02 14:30:00",
            OffsetTimeOriginal="+05:45",
        )
    )
    assert captured == datetime(
        2026, 4, 2, 14, 30, tzinfo=timezone(timedelta(hours=5, minutes=45))
    )
    assert assumed is False


def test_gps_time_beats_a_naive_datetimeoriginal():
    captured, assumed = image_logic._capture_time_from_exif(
        _exif(
            DateTimeOriginal="2026:04:02 14:30:00",
            GPSDateTime="2026:04:02 08:45:00+00:00",
        )
    )
    assert captured == datetime(2026, 4, 2, 8, 45, tzinfo=UTC)
    assert assumed is False


def test_a_naive_timestamp_is_read_as_utc_and_says_so():
    captured, assumed = image_logic._capture_time_from_exif(
        _exif(DateTimeOriginal="2026:04:02 14:30:00")
    )
    assert captured == datetime(2026, 4, 2, 14, 30, tzinfo=UTC)
    assert assumed is True


def test_subsecond_precision_parses():
    captured, _ = image_logic._capture_time_from_exif(
        _exif(SubSecDateTimeOriginal="2026:04:02 14:30:00.250+00:00")
    )
    assert captured == datetime(2026, 4, 2, 14, 30, 0, 250000, tzinfo=UTC)


@pytest.mark.parametrize(
    "value", ["0000:00:00 00:00:00", "", "   ", "not a date", None, 12345]
)
def test_unusable_timestamps_are_ignored(value):
    captured, assumed = image_logic._capture_time_from_exif(
        _exif(DateTimeOriginal=value)
    )
    assert captured is None
    assert assumed is False


def test_falls_back_through_the_tag_order():
    captured, _ = image_logic._capture_time_from_exif(
        _exif(DateTimeOriginal="0000:00:00 00:00:00", CreateDate="2026:04:02 09:00:00")
    )
    assert captured == datetime(2026, 4, 2, 9, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("exif", "expected"),
    [
        ({"Make": "DJI", "Model": "FC3582"}, "DJI FC3582"),
        ({"Make": "DJI", "Model": "DJI FC3582"}, "DJI FC3582"),
        ({"Make": "dji", "Model": "DJI FC3582"}, "DJI FC3582"),
        ({"Make": " Hasselblad ", "Model": " L2D-20c "}, "Hasselblad L2D-20c"),
        ({"Model": "FC3582"}, "FC3582"),
        ({"Make": "DJI"}, "DJI"),
        ({}, None),
        ({"Make": "", "Model": ""}, None),
    ],
)
def test_sensor_is_make_plus_model(exif, expected):
    assert image_logic._sensor_from_exif(exif) == expected


async def _add_image(db, project_id, status, exif, *, name="a.jpg"):
    image_id = uuid.uuid4()
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO project_images
                (id, project_id, filename, s3_key, hash_md5, exif, status)
            VALUES (%(id)s, %(project_id)s, %(filename)s, %(key)s, %(hash)s,
                    %(exif)s, %(status)s)
            """,
            {
                "id": image_id,
                "project_id": project_id,
                "filename": name,
                "key": f"projects/{project_id}/{name}",
                "hash": uuid.uuid4().hex,
                "exif": Json(exif) if exif is not None else None,
                "status": status.value,
            },
        )
    await db.commit()
    return image_id


@pytest.mark.asyncio
async def test_only_assigned_images_set_the_acquisition_window(db, create_test_project):
    project_id = create_test_project
    await _add_image(
        db,
        project_id,
        ImageStatus.ASSIGNED,
        {"Make": "DJI", "Model": "FC3582", "GPSDateTime": "2026:04:02 08:00:00+00:00"},
        name="assigned-early.jpg",
    )
    await _add_image(
        db,
        project_id,
        ImageStatus.ASSIGNED,
        {"Make": "DJI", "Model": "FC3582", "GPSDateTime": "2026:04:02 09:30:00+00:00"},
        name="assigned-late.jpg",
    )
    for status, when in (
        (ImageStatus.UPLOADED, "2026:05:20 12:00:00+00:00"),
        (ImageStatus.CLASSIFYING, "2026:05:21 12:00:00+00:00"),
        (ImageStatus.STAGED, "2020:01:01 12:00:00+00:00"),
        (ImageStatus.REJECTED, "2019:01:01 12:00:00+00:00"),
        (ImageStatus.UNMATCHED, "2030:01:01 12:00:00+00:00"),
        (ImageStatus.DUPLICATE, "2031:01:01 12:00:00+00:00"),
    ):
        await _add_image(
            db,
            project_id,
            status,
            {"Make": "Sony", "Model": "ILCE-7RM4", "GPSDateTime": when},
            name=f"{status.value}.jpg",
        )

    capture = await image_logic.get_project_capture_metadata(db, uuid.UUID(project_id))
    assert capture.acquisition_start == datetime(2026, 4, 2, 8, 0, tzinfo=UTC)
    assert capture.acquisition_end == datetime(2026, 4, 2, 9, 30, tzinfo=UTC)
    assert capture.image_count == 2
    assert capture.sensor == "DJI FC3582"
    assert capture.timezone_assumed_count == 0


@pytest.mark.asyncio
async def test_naive_exif_timestamps_are_counted(db, create_test_project):
    project_id = create_test_project
    await _add_image(
        db,
        project_id,
        ImageStatus.ASSIGNED,
        {"Make": "DJI", "Model": "FC3582", "DateTimeOriginal": "2026:04:02 14:30:00"},
        name="naive-1.jpg",
    )
    await _add_image(
        db,
        project_id,
        ImageStatus.ASSIGNED,
        {"Make": "DJI", "Model": "FC3582", "DateTimeOriginal": "2026:04:02 15:00:00"},
        name="naive-2.jpg",
    )
    await _add_image(
        db,
        project_id,
        ImageStatus.ASSIGNED,
        {
            "Make": "DJI",
            "Model": "FC3582",
            "GPSDateTime": "2026:04:02 09:00:00+00:00",
        },
        name="aware.jpg",
    )

    capture = await image_logic.get_project_capture_metadata(db, uuid.UUID(project_id))
    assert capture.timezone_assumed_count == 2
    assert capture.acquisition_start == datetime(2026, 4, 2, 9, 0, tzinfo=UTC)
    assert capture.acquisition_end == datetime(2026, 4, 2, 15, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_a_project_with_no_usable_exif_returns_nothing(db, create_test_project):
    project_id = create_test_project
    await _add_image(
        db,
        project_id,
        ImageStatus.ASSIGNED,
        {"Make": "DJI", "Model": "FC3582"},
        name="no-time.jpg",
    )
    capture = await image_logic.get_project_capture_metadata(db, uuid.UUID(project_id))
    assert capture.acquisition_start is None
    assert capture.acquisition_end is None
    assert capture.sensor == "DJI FC3582"
    assert capture.image_count == 1


@pytest.mark.asyncio
async def test_the_most_common_sensor_wins(db, create_test_project):
    project_id = create_test_project
    for index in range(3):
        await _add_image(
            db,
            project_id,
            ImageStatus.ASSIGNED,
            {"Make": "DJI", "Model": "FC3582"},
            name=f"dji-{index}.jpg",
        )
    await _add_image(
        db,
        project_id,
        ImageStatus.ASSIGNED,
        {"Make": "Sony", "Model": "ILCE-7RM4"},
        name="sony.jpg",
    )
    capture = await image_logic.get_project_capture_metadata(db, uuid.UUID(project_id))
    assert capture.sensor == "DJI FC3582"
