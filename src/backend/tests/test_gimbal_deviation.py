"""Tests for per-pass gimbal deviation rejection."""

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import shapely.wkb as wkblib
from app.images.exif_values import pitch_from_row, resolve_gimbal_pitch
from app.images.flight_gimbal_deviation import (
    _acceptable_angles,
    _dominant_angles,
    _is_off_axis,
    mark_and_remove_off_axis_imagery,
)
from shapely.geometry import box


def _rejected(pitches, seeds=()):
    """Count frames a pass of these pitches would lose, as the detector would."""
    if not _dominant_angles(pitches):
        return len(pitches)
    accepted = _acceptable_angles(pitches, list(seeds))
    return sum(1 for pitch in pitches if _is_off_axis(pitch, accepted))


def test_held_angle_is_measured_not_assumed():
    assert _dominant_angles([-80.0] * 20) == [-80.0]
    assert _rejected([-80.0] * 20) == 0


def test_two_held_angles_are_both_kept():
    assert _dominant_angles([-80.0] * 20 + [-45.0] * 20) == [-80.0, -45.0]
    assert _rejected([-80.0] * 20 + [-45.0] * 20) == 0


@pytest.mark.parametrize("centre", [-80.0, -79.0, -78.6, -77.0])
def test_held_angle_survives_wherever_it_falls(centre):
    """Clustering on gaps, not fixed bins, so no angle straddles a boundary."""
    assert _rejected([centre, centre + 0.4] * 5) == 0


def test_short_deliberate_leg_is_kept_when_planned():
    """A 4-frame leg is too short to measure, but the plan vouches for it."""
    assert _rejected([-80.0] * 40 + [-45.0] * 4) == 4
    assert _rejected([-80.0] * 40 + [-45.0] * 4, seeds=(-45.0,)) == 0


def test_planned_angle_nothing_flew_near_opens_no_band():
    """A declared but unflown angle must not widen what the pass accepts."""
    assert _acceptable_angles([-80.0] * 30, [-80.0, -45.0]) == [-80.0]


def test_sweep_is_still_detected_when_the_project_declares_angles():
    """Seeds vouch for legs; they must not vouch for a gimbal that never settled."""
    sweep = [-80.0 + 0.5 * i for i in range(121)]
    assert _dominant_angles(sweep) == []
    assert _rejected(sweep, seeds=(-80.0, -45.0)) == len(sweep)


def test_angles_alternating_frame_by_frame_are_both_kept():
    """Oscillation is not travel, so a dual-angle pattern survives unaided."""
    alternating = [-80.0 if i % 2 == 0 else -45.0 for i in range(60)]
    assert _dominant_angles(alternating) == [-80.0, -45.0]
    assert _rejected(alternating) == 0


def test_transition_between_two_legs_does_not_swallow_them():
    """A continuous sweep must not chain both held angles into one mid cluster."""
    pitches = [-80.0] * 50 + [-79.5 + 0.5 * i for i in range(69)] + [-45.0] * 50
    assert _dominant_angles(pitches) == [-80.0, -45.0]
    rejected = [p for p in pitches if _is_off_axis(p, [-80.0, -45.0])]
    assert -80.0 not in rejected and -45.0 not in rejected
    assert 0 < len(rejected) < len(pitches)


def test_slow_sweep_is_rejected_despite_long_runs():
    """A 1 deg/frame sweep holds no angle, however many frames it spans."""
    assert _dominant_angles([-80.0 + i for i in range(61)]) == []
    assert _rejected([-80.0 + i for i in range(61)]) == 61


@pytest.mark.parametrize("step", [2.5, 1.0, 0.5, 0.2, 0.15, 0.1, 0.05])
def test_slow_sweep_is_caught_however_finely_sampled(step):
    """Travel is judged by direction, so the capture interval cannot hide a sweep."""
    creep = [-80.0 + step * i for i in range(int(60 / step) + 1)]
    assert _rejected(creep) == len(creep)


@pytest.mark.parametrize("step", [2.5, 0.5, 0.15, 0.1, 0.05])
def test_transition_never_swallows_the_legs_it_joins(step):
    """However slow the slew, both held angles must survive it."""
    ramp = [-80.0 + step * (i + 1) for i in range(int(35 / step) - 1)]
    pitches = [-80.0] * 50 + ramp + [-45.0] * 50
    assert _dominant_angles(pitches) == [-80.0, -45.0]
    rejected = [p for p in pitches if _is_off_axis(p, [-80.0, -45.0])]
    assert -80.0 not in rejected and -45.0 not in rejected
    assert 0 < len(rejected) < len(pitches)


def test_sweep_after_a_nadir_pass_is_rejected():
    pitches = [-80.0] * 30 + [-57.9 + 2.5 * i for i in range(24)]
    assert _dominant_angles(pitches) == [-80.0]
    assert _rejected(pitches) == 24


