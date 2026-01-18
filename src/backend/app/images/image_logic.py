"""Business logic for project images."""

import functools
import hashlib
import json
import shutil
import tempfile
import math
from typing import Any, Optional
from uuid import UUID
from datetime import datetime, timezone

import exiftool
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.images.image_schemas import ProjectImageCreate, ProjectImageOut
from app.models.enums import ImageStatus


@functools.lru_cache(maxsize=1)
def _exiftool_path() -> str:
    """Return path to `exiftool` binary or raise with a clear message."""
    path = shutil.which("exiftool")
    if not path:
        raise RuntimeError(
            "exiftool binary not found (pyexiftool requires exiftool installed in the container)"
        )
    return path


def _sanitize_string(s: str) -> str:
    """Remove null characters and other problematic characters for PostgreSQL JSONB.

    PostgreSQL's JSONB type cannot store null characters (\\u0000).
    """
    # Remove null characters which PostgreSQL JSONB cannot handle
    return s.replace("\x00", "").replace("\u0000", "")


def _sanitize_exif_value(value: Any) -> Any:
    """Recursively sanitize EXIF values for PostgreSQL JSONB storage.

    Removes null characters from strings and handles nested structures.
    """
    if isinstance(value, str):
        return _sanitize_string(value)
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="ignore")
        except Exception:
            return str(value)

    # Handle tuples (convert to list for JSON)
    if isinstance(value, tuple):
        return [_sanitize_exif_value(item) for item in value]

    # Handle lists
    if isinstance(value, list):
        return [_sanitize_exif_value(item) for item in value]

    # Handle dicts
    if isinstance(value, dict):
        return {k: _sanitize_exif_value(v) for k, v in value.items()}

    return value


def extract_exif_data(
    image_bytes: bytes,
) -> tuple[Optional[dict[str, Any]], Optional[dict[str, float]], Optional[str]]:
    """Extract EXIF data and GPS coordinates from image bytes using exiftool.

    This uses pyexiftool which provides comprehensive metadata extraction,
    including DJI drone-specific XMP data (yaw, pitch, roll, gimbal angles, etc.).

    Args:
        image_bytes: Image file content as bytes

    Returns:
        Tuple of (exif_dict, location_dict, gps_error)
        - exif_dict: All EXIF/XMP data as a dictionary
        - location_dict: GPS coordinates as {"lat": float, "lon": float} or None
        - gps_error: user-facing message when GPS fields exist but are invalid
    """
    try:
        # Fail fast with a clear error if exiftool is missing in the container.
        # (Common in dev if only the host has exiftool installed.)
        _ = _exiftool_path()

        # Write bytes to a temp file since exiftool works with files
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as tmp_file:
            tmp_file.write(image_bytes)
            tmp_file.flush()

            # Extract metadata using exiftool
            with exiftool.ExifToolHelper() as et:
                metadata_list = et.get_metadata(tmp_file.name)

            if not metadata_list:
                log.debug("EXIF extraction returned no metadata (empty list)")
                return None, None, None

            # exiftool returns a list, get first item
            raw_metadata = metadata_list[0]

        # Clean up the metadata - remove SourceFile and sanitize values
        exif_dict = {}
        for key, value in raw_metadata.items():
            # Skip internal exiftool fields
            if key in ("SourceFile", "ExifTool:ExifToolVersion"):
                continue

            # Simplify key names by removing group prefix if desired
            # e.g., "EXIF:Make" -> "Make" or keep full name for clarity
            # We'll keep the simplified name for common fields
            simple_key = key.split(":")[-1] if ":" in key else key

            # Sanitize the value for PostgreSQL JSONB
            exif_dict[simple_key] = _sanitize_exif_value(value)

        # Extract GPS coordinates
        location, gps_error = _extract_gps_from_exif(exif_dict)

        # Log EXIF data for debugging
        log.debug(f"Extracted EXIF data with {len(exif_dict)} tags")
        log.debug(f"EXIF sample: {list(exif_dict.keys())[:10]}")

        # Verify EXIF data is JSON-serializable
        try:
            json.dumps(exif_dict)
        except TypeError as e:
            log.error(f"EXIF data contains non-serializable types: {e}")
            # Find and fix problematic fields
            for key, value in list(exif_dict.items()):
                try:
                    json.dumps({key: value})
                except TypeError:
                    log.warning(f"Removing non-serializable field: {key}")
                    del exif_dict[key]

        return exif_dict, location, gps_error

    except Exception as e:
        # Keep this at debug to avoid noisy logs during batch uploads, but include
        # the full exception for troubleshooting.
        log.opt(exception=True).debug(
            f"EXIF extraction failed: {type(e).__name__}: {e}"
        )
        return None, None, None


