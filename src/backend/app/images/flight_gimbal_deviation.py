"""Reject frames whose gimbal pitch does not match their own flight pass.

The gimbal holds its commanded angle for the length of a pass, so the angles a
pass was actually flown at are recoverable from the histogram of its pitch
values, but only where the camera was actually still: a held angle shows no
travel across its neighbouring frames, while a sweep drifts however finely it
is sampled. Frames are judged against those measured angles rather than a fixed
threshold, so a project flown at several angles stays supported.

This check is deliberately relative, so it cannot judge an angle the whole
pass was flown at: a leg held steadily at the horizon reads as a legitimate
dominant angle here. QualityThresholds.max_gimbal_pitch_deg is what covers
that, rejecting any frame above its ceiling before this pass runs. The two
divide the range between them - the classifier owns the absolute limit, this
owns everything below it, relative to what the flight actually did.

Known limits:
  - Frames whose EXIF carries no camera serial are treated as one aircraft, so
    concurrent drones lacking that tag can still contaminate a pass.
  - A slew under STABLE_SPAN_DEG across the whole window reads as still. That
    is roughly 0.02 deg/frame, an hour of continuous travel at survey intervals.
  - A segment under MIN_PASS_SIZE frames is skipped, so a short top-up flight
    after a battery swap is judged by the classifier ceiling alone.
"""

from itertools import pairwise
from statistics import median
from uuid import UUID

from app.images.exif_values import pitch_columns_sql, pitch_from_row
from app.images.flight_segments import (
    PASS_ORDER_SQL,
    camera_serial_sql,
    group_by_pass,
    segment_break_sql,
)
from app.images.image_logic import reject_assigned_images
from app.models.enums import ImageStatus
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

# How far off a held angle a frame may sit before it is off-axis.
MAX_DEVIATION_DEG = 8.0
# Pitch values further apart than this belong to different held angles.
CLUSTER_GAP_DEG = 0.75
# A frame is travelling when the pitch across this many neighbours either side
# moves consistently one way. Testing the direction rather than the size of the
# movement is what makes the check independent of the capture interval.
STABLE_WINDOW = 5
STABLE_SPAN_DEG = 0.4
# Frames a cluster needs before it counts as an angle the gimbal actually held.
MIN_DOMINANT_FRAMES = 6
# Below this a pass is too short to measure held angles from.
MIN_PASS_SIZE = 10

OFF_AXIS_REASON = (
    "Off-axis frame: gimbal pitch is more than "
    f"{MAX_DEVIATION_DEG:.0f} degrees off every angle its flight pass was "
    "flown at (camera tilting or sweeping between passes)."
)
SWEEP_REASON = (
    "Gimbal never settled: the camera was moving throughout this flight pass, "
    "so it holds no usable mapping angle."
)


def _settled_pitches(pitches: list[float]) -> list[float]:
    """Pitches from frames the gimbal was holding still, in capture order.

    A sweep moves the same way frame after frame however finely it is sampled,
    while stabilisation noise reverses. Only a window that both trends one way
    and covers real ground counts as travel.
    """
    settled = []
    for i in range(len(pitches)):
        window = pitches[max(0, i - STABLE_WINDOW) : i + STABLE_WINDOW + 1]
        steps = [b - a for a, b in pairwise(window)]
        trending = all(step >= 0 for step in steps) or all(step <= 0 for step in steps)
        if not (trending and max(window) - min(window) > STABLE_SPAN_DEG):
            settled.append(pitches[i])
    return settled


def _dominant_angles(pitches: list[float]) -> list[float]:
    """Angles the gimbal held long enough to be deliberate, in ascending order.

    Measured from the imagery alone, so an empty result means the gimbal never
    settled. Only settled frames vote, which stops a transition between two
    real angles chaining them into one cluster straddling both; clustering the
    survivors on value gaps then keeps a jittering angle whole wherever it
    happens to fall.
    """
    angles: list[float] = []
    cluster: list[float] = []
    for pitch in sorted(_settled_pitches(pitches)):
        if cluster and pitch - cluster[-1] > CLUSTER_GAP_DEG:
            if len(cluster) >= MIN_DOMINANT_FRAMES:
                angles.append(median(cluster))
            cluster = []
        cluster.append(pitch)
    if len(cluster) >= MIN_DOMINANT_FRAMES:
        angles.append(median(cluster))
    return sorted({round(angle, 2) for angle in angles})


def _is_off_axis(pitch: float, dominant: list[float]) -> bool:
    return all(abs(pitch - angle) > MAX_DEVIATION_DEG for angle in dominant)


def _acceptable_angles(pitches: list[float], planned: list[float]) -> list[float]:
    """Held angles, widened by planned angles the pass actually flew near.

    A planned angle vouches for a leg too short to measure, but only when the
    imagery goes there; otherwise a declared-but-unflown angle would open a
    band of nothing.
    """
    flown = {
        angle
        for angle in planned
        if any(abs(pitch - angle) <= MAX_DEVIATION_DEG for pitch in pitches)
    }
    return sorted(set(_dominant_angles(pitches)) | flown)


