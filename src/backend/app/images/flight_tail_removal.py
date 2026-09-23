import re
from uuid import UUID

import numpy as np
from app.images.exif_values import pitch_columns_sql, pitch_from_row, to_float
from app.images.flight_segments import (
    PASS_ORDER_SQL,
    camera_serial_sql,
    group_by_pass,
    segment_break_sql,
)
from app.images.image_logic import reject_assigned_images
from app.models.enums import ImageStatus
from app.utils import calculate_angular_difference
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

ALT_RATE_THRESHOLD_MPS = 2.0
LOW_LATERAL_FOR_VERTICAL_METERS = 10.0
MAX_TAIL_FRACTION = 0.25
MIN_SEGMENT_SIZE = 10
MIN_SEARCH_IMAGES = 30


def _finite_or_none(value: float | None) -> float | None:
    return value if value is not None and np.isfinite(value) else None


def _parse_altitude(raw) -> float | None:
    """AbsoluteAltitude as metres; exiftool may add a sign or unit suffix."""
    if raw is None:
        return None
    return _finite_or_none(to_float(re.sub(r"[^0-9+\-.]+", "", str(raw))))


def _parse_tail_metadata(row: dict) -> None:
    row["yaw_deg"] = _finite_or_none(to_float(row.get("yaw_raw")))
    row["gimbal_pitch_deg"] = _finite_or_none(pitch_from_row(row))
    row["altitude_m"] = _parse_altitude(row.get("altitude_raw"))


def _angle_diff_axis(yaw_deg: float, axis: float) -> float:
    diff = calculate_angular_difference(yaw_deg, axis)
    return min(diff, 180 - diff)


def _find_main_axis(
    flight_segment_images: list[dict], field: str = "yaw_deg"
) -> float | None:
    """Find the dominant flight axis, treating opposite headings as equivalent."""
    photos_by_heading = [[] for _ in range(180)]
    for image in flight_segment_images:
        if image[field] is None:
            continue
        heading = int(image[field] % 180)
        photos_by_heading[heading].append(image)

    best_h, max_count = 0, 0
    for h in range(180):
        count_in_sector = sum(len(photos_by_heading[i % 180]) for i in range(h, h + 10))
        if count_in_sector > max_count:
            best_h, max_count = h, count_in_sector

    aligned_photos = []
    for i in range(best_h, best_h + 10):
        aligned_photos += photos_by_heading[i % 180]
    if not aligned_photos:
        return None

    # These headings are all between best_h and best_h + 10, so subtracting
    # best_h makes them safe to average (all positive, no discontinuity).
    aligned_headings = [(p[field] - best_h) % 180 for p in aligned_photos]

    assert all(0 <= h <= 10 for h in aligned_headings)
    average_heading = sum(aligned_headings) / len(aligned_headings)

    return (best_h + average_heading) % 180


def _is_already_in_mission(flight_segment_row: dict, median_alt: float):
    """Whether a frame shows the aircraft established on its mission."""
    image_alt = flight_segment_row.get("altitude_m")
    image_gimbal = flight_segment_row.get("gimbal_pitch_deg")
    image_vertical = flight_segment_row.get("vertical_candidate")

    if not flight_segment_row:
        return False

    if image_vertical:
        return False

    if (
        image_alt is None
        or np.isnan(median_alt)
        or float(image_alt) < (median_alt * 0.85)
    ):
        return False

    return image_gimbal is not None and float(image_gimbal) <= -65.0


def is_aligned_with_axis(yaw_deg: float | None, axis: float) -> bool:
    """Whether yaw aligns with the mission's main or perpendicular axis."""
    if yaw_deg is None:
        return False
    diff_main = _angle_diff_axis(yaw_deg, axis)
    diff_perp = _angle_diff_axis(yaw_deg, axis + 90)

    return min(diff_main, diff_perp) < 18


async def _flag_flight_tail_images(
    db: Connection, project_list: list, flight_tail_list: list
) -> None:
    """Reject identified flight-tail images."""
    if not flight_tail_list:
        return

    flight_tails_ids = [project_list[i]["id"] for i in flight_tail_list]

    await reject_assigned_images(
        db,
        flight_tails_ids,
        "Flight tail detection: Image identified as flightplan transit (takeoff/landing tail).",
    )