def _extract_gps_from_exif(
    exif_dict: dict,
) -> tuple[Optional[dict[str, float]], Optional[str]]:
    """Extract GPS coordinates from exiftool metadata.

    Exiftool provides GPS coordinates in multiple formats. This function
    handles the most common ones.

    Args:
        exif_dict: Exiftool metadata dictionary

    Returns:
        Tuple of (location, gps_error)
        - location: {"lat": float, "lon": float} if valid and available, else None
        - gps_error: user-facing reason if GPS was present but invalid, else None
    """
    try:
        # Try direct decimal coordinates first (exiftool often provides these)
        lat = exif_dict.get("GPSLatitude")
        lon = exif_dict.get("GPSLongitude")

        if lat is not None and lon is not None:
            # Handle string format like "9 deg 16' 31.05\" N"
            if isinstance(lat, str):
                lat = _parse_gps_string(lat)
            if isinstance(lon, str):
                lon = _parse_gps_string(lon)

            if lat is not None and lon is not None:
                lat_f = float(lat)
                lon_f = float(lon)
                # Basic sanity: reject impossible coordinates so they don't poison
                # task-matching or any trajectory-based heuristics.
                if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
                    return (
                        None,
                        f"Invalid GPS coordinates (out of range): lat={lat_f}, lon={lon_f}",
                    )
                return {"lat": lat_f, "lon": lon_f}, None

        # Try composite GPS position
        gps_position = exif_dict.get("GPSPosition")
        if gps_position and isinstance(gps_position, str):
            # Format: "lat, lon" or "lat lon"
            parts = gps_position.replace(",", " ").split()
            if len(parts) >= 2:
                try:
                    lat = float(parts[0])
                    lon = float(parts[1])
                    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                        return (
                            None,
                            f"Invalid GPS coordinates (out of range): lat={lat}, lon={lon}",
                        )
                    return {"lat": lat, "lon": lon}, None
                except ValueError:
                    pass

        return None, None

    except Exception as e:
        log.error(f"Error parsing GPS coordinates: {e}")
        return None, None


def _parse_gps_string(gps_str: str) -> Optional[float]:
    """Parse GPS coordinate string to decimal degrees.

    Handles formats like:
    - "9 deg 16' 31.05\" N"
    - "9.123456"
    - "-8.299743916666667"

    Args:
        gps_str: GPS coordinate string

    Returns:
        Decimal degrees as float or None
    """
    try:
        # Try direct float conversion first
        return float(gps_str)
    except ValueError:
        pass

    try:
        # Parse DMS format: "9 deg 16' 31.05\" N"
        import re

        # Remove directional suffix and note it
        direction = 1
        gps_str = gps_str.strip()
        if gps_str.endswith(("S", "W")):
            direction = -1
            gps_str = gps_str[:-1].strip()
        elif gps_str.endswith(("N", "E")):
            gps_str = gps_str[:-1].strip()

        # Extract degrees, minutes, seconds
        match = re.match(
            r"(\d+(?:\.\d+)?)\s*(?:deg|°)?\s*(\d+(?:\.\d+)?)?['\s]*(\d+(?:\.\d+)?)?",
            gps_str,
        )
        if match:
            degrees = float(match.group(1))
            minutes = float(match.group(2)) if match.group(2) else 0
            seconds = float(match.group(3)) if match.group(3) else 0
            decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
            return decimal * direction

    except Exception as e:
        log.debug(f"Could not parse GPS string '{gps_str}': {e}")

    return None