async def mark_and_remove_off_axis_imagery(
    db: Connection,
    project_id: UUID,
    batch_id: UUID | None,
    task_id: UUID,
    image_ids: list | None = None,
    enforce: bool = False,
) -> None:
    """Reject frames whose gimbal pitch is off the angle their pass was flown at.

    Args:
        db: Database connection.
        project_id: Project ID.
        batch_id: Batch ID (None to process images without a batch).
        task_id: Task ID.
        image_ids: Only reject these images. Every assigned frame is still read,
            since held angles can only be measured from the whole pass.
        enforce: When false the pass only logs what it would reject.
    """
    params: dict = {
        "project_id": project_id,
        "task_id": task_id,
        "status": ImageStatus.ASSIGNED.value,
    }

    if batch_id is not None:
        batch_filter = "AND batch_id = %(batch_id)s"
        params["batch_id"] = batch_id
    else:
        batch_filter = "AND batch_id IS NULL"

    camera_serial = camera_serial_sql("i")
    pitch_columns = pitch_columns_sql("i")
    segment_break = segment_break_sql(
        "sort_ts", "prev_sort_ts", "location", "prev_location"
    )

    sql = f"""
        WITH ordered AS (
            SELECT
                i.id,
                i.location,
                COALESCE(
                    to_timestamp(i.exif->>'DateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')::timestamptz,
                    i.uploaded_at
                ) AS sort_ts,
                {pitch_columns},
                {camera_serial} AS camera_serial
            FROM project_images i
            WHERE i.project_id = %(project_id)s
              {batch_filter}
              AND i.task_id = %(task_id)s
              AND i.status = %(status)s
              AND i.rejection_reason IS NULL
              AND i.location IS NOT NULL
        ),
        base AS (
            SELECT
                id,
                location,
                sort_ts,
                gimbal_pitch_raw,
                pitch_raw,
                user_comment,
                camera_serial,
                LAG(sort_ts, 1, sort_ts) OVER w AS prev_sort_ts,
                LAG(location, 1, location) OVER w AS prev_location
            FROM ordered
            WINDOW w AS (PARTITION BY camera_serial ORDER BY {PASS_ORDER_SQL})
        )
        SELECT
            id,
            sort_ts,
            gimbal_pitch_raw,
            pitch_raw,
            user_comment,
            camera_serial,
            SUM({segment_break})
                OVER (PARTITION BY camera_serial ORDER BY {PASS_ORDER_SQL}) AS segment_id
        FROM base
        ORDER BY camera_serial ASC, {PASS_ORDER_SQL};
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()

        await cur.execute(
            "SELECT gimble_angles_degrees FROM projects WHERE id = %(project_id)s",
            {"project_id": project_id},
        )
        project = await cur.fetchone()

    planned_angles = [
        float(angle) for angle in (project or {}).get("gimble_angles_degrees") or []
    ]
    # Callers hand back stringified ids; the query returns UUID objects.
    in_scope = {str(i) for i in image_ids} if image_ids is not None else None
    off_axis_ids: list = []
    sweep_ids: list = []

    for flight_pass in group_by_pass(rows):
        frames = []
        for row in flight_pass:
            pitch = pitch_from_row(row)
            if pitch is not None:
                frames.append((row["id"], pitch))
        if len(frames) < MIN_PASS_SIZE:
            continue

        pitches = [pitch for _, pitch in frames]
        held = _dominant_angles(pitches)
        if not held:
            log.warning(
                f"Gimbal check for task {task_id}: pass of {len(frames)} images never "
                f"held a steady gimbal angle"
            )
            sweep_ids.extend(image_id for image_id, _ in frames)
            continue

        accepted = _acceptable_angles(pitches, planned_angles)
        off_axis_ids.extend(
            image_id for image_id, pitch in frames if _is_off_axis(pitch, accepted)
        )

        unplanned = [
            angle
            for angle in held
            if all(
                abs(angle - planned) > MAX_DEVIATION_DEG for planned in planned_angles
            )
        ]
        if planned_angles and unplanned:
            log.warning(
                f"Gimbal check for task {task_id}: pass of {len(frames)} images was "
                f"flown at {unplanned}, which is not among the project's planned "
                f"angles {planned_angles}. Imagery kept for review."
            )

    for candidates, reason in (
        (off_axis_ids, OFF_AXIS_REASON),
        (sweep_ids, SWEEP_REASON),
    ):
        if in_scope is not None:
            candidates = [
                image_id for image_id in candidates if str(image_id) in in_scope
            ]
        if not candidates:
            continue
        log.info(
            f"Gimbal check for task {task_id}: "
            f"{'rejecting' if enforce else 'would reject (shadow mode)'} "
            f"{len(candidates)} of {len(rows)} photos - {reason}"
        )
        if enforce:
            await reject_assigned_images(db, candidates, reason)