def test_short_leg_at_a_second_angle_survives_a_long_pass():
    """A brief oblique leg must not be swamped by a much longer nadir pass."""
    assert _rejected([-80.0] * 500 + [-45.0] * 40) == 0


def test_stabilisation_jitter_is_not_off_axis():
    assert _rejected([-80.0 + (i % 7 - 3) * 0.1 for i in range(30)]) == 0


def test_pitch_resolution_matches_the_classifier():
    """UserComment metadata must be read the same way in both detectors."""
    assert pitch_from_row({"gimbal_pitch_raw": "-80.0"}) == -80.0
    assert pitch_from_row({"gimbal_pitch_raw": "0.0", "pitch_raw": "-90.0"}) == 0.0
    assert pitch_from_row({"user_comment": json.dumps({"pitch": -45.0})}) == -45.0
    assert pitch_from_row({"gimbal_pitch_raw": "", "pitch_raw": "-90.0"}) == -90.0
    assert pitch_from_row({"user_comment": "not json at all"}) is None
    assert pitch_from_row({}) is None


@pytest.mark.parametrize(
    "data,expected",
    [
        # 0.0 is a real reading (camera level with the horizon), not "absent".
        ({"GimbalPitchDegree": 0.0, "pitch": -90.0}, 0.0),
        ({"GimbalPitchDegree": "+0.00", "pitch": -90.0}, "+0.00"),
        ({"GimbalPitchDegree": None, "pitch": -90.0}, -90.0),
        ({"GimbalPitchDegree": "", "pitch": -90.0}, -90.0),
        ({"pitch": -45.0}, -45.0),
        ({}, None),
    ],
)
def test_gimbal_pitch_resolution(data, expected):
    assert resolve_gimbal_pitch(data) == expected


async def _insert_task(db, project_id, task_id):
    outline_wkb = wkblib.dumps(box(115.4, -8.4, 115.6, -8.2), hex=True)
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, project_id, 1, outline_wkb),
        )


async def _insert_frames(db, project_id, batch_id, task_id, auth_user, frames):
    """frames: list of (label, pitch, serial, seconds_offset)."""
    base_ts = datetime(2026, 8, 4, 11, 0, 0, tzinfo=timezone.utc)
    async with db.cursor() as cur:
        for label, pitch, serial, offset in frames:
            filename = f"{label}.jpg"
            captured = base_ts + timedelta(seconds=offset)
            exif = {
                "DateTimeOriginal": captured.strftime("%Y:%m:%d %H:%M:%S"),
                "GimbalPitchDegree": pitch,
                "CameraSerialNumber": serial,
            }
            await cur.execute(
                """
                INSERT INTO project_images (
                    project_id, filename, s3_key, hash_md5, batch_id, task_id,
                    location, exif, uploaded_by, status, uploaded_at
                )
                VALUES (
                    %(project_id)s, %(filename)s, %(s3_key)s, %(hash_md5)s,
                    %(batch_id)s, %(task_id)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                    %(exif)s, %(uploaded_by)s, 'assigned', %(uploaded_at)s
                )
                """,
                {
                    "project_id": str(project_id),
                    "filename": filename,
                    "s3_key": f"projects/{project_id}/user-uploads/{filename}",
                    "hash_md5": hashlib.md5(filename.encode("utf-8")).hexdigest(),
                    "batch_id": str(batch_id),
                    "task_id": str(task_id),
                    # ~2m apart per frame, well inside the segment-break limits
                    "lon": 115.45 + offset * 0.00002,
                    "lat": -8.37,
                    "exif": json.dumps(exif),
                    "uploaded_by": auth_user.id,
                    "uploaded_at": captured,
                },
            )
    await db.commit()