def calculate_file_hash(file_content: bytes) -> str:
    """Calculate MD5 hash of file content.

    Args:
        file_content: File content as bytes

    Returns:
        MD5 hash as hex string
    """
    return hashlib.md5(file_content).hexdigest()


async def create_project_image(
    db: Connection, image_data: ProjectImageCreate
) -> ProjectImageOut:
    """Create a new project image record in the database.

    Args:
        db: Database connection
        image_data: Project image data to insert

    Returns:
        ProjectImageOut: The created project image record
    """
    # Convert location dict to PostGIS point if provided
    location_sql = "NULL"
    if image_data.location:
        lat = image_data.location.get("lat")
        lon = image_data.location.get("lon")
        if lat is not None and lon is not None:
            location_sql = f"ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326)"

    sql = f"""
        INSERT INTO project_images (
            project_id, task_id, filename, s3_key, hash_md5,
            location, exif, uploaded_by, status, batch_id, thumbnail_url, rejection_reason
        ) VALUES (
            %(project_id)s, %(task_id)s, %(filename)s, %(s3_key)s, %(hash_md5)s,
            {location_sql}, %(exif)s, %(uploaded_by)s, %(status)s, %(batch_id)s, %(thumbnail_url)s, %(rejection_reason)s
        )
        RETURNING id, project_id, task_id, filename, s3_key, hash_md5,
                  ST_AsGeoJSON(location)::json as location, exif, uploaded_by,
                  uploaded_at, classified_at, status, duplicate_of, batch_id, rejection_reason, thumbnail_url
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            sql,
            {
                "project_id": str(image_data.project_id),
                "task_id": str(image_data.task_id) if image_data.task_id else None,
                "filename": image_data.filename,
                "s3_key": image_data.s3_key,
                "hash_md5": image_data.hash_md5,
                "exif": Json(image_data.exif) if image_data.exif else None,
                "uploaded_by": str(image_data.uploaded_by),
                "status": image_data.status.value,
                "batch_id": str(image_data.batch_id) if image_data.batch_id else None,
                "thumbnail_url": image_data.thumbnail_url,
                "rejection_reason": image_data.rejection_reason,
            },
        )
        result = await cur.fetchone()

    log.info(f"Created project image record: {result['id']}")
    return ProjectImageOut(**result)


async def check_duplicate_image(
    db: Connection, project_id: UUID, hash_md5: str
) -> Optional[UUID]:
    """Check if an image with the same hash already exists in the project.

    Args:
        db: Database connection
        project_id: Project ID to check within
        hash_md5: MD5 hash of the image

    Returns:
        UUID of the duplicate image if found, None otherwise
    """
    sql = """
        SELECT id FROM project_images
        WHERE project_id = %(project_id)s
        AND hash_md5 = %(hash_md5)s
        LIMIT 1
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, {"project_id": str(project_id), "hash_md5": hash_md5})
        result = await cur.fetchone()

    return result["id"] if result else None


