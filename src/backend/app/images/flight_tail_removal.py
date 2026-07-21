from uuid import UUID
from datetime import datetime, timezone


from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

from app.models.enums import ImageStatus

'''
def _confirm_stable_heading(project_list: list, image_index: int, steps: int) -> bool:
    """
    Confirms if a suspected change in the flight trajectory is sustained.

    Inspects a 5-image look-ahead or look-behind window to confirm the drone has committed to a new stable direction
    within a 10-degree tolerance.

    Args:
        project_list: List of project images
        image_index: The starting index of the suspected turn
        steps: Direction of search (1: Forward, -1: Backwards)

    Returns:
        bool: True if the path is stable, False if otherwise.
    """
    # Optional robustness: some callers attach per-row flags/metrics.
    MIN_DISTANCE_METERS = 5.0
    set_image_azimuth = project_list[image_index]["azimuth"]
    list_length = len(project_list)

    if steps > 0:
        # Look forward in the flight mission
        bound = min(image_index + 6, list_length)
        for i in range(image_index + 1, bound, steps):
            if project_list[i].get("distance_moved", 9999) < MIN_DISTANCE_METERS:
                continue
            if project_list[i].get("vertical_candidate"):
                continue
            next_image_azimuth = project_list[i]["azimuth"]
            azimuth_difference = calculate_angular_difference(
                set_image_azimuth, next_image_azimuth
            )
            if azimuth_difference > 10:
                return False
        return True

    else:
        # Look backwards and "into" the flight mission from the landing waypoint
        bound = max(image_index - 6, -1)
        for i in range(image_index - 1, bound, steps):
            if project_list[i].get("distance_moved", 9999) < MIN_DISTANCE_METERS:
                continue
            if project_list[i].get("vertical_candidate"):
                continue
            next_image_azimuth = project_list[i]["azimuth"]
            azimuth_difference = calculate_angular_difference(
                set_image_azimuth, next_image_azimuth
            )
            if azimuth_difference > 10:
                return False
        return True
'''


def _find_main_axis(flight_segment_images, field="yaw_deg"):
    """
    Follows same logic from 'find_axis' suggested flight tail removal focused on 'FlightYawDegree' to find
    main axis/baseline for flight segment.
    """
    # Count up flight headings, treating 180-degree rotations as equivalent
    photos_by_heading = [[] for h in range(180)]
    for image in flight_segment_images:
        # Check if yaw_deg exists
        if image[field] is None:
            continue
        heading = int(image[field] % 180)
        photos_by_heading[heading].append(image)

    # Find the 10-degree sector where most flight headings fall
    best_h, max_count = None, 0
    for h in range(180):
        count_in_sector = sum(len(photos_by_heading[i % 180]) for i in range(h, h + 10))
        if count_in_sector > max_count:
            best_h, max_count = h, count_in_sector

    # Collect all the photos with headings within that 10-degree sector
    aligned_photos = []
    for i in range(best_h, best_h + 10):
        aligned_photos += photos_by_heading[i % 180]

    # These headings are all between best_h and best_h + 10, so subtracting
    # best_h makes them safe to average (all positive, no discontinuity).
    aligned_headings = [(p[field] - best_h) % 180 for p in aligned_photos]

    assert all(0 <= h <= 10 for h in aligned_headings)
    average_heading = sum(aligned_headings) / len(aligned_headings)

    return (best_h + average_heading) % 180


async def _flag_flight_tail_images(
    db: Connection, project_list: list, flight_tail_list: list
) -> None:
    """
    Updates the status of identified flight tail images to REJECTED with a specified comment.
    """
    if not flight_tail_list:
        return None

    flight_tails_ids = [project_list[i]["id"] for i in flight_tail_list]

    params = {
        "status": ImageStatus.REJECTED.value,
        "reason": "Flight tail detection: Image identified as flightplan transit (takeoff/landing tail).",
        "time": datetime.now(timezone.utc),
        "ids": flight_tails_ids,
    }

    # Tail detection is intentionally low precedence: it should never overwrite an earlier
    # quality/metadata rejection reason. Only touch rows that are still "clean".
    sql = """
    UPDATE project_images
    SET status = %(status)s,
        rejection_reason = %(reason)s,
        classified_at = %(time)s
    WHERE id = ANY(%(ids)s)
      AND status = 'assigned'
      AND rejection_reason IS NULL
    """

    async with db.cursor() as cur:
        await cur.execute(sql, params)