def _has_tail_metadata(row: dict) -> bool:
    """Whether a frame carries every value tail classification relies on."""
    return (
        row.get("yaw_deg") is not None
        and row.get("gimbal_pitch_deg") is not None
        and row.get("altitude_m") is not None
    )


def _mark_vertical_candidates(segment: list[dict]) -> None:
    """Flags frames climbing or descending fast with little lateral movement."""
    for i, row in enumerate(segment):
        row["vertical_candidate"] = False
        if i == 0:
            continue

        prev = segment[i - 1]
        alt = row.get("altitude_m")
        prev_alt = prev.get("altitude_m")
        ts = row.get("sort_ts")
        prev_ts = prev.get("sort_ts")
        dist = float(row.get("distance_moved") or 0.0)

        if alt is None or prev_alt is None or ts is None or prev_ts is None:
            continue
        dt = (ts - prev_ts).total_seconds()
        if dt <= 0:
            continue
        alt_rate = abs(alt - prev_alt) / dt
        if (
            alt_rate >= ALT_RATE_THRESHOLD_MPS
            and dist <= LOW_LATERAL_FOR_VERTICAL_METERS
        ):
            row["vertical_candidate"] = True


def _scan_for_tail(
    segment: list[dict], indices, axis: float, median_alt: float
) -> list[int]:
    """
    Walks from one end of the pass until the aircraft is established on the mission.

    A frame missing yaw, gimbal pitch or altitude ends the scan: incomplete
    metadata is not evidence of a tail, so it and everything beyond it is kept.
    """
    tail = []
    for i in indices:
        row = segment[i]
        if not _has_tail_metadata(row):
            log.debug(f"Stopping tail scan at frame {i}: incomplete metadata")
            break

        if _is_already_in_mission(row, median_alt) and is_aligned_with_axis(
            row["yaw_deg"], axis
        ):
            break

        tail.append(i)

    if len(tail) == 1 and _is_already_in_mission(segment[tail[0]], median_alt):
        tail.clear()
    return tail