async def get_images_by_project(
    db: Connection, project_id: UUID, status: Optional[ImageStatus] = None
) -> list[ProjectImageOut]:
    """Get all images for a project, optionally filtered by status.

    Args:
        db: Database connection
        project_id: Project ID
        status: Optional status filter

    Returns:
        List of project images
    """
    status_filter = ""
    params = {"project_id": str(project_id)}

    if status:
        status_filter = " AND status = %(status)s"
        params["status"] = status.value

    sql = f"""
        SELECT
            id,
            project_id,
            task_id,
            filename,
            s3_key,
            hash_md5,
            batch_id,
            ST_AsGeoJSON(location)::json as location,
            exif,
            uploaded_by,
            uploaded_at,
            classified_at,
            status,
            duplicate_of,
            rejection_reason,
            thumbnail_url
        FROM project_images
        WHERE project_id = %(project_id)s{status_filter}
        ORDER BY uploaded_at DESC
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        results = await cur.fetchall()

    return [ProjectImageOut(**row) for row in results]


def _calculate_angular_difference(degree1: float, degree2: float) -> float:
    """
    Calculates the shortest angular difference between two angles.

    Ensures the difference accounts for 360-degree wrap-around.

    Returns:
         float: Absolute difference in degrees (0 to 180)
    """
    angular_difference = abs(degree1 - degree2)
    if angular_difference > 180:
        angular_difference = 360 - angular_difference
    return angular_difference


def _circular_mean_pair(degree1: float, degree2: float) -> float:
    """Circular mean of exactly two 0..360 degree values (pair-wise update helper)."""
    rad1 = math.radians(degree1)
    rad2 = math.radians(degree2)
    x = math.cos(rad1) + math.cos(rad2)
    y = math.sin(rad1) + math.sin(rad2)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _circular_mean_list(degrees: list[float]) -> float:
    """Circular mean for a list of 0..360 degree values."""
    if not degrees:
        raise ValueError("degrees must be non-empty")
    x = 0.0
    y = 0.0
    for d in degrees:
        r = math.radians(float(d))
        x += math.cos(r)
        y += math.sin(r)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


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
            azimuth_difference = _calculate_angular_difference(
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
            azimuth_difference = _calculate_angular_difference(
                set_image_azimuth, next_image_azimuth
            )
            if azimuth_difference > 10:
                return False
        return True


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
    db: Connection, project_id: UUID, batch_id: UUID, task_id: UUID
) -> None:
    """
    Identifies and flags flight tail imagery taken during takeoff and landing to prevent photogrammetric distortion.

    This function inspects the transit phases of a flight trajectory by analyzing azimuthal shifts between consecutive
    images and follows a three-step validation process:

    1. Baseline Calculation: Maintains a running average of the transit trajectory to account for any minor movement.

    2. Change in Direction (45-degrees): Triggers a change in direction when flight trajectory shifts more than
        45-degrees from the established baseline.
        Note: This 45-degree threshold may require tuning based on environmental conditions (e.g., high wind)
            or specific mission types (e.g., terrain following).

    3. Confirmation of Turn: Inspects a 5-image look-ahead or look-behind window to verify that the trajectory change
        is sustained and not a result of external factors (wind, wobble, etc).

    Args:
        db: Database connection
        project_id: Project ID
        batch_id: Batch ID

    Returns:
        None. Updates the status of identified tail images to ImageStatus.REJECTED in the database.
    """
    params = {
        "project_id": project_id,
        "batch_id": batch_id,
        "task_id": task_id,
        "status": ImageStatus.ASSIGNED.value,
    }

    sql = """
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
                NULLIF(regexp_replace(COALESCE(exif->>'AbsoluteAltitude',''), '[^0-9+\\-.]+', '', 'g'), '')::double precision AS altitude_m
            FROM project_images
            WHERE project_id = %(project_id)s
              AND batch_id = %(batch_id)s
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
                ELSE mod(degrees(ST_Azimuth(previous_location::geometry, location::geometry)) + 360.0, 360.0)
            END AS azimuth,
            CASE
                WHEN row_num = 1 THEN NULL
                ELSE ST_Distance(previous_location::geography, location::geography)
            END AS distance_moved,
            yaw_deg,
            previous_yaw_deg,
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

    MIN_DISTANCE_METERS = 5.0
    BASELINE_SAMPLE_COUNT = 5  # Increased from 3 for more stable baseline
    ALT_RATE_THRESHOLD_MPS = 2.0
    LOW_LATERAL_FOR_VERTICAL_METERS = 10.0
    MAX_TAIL_FRACTION = 0.25
    # We require a minimum segment size so the baseline heading estimate is stable.
    MIN_SEGMENT_SIZE = 20
    MIN_SEARCH_IMAGES = 10  # Minimum images to search for tails

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

        # TAKEOFF DETECTION
        takeoff_baseline = None
        takeoff_baseline_samples: list[float] = []

        # Find first valid baseline
        baseline_start_idx = None
        for i in range(search_limit):
            if i == 0:  # Skip first image (no azimuth)
                continue
            if segment[i].get("distance_moved", 0) < MIN_DISTANCE_METERS:
                continue
            if segment[i].get("vertical_candidate"):
                continue
            if segment[i].get("azimuth") is None:
                continue

            takeoff_baseline_samples.append(segment[i]["azimuth"])
            if len(takeoff_baseline_samples) == 1:
                baseline_start_idx = i

            if len(takeoff_baseline_samples) >= BASELINE_SAMPLE_COUNT:
                takeoff_baseline = _circular_mean_list(takeoff_baseline_samples)
                break

        # Only proceed if we have a valid baseline
        if takeoff_baseline is not None and baseline_start_idx is not None:
            for i in range(baseline_start_idx + BASELINE_SAMPLE_COUNT, search_limit):
                if i == 0 or segment[i].get("azimuth") is None:
                    continue
                if segment[i].get("distance_moved", 0) < MIN_DISTANCE_METERS:
                    continue
                if segment[i].get("vertical_candidate"):
                    continue

                current_azimuth = segment[i]["azimuth"]
                azimuth_difference = _calculate_angular_difference(
                    takeoff_baseline, current_azimuth
                )

                if azimuth_difference < 45:
                    # Still in baseline trajectory
                    takeoff_baseline = _circular_mean_pair(
                        takeoff_baseline, current_azimuth
                    )
                elif azimuth_difference > 60:  # Increased threshold from 45 to 60
                    # Potential turn detected - confirm it
                    if _confirm_stable_heading(segment, i, 1):
                        takeoff_tails_indices = list(range(i))
                        break

        # LANDING DETECTION (similar logic, working backwards)
        landing_baseline = None
        landing_baseline_samples: list[float] = []
        landing_start_idx = None

        landing_search_start = segment_length - 1
        landing_search_end = max(segment_length - search_limit, 0)

        for i in range(landing_search_start, landing_search_end, -1):
            if segment[i].get("distance_moved", 0) < MIN_DISTANCE_METERS:
                continue
            if segment[i].get("vertical_candidate"):
                continue
            if segment[i].get("azimuth") is None:
                continue

            landing_baseline_samples.append(segment[i]["azimuth"])
            if len(landing_baseline_samples) == 1:
                landing_start_idx = i

            if len(landing_baseline_samples) >= BASELINE_SAMPLE_COUNT:
                landing_baseline = _circular_mean_list(landing_baseline_samples)
                break

        if landing_baseline is not None and landing_start_idx is not None:
            for i in range(
                landing_start_idx - BASELINE_SAMPLE_COUNT, landing_search_end, -1
            ):
                if segment[i].get("azimuth") is None:
                    continue
                if segment[i].get("distance_moved", 0) < MIN_DISTANCE_METERS:
                    continue
                if segment[i].get("vertical_candidate"):
                    continue

                current_azimuth = segment[i]["azimuth"]
                azimuth_difference = _calculate_angular_difference(
                    landing_baseline, current_azimuth
                )

                if azimuth_difference < 45:
                    landing_baseline = _circular_mean_pair(
                        landing_baseline, current_azimuth
                    )
                elif azimuth_difference > 60:  # Increased threshold
                    if _confirm_stable_heading(segment, i, -1):
                        landing_tails_indices = list(range(i + 1, segment_length))
                        break

        # Apply safety checks
        all_tail_indices = takeoff_tails_indices + landing_tails_indices
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