async def mark_and_remove_flight_tail_imagery(
    db: Connection, project_id: UUID, batch_id: UUID | None, task_id: UUID
) -> None:
    """
    Identifies and flags flight tail imagery taken during takeoff and landing to prevent photogrammetric distortion.

    This function inspects the transit phases of a flight trajectory by analyzing FlightYawDegree between consecutive
    images to identify potential flightplan tails.

    Args:
        db: Database connection
        project_id: Project ID
        batch_id: Batch ID (None to process images without a batch)
        task_id: Task ID

    Returns:
        None. Updates the status of identified tail images to ImageStatus.REJECTED in the database.
    """
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

    sql = f"""
        WITH ordered AS (
            SELECT
                id,
                location,
                uploaded_at,
                COALESCE(
                    to_timestamp(exif->>'DateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')::timestamptz,
                    uploaded_at
                ) AS sort_ts,
                NULLIF(exif->>'FlightYawDegree', '')::double precision AS yaw_deg,
                NULLIF(exif->>'GimbalPitchDegree', '')::double precision AS gimbal_pitch_deg,
                NULLIF(regexp_replace(COALESCE(exif->>'AbsoluteAltitude',''), '[^0-9+\\-.]+', '', 'g'), '')::double precision AS altitude_m
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
                id,
                location,
                uploaded_at,
                sort_ts,
                yaw_deg,
                gimbal_pitch_deg,
                altitude_m,
                LAG(sort_ts, 1, sort_ts) OVER (ORDER BY sort_ts ASC) AS prev_sort_ts,
                LAG(location, 1, location) OVER (ORDER BY sort_ts ASC) AS prev_location,
                LAG(yaw_deg, 1, yaw_deg) OVER (ORDER BY sort_ts ASC) AS prev_yaw_deg,
                LAG(altitude_m, 1, altitude_m) OVER (ORDER BY sort_ts ASC) AS prev_altitude_m
            FROM ordered
        ),
        segmented AS (
            SELECT
                id,
                location,
                uploaded_at,
                sort_ts,
                yaw_deg,
                gimbal_pitch_deg,
                altitude_m,
                prev_sort_ts,
                prev_location,
                prev_yaw_deg,
                prev_altitude_m,
                ST_Distance(prev_location::geography, location::geography) AS step_m,
                GREATEST(EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)), 0) AS step_s,
                SUM(
                    CASE
                        WHEN EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)) > 600 THEN 1
                        WHEN ST_Distance(prev_location::geography, location::geography) > 1000 THEN 1
                        WHEN GREATEST(EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)), 0) > 0
                             AND (ST_Distance(prev_location::geography, location::geography) /
                                  GREATEST(EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)), 0)) > 50
                          THEN 1
                        ELSE 0
                    END
                ) OVER (ORDER BY sort_ts ASC) AS segment_id
            FROM base
        ),
        trajectory_data AS (
            SELECT
                id,
                uploaded_at,
                sort_ts,
                segment_id,
                yaw_deg,
                gimbal_pitch_deg,
                altitude_m,
                LAG(sort_ts, 1, sort_ts) OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) AS previous_sort_ts,
                LAG(location, 1, location) OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) AS previous_location,
                LAG(yaw_deg, 1, yaw_deg) OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) AS previous_yaw_deg,
                LAG(altitude_m, 1, altitude_m) OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) AS previous_altitude_m,
                location,
                ROW_NUMBER() OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) as row_num
            FROM segmented
        )
        SELECT
            id,
            uploaded_at,
            sort_ts,
            previous_sort_ts,
            segment_id,
            row_num,
            CASE
                WHEN row_num = 1 THEN NULL
                ELSE ST_Distance(previous_location::geography, location::geography)
            END AS distance_moved,
            yaw_deg,
            previous_yaw_deg,
            gimbal_pitch_deg
            altitude_m,
            previous_altitude_m
        FROM trajectory_data
        ORDER BY sort_ts ASC;
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        project_image_results = await cur.fetchall()

    log.info(
        f"Tail detection for task {task_id}: "
        f"Found {len(project_image_results)} assigned images with valid GPS"
    )

    # Group by segment
    segments_map: dict[int, list[dict]] = {}
    for row in project_image_results:
        seg_id = int(row.get("segment_id") or 0)
        segments_map.setdefault(seg_id, []).append(row)
    segments = list(segments_map.values())

    log.info(
        f"Tail detection for task {task_id}: "
        f"Split into {len(segments)} time-contiguous segments"
    )

    ALT_RATE_THRESHOLD_MPS = 2.0
    LOW_LATERAL_FOR_VERTICAL_METERS = 10.0
    MAX_TAIL_FRACTION = 0.25
    MIN_SEGMENT_SIZE = 10
    MIN_SEARCH_IMAGES = 30  # Minimum images to search for tails

    for idx, segment in enumerate(segments):
        log.debug(
            f"Segment {idx}: {len(segment)} images, "
            f"time range: {segment[0]['sort_ts']} to {segment[-1]['sort_ts']}"
        )
        segment_length = len(segment)

        # Skip small segments entirely - they're too short for reliable tail detection
        if segment_length < MIN_SEGMENT_SIZE:
            log.debug(
                f"Skipping tail detection for segment with {segment_length} images "
                f"(minimum required: {MIN_SEGMENT_SIZE})"
            )
            continue

        # Find global mission axis for the flight segment based on yaw_deg
        global_mission_axis = _find_main_axis(segment, "yaw_deg")

        # Mark vertical candidates
        for i, row in enumerate(segment):
            row["vertical_candidate"] = False
            # Skip first image (no previous data)
            if i == 0:
                continue

            alt = row.get("altitude_m")
            prev_alt = row.get("previous_altitude_m")
            ts = row.get("sort_ts")
            prev_ts = row.get("previous_sort_ts")
            dist = float(row.get("distance_moved") or 0.0)

            if alt is None or prev_alt is None or ts is None or prev_ts is None:
                continue
            try:
                dt = (ts - prev_ts).total_seconds()
                if dt <= 0:
                    continue
                alt_rate = abs(float(alt) - float(prev_alt)) / dt
                if (
                    alt_rate >= ALT_RATE_THRESHOLD_MPS
                    and dist <= LOW_LATERAL_FOR_VERTICAL_METERS
                ):
                    row["vertical_candidate"] = True
            except Exception:
                continue

        # Determine search limits - search fewer images for tail detection
        search_limit = min(
            MIN_SEARCH_IMAGES, segment_length // 4
        )  # Search max 25% of segment

        takeoff_tails_indices = []
        landing_tails_indices = []

        takeoff_aligned_with_mission_counter = 0
        for i in range(search_limit):
            image_yaw_to = segment[i].get("yaw_deg")
            image_gimbal_to = segment[i].get("gimbal_pitch_deg")
            image_vertical_to = segment[i].get("vertical_candidate")

            # Skip none values
            if image_yaw_to is None:
                continue

            # Check gimbal pitch and if vertical candidate
            if (image_gimbal_to == 0) or (image_vertical_to is True):
                takeoff_aligned_with_mission_counter = 0
                takeoff_tails_indices.append(i)
                continue

            # Compare if current yaw degree is aligned with mission axis within 5 degrees
            yaw_diff_to = abs((image_yaw_to % 180) - global_mission_axis)
            yaw_aligned_to = min(yaw_diff_to, 180 - yaw_diff_to) < 5

            # Check yaw alignment
            if yaw_aligned_to:
                takeoff_aligned_with_mission_counter += 1
            else:
                takeoff_aligned_with_mission_counter = 0
                takeoff_tails_indices.append(i)

            # Check at least 3 photos are within the mission-axis dimensions
            if takeoff_aligned_with_mission_counter >= 3:
                break

        # LANDING DETECTION (similar logic, working backwards)
        landing_search_start = segment_length - 1
        landing_search_end = max(segment_length - search_limit, 0)

        landing_aligned_with_mission_counter = 0
        for i in range(landing_search_start, landing_search_end, -1):
            image_yaw_land = segment[i].get("yaw_deg")
            image_gimbal_land = segment[i].get("gimbal_pitch_deg")
            image_vertical_land = segment[i].get("vertical_candidate")

            # Skip none values
            if image_yaw_land is None:
                continue

            # Check gimbal pitch and if vertical candidate
            if (image_gimbal_land == 0) or (image_vertical_land is True):
                landing_aligned_with_mission_counter = 0
                landing_tails_indices.append(i)
                continue

            # Compare if current yaw degree is aligned with mission axis within 5 degrees
            yaw_diff_land = abs((image_yaw_land % 180) - global_mission_axis)
            yaw_aligned_land = min(yaw_diff_land, 180 - yaw_diff_land) < 5

            # Check yaw alignment
            if yaw_aligned_land:
                landing_aligned_with_mission_counter += 1
            else:
                landing_aligned_with_mission_counter = 0
                landing_tails_indices.append(i)

            # Check at least 3 photos are within the mission-axis dimensions
            if landing_aligned_with_mission_counter >= 3:
                break

        # Apply safety checks
        all_tail_indices = takeoff_tails_indices + landing_tails_indices
        print(f"Mission Axis: {global_mission_axis}")
        print(f"Total tails found: {len(all_tail_indices)}")
        if all_tail_indices:
            tail_fraction = len(all_tail_indices) / segment_length
            if tail_fraction <= MAX_TAIL_FRACTION:
                log.info(
                    f"Detected {len(all_tail_indices)} tail images "
                    f"({tail_fraction:.1%} of segment): "
                    f"takeoff={len(takeoff_tails_indices)}, landing={len(landing_tails_indices)}"
                )
                await _flag_flight_tail_images(db, segment, all_tail_indices)
            else:
                log.warning(
                    f"Skipping tail flagging: {tail_fraction:.1%} exceeds safety threshold "
                    f"of {MAX_TAIL_FRACTION:.1%}"
                )