async def _rejected_filenames(db, project_id, batch_id):
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT filename
            FROM project_images
            WHERE project_id = %(project_id)s
              AND batch_id = %(batch_id)s
              AND status = 'rejected'
              AND rejection_reason ILIKE 'Off-axis frame:%%'
            ORDER BY filename
            """,
            {"project_id": str(project_id), "batch_id": str(batch_id)},
        )
        return [row[0] for row in await cur.fetchall()]


@pytest.mark.asyncio
async def test_gimbal_sweep_rejected_nadir_pass_kept(
    db, create_test_project, auth_user
):
    """A climb-out gimbal sweep is rejected; the nadir pass it precedes is not."""
    project_id = uuid.UUID(create_test_project)
    batch_id, task_id = uuid.uuid4(), uuid.uuid4()
    await _insert_task(db, project_id, task_id)

    frames = [(f"sweep_{i:02d}", -57.9 + 2.5 * i, "AAA", i * 2) for i in range(24)]
    frames += [(f"nadir_{i:02d}", -80.0, "AAA", 60 + i * 2) for i in range(30)]
    await _insert_frames(db, project_id, batch_id, task_id, auth_user, frames)

    await mark_and_remove_off_axis_imagery(
        db, project_id, batch_id, task_id, enforce=True
    )
    await db.commit()

    rejected = await _rejected_filenames(db, project_id, batch_id)
    assert len(rejected) == 24
    assert all(name.startswith("sweep_") for name in rejected)


@pytest.mark.asyncio
async def test_two_gimbal_angles_both_kept_transition_rejected(
    db, create_test_project, auth_user
):
    """A project flown at -80 and -45 keeps both passes, drops the sweep between."""
    project_id = uuid.UUID(create_test_project)
    batch_id, task_id = uuid.uuid4(), uuid.uuid4()
    await _insert_task(db, project_id, task_id)

    async with db.cursor() as cur:
        await cur.execute(
            "UPDATE projects SET gimble_angles_degrees = %s WHERE id = %s",
            ([-80, -45], str(project_id)),
        )

    frames = [(f"nadir_{i:02d}", -80.0, "AAA", i * 2) for i in range(30)]
    frames += [
        (f"trans_{i:02d}", -77.5 + 2.5 * i, "AAA", 60 + i * 2) for i in range(13)
    ]
    frames += [(f"obliq_{i:02d}", -45.0, "AAA", 90 + i * 2) for i in range(30)]
    await _insert_frames(db, project_id, batch_id, task_id, auth_user, frames)

    await mark_and_remove_off_axis_imagery(
        db, project_id, batch_id, task_id, enforce=True
    )
    await db.commit()

    rejected = await _rejected_filenames(db, project_id, batch_id)
    assert all(name.startswith("trans_") for name in rejected)
    # Frames within tolerance of a planned angle are kept; the mid-sweep ones are not.
    assert {f"trans_{i:02d}.jpg" for i in range(4, 9)} <= set(rejected)


@pytest.mark.asyncio
async def test_concurrent_aircraft_not_falsely_rejected(
    db, create_test_project, auth_user
):
    """Two drones flying one task at different angles must not contaminate each other."""
    project_id = uuid.UUID(create_test_project)
    batch_id, task_id = uuid.uuid4(), uuid.uuid4()
    await _insert_task(db, project_id, task_id)

    # Interleaved in time: without partitioning by camera body every frame would
    # look like a sweep between -80 and -45.
    frames = []
    for i in range(30):
        frames.append((f"a_{i:02d}", -80.0, "AAA", i * 2))
        frames.append((f"b_{i:02d}", -45.0, "BBB", i * 2 + 1))
    await _insert_frames(db, project_id, batch_id, task_id, auth_user, frames)

    await mark_and_remove_off_axis_imagery(
        db, project_id, batch_id, task_id, enforce=True
    )
    await db.commit()

    assert await _rejected_filenames(db, project_id, batch_id) == []


@pytest.mark.asyncio
async def test_write_scope_and_shadow_mode(db, create_test_project, auth_user):
    """Only in-scope ids are rejected, and shadow mode writes nothing at all."""
    project_id = uuid.UUID(create_test_project)
    batch_id, task_id = uuid.uuid4(), uuid.uuid4()
    await _insert_task(db, project_id, task_id)

    frames = [(f"nadir_{i:02d}", -80.0, "AAA", i * 2) for i in range(30)]
    frames += [
        (f"sweep_{i:02d}", -57.9 + 2.5 * i, "AAA", 60 + i * 2) for i in range(24)
    ]
    await _insert_frames(db, project_id, batch_id, task_id, auth_user, frames)

    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT id, filename FROM project_images
            WHERE project_id = %s AND batch_id = %s AND filename LIKE 'sweep_%%'
            ORDER BY filename
            """,
            (str(project_id), str(batch_id)),
        )
        sweeps = await cur.fetchall()

    # Callers pass stringified ids, as the classifier returns them.
    in_scope = [str(row[0]) for row in sweeps[:10]]
    out_of_scope = {row[1] for row in sweeps[10:]}

    # Shadow mode must not touch anything, even for in-scope ids.
    await mark_and_remove_off_axis_imagery(
        db, project_id, batch_id, task_id, image_ids=in_scope, enforce=False
    )
    await db.commit()
    assert await _rejected_filenames(db, project_id, batch_id) == []

    await mark_and_remove_off_axis_imagery(
        db, project_id, batch_id, task_id, image_ids=in_scope, enforce=True
    )
    await db.commit()

    rejected = set(await _rejected_filenames(db, project_id, batch_id))
    assert len(rejected) == 10
    assert rejected == {row[1] for row in sweeps[:10]}
    assert not (rejected & out_of_scope)