def _find_pass_tails(segment: list[dict]) -> set[int]:
    """
    Indices of takeoff/landing tail frames within one capture-ordered flight pass.

    Each row needs sort_ts, distance_moved and parsed yaw_deg, gimbal_pitch_deg
    and altitude_m (None where the EXIF value is missing or malformed).
    Returns an empty set when the pass is too short, lacks headings, or the
    detected tails exceed the safety fraction.
    """
    segment_length = len(segment)

    if segment_length < MIN_SEGMENT_SIZE:
        log.debug(
            f"Skipping tail detection for segment with {segment_length} images "
            f"(minimum required: {MIN_SEGMENT_SIZE})"
        )
        return set()

    global_mission_axis = _find_main_axis(segment, "yaw_deg")
    if global_mission_axis is None:
        log.info(
            f"Skipping tail detection for segment with {segment_length} images: "
            f"no FlightYawDegree to derive a mission axis"
        )
        return set()

    altitudes = [
        row["altitude_m"] for row in segment if row.get("altitude_m") is not None
    ]
    median_alt = float(np.median(altitudes)) if altitudes else float("nan")

    _mark_vertical_candidates(segment)

    search_limit = min(MIN_SEARCH_IMAGES, segment_length // 4)

    takeoff_tails_indices = _scan_for_tail(
        segment, range(search_limit), global_mission_axis, median_alt
    )
    landing_tails_indices = _scan_for_tail(
        segment,
        range(segment_length - 1, segment_length - search_limit - 1, -1),
        global_mission_axis,
        median_alt,
    )

    all_tail_indices = set(takeoff_tails_indices + landing_tails_indices)
    log.debug(
        f"Mission axis {global_mission_axis:.1f}: {len(all_tail_indices)} tail candidates"
    )
    if not all_tail_indices:
        return set()

    tail_fraction = len(all_tail_indices) / segment_length
    if tail_fraction > MAX_TAIL_FRACTION:
        log.warning(
            f"Skipping tail flagging: {tail_fraction:.1%} exceeds safety threshold "
            f"of {MAX_TAIL_FRACTION:.1%}"
        )
        return set()

    log.info(
        f"Detected {len(all_tail_indices)} tail images "
        f"({tail_fraction:.1%} of segment): "
        f"takeoff={len(takeoff_tails_indices)}, landing={len(landing_tails_indices)}"
    )
    return all_tail_indices


async def mark_and_remove_flight_tail_imagery(
    db: Connection, project_id: UUID, batch_id: UUID | None, task_id: UUID
) -> None:
    """Reject takeoff and landing transit imagery in one task flight pass."""
    params: dict = {
        "project_id": project_id,
        "task_id": task_id,
        "status": ImageStatus.ASSIGNED.value,
    }

    # Handle NULL batch_id: use IS NULL instead of = to match images
    # that were uploaded without a batch grouping.
    if batch_id is not None:
        batch_filter = "AND batch_id = %(batch_id)s"
        params["batch_id"] = batch_id
    else:
        batch_filter = "AND batch_id IS NULL"

    camera_serial = camera_serial_sql()
    pitch_columns = pitch_columns_sql()
    segment_break = segment_break_sql(
        "sort_ts", "prev_sort_ts", "location", "prev_location"
    )

    # EXIF values are selected raw and parsed in Python, so a malformed value
    # makes that frame's reading unavailable instead of failing the query.
    sql = f"""
        WITH ordered AS (
            SELECT
                id,
                location,
                {camera_serial} AS camera_serial,
                COALESCE(
                    to_timestamp(exif->>'DateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')::timestamptz,
                    uploaded_at
                ) AS sort_ts,
                exif->>'FlightYawDegree' AS yaw_raw,
                exif->>'AbsoluteAltitude' AS altitude_raw,
                {pitch_columns}
            FROM project_images
            WHERE project_id = %(project_id)s
              {batch_filter}
              AND task_id = %(task_id)s
              AND status = %(status)s
              AND rejection_reason IS NULL
              AND location IS NOT NULL
        ),
        base AS (
            SELECT
                *,
                LAG(sort_ts, 1, sort_ts) OVER w AS prev_sort_ts,
                LAG(location, 1, location) OVER w AS prev_location
            FROM ordered
            WINDOW w AS (PARTITION BY camera_serial ORDER BY {PASS_ORDER_SQL})
        ),
        segmented AS (
            SELECT
                *,
                SUM({segment_break})
                    OVER (PARTITION BY camera_serial ORDER BY {PASS_ORDER_SQL}) AS segment_id
            FROM base
        ),
        trajectory_data AS (
            SELECT
                *,
                LAG(location, 1, location) OVER w AS previous_location,
                ROW_NUMBER() OVER w as row_num
            FROM segmented
            WINDOW w AS (PARTITION BY camera_serial, segment_id ORDER BY {PASS_ORDER_SQL})
        )
        SELECT
            id,
            sort_ts,
            segment_id,
            CASE
                WHEN row_num = 1 THEN NULL
                ELSE ST_Distance(previous_location::geography, location::geography)
            END AS distance_moved,
            yaw_raw,
            altitude_raw,
            gimbal_pitch_raw,
            pitch_raw,
            user_comment,
            camera_serial
        FROM trajectory_data
        ORDER BY {PASS_ORDER_SQL};
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        project_image_results = await cur.fetchall()

    for row in project_image_results:
        _parse_tail_metadata(row)

    log.info(
        f"Tail detection for task {task_id}: "
        f"Found {len(project_image_results)} assigned images with valid GPS"
    )

    segments = group_by_pass(project_image_results)

    log.info(
        f"Tail detection for task {task_id}: "
        f"Split into {len(segments)} per-aircraft flight passes"
    )

    for idx, segment in enumerate(segments):
        log.debug(
            f"Segment {idx}: {len(segment)} images, "
            f"time range: {segment[0]['sort_ts']} to {segment[-1]['sort_ts']}"
        )
        await _flag_flight_tail_images(db, segment, _find_pass_tails(segment))
