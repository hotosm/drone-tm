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
) -> tuple[Optional[dict[str, Any]], Optional[dict[str, float]]]:
    """Extract EXIF data and GPS coordinates from image bytes using exiftool.

    This uses pyexiftool which provides comprehensive metadata extraction,
    including DJI drone-specific XMP data (yaw, pitch, roll, gimbal angles, etc.).

    Args:
        image_bytes: Image file content as bytes

    Returns:
        Tuple of (exif_dict, location_dict)
        - exif_dict: All EXIF/XMP data as a dictionary
        - location_dict: GPS coordinates as {"lat": float, "lon": float} or None
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
                return None, None

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
        location = _extract_gps_from_exif(exif_dict)

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

        return exif_dict, location

    except Exception as e:
        # Keep this at debug to avoid noisy logs during batch uploads, but include
        # the full exception for troubleshooting.
        log.opt(exception=True).debug(
            f"EXIF extraction failed: {type(e).__name__}: {e}"
        )
        return None, None


def _extract_gps_from_exif(exif_dict: dict) -> Optional[dict[str, float]]:
    """Extract GPS coordinates from exiftool metadata.

    Exiftool provides GPS coordinates in multiple formats. This function
    handles the most common ones.

    Args:
        exif_dict: Exiftool metadata dictionary

    Returns:
        Dictionary with lat/lon or None
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
                return {"lat": float(lat), "lon": float(lon)}

        # Try composite GPS position
        gps_position = exif_dict.get("GPSPosition")
        if gps_position and isinstance(gps_position, str):
            # Format: "lat, lon" or "lat lon"
            parts = gps_position.replace(",", " ").split()
            if len(parts) >= 2:
                try:
                    lat = float(parts[0])
                    lon = float(parts[1])
                    return {"lat": lat, "lon": lon}
                except ValueError:
                    pass

        return None

    except Exception as e:
        log.error(f"Error parsing GPS coordinates: {e}")
        return None


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
        SELECT id, project_id, task_id, filename, s3_key, hash_md5,
               ST_AsGeoJSON(location)::json as location, exif, uploaded_by,
               uploaded_at, classified_at, status, duplicate_of
        FROM project_images
        WHERE project_id = %(project_id)s{status_filter}
        ORDER BY uploaded_at DESC
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        results = await cur.fetchall()

    return [ProjectImageOut(**row) for row in results]


def _calculate_angular_difference(
        degree1: float, degree2: float
        ) -> float: 
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

def _calculate_circular_mean(
        degree1: float, degree2: float
    ) -> float: 
    """
    Calcultes the mean between two angles, accounting for 360-degree wrap around. 
    """
    rad1 = math.radians(degree1)
    rad2 = math.radians(degree2)
    x = math.cos(rad1) + math.cos(rad2)
    y = math.sin(rad1) + math.sin(rad2)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def _confirm_stable_heading(
        project_list: list, image_index: int, steps: int
        ) -> bool:
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
    set_image_azimuth = project_list[image_index]['azimuth']
    list_length = len(project_list)

    if steps > 0: 
        # Look forward in the flight mission 
        bound = min(image_index + 6, list_length)
        for i in range(image_index + 1, bound, steps):
            next_image_azimuth = project_list[i]['azimuth']
            azimuth_difference = _calculate_angular_difference(set_image_azimuth, next_image_azimuth)
            if azimuth_difference > 10:
                return False
        return True

    else: 
        # Look backwards and "into" the flight mission from the landing waypoint
        bound = max(image_index - 6, -1)
        for i in range(image_index - 1, bound, steps):
            next_image_azimuth = project_list[i]['azimuth']
            azimuth_difference = _calculate_angular_difference(set_image_azimuth, next_image_azimuth)
            if azimuth_difference > 10:
                return False
        return True


async def _flag_flight_tail_images(
        db: Connection,
        project_list: list,
        flight_tail_list: list
    ) -> None:
    """
    Updates the status of identified flight tail images to REJECTED with a specified comment. 
    """
    if not flight_tail_list:
        return None
    
    flight_tails_ids = [project_list[i]['id'] for i in flight_tail_list]

    params = {
        "status":ImageStatus.REJECTED.value,
        "reason": "Flight tail detection: Image identified as flightplan transit (takeoff/landing tail).",
        "time": datetime.now(timezone.utc),
        "ids": flight_tails_ids
    }

    sql = """
    UPDATE project_images
    SET status =  %(status)s,
        rejection_reason = %(reason)s,
        classified_at = %(time)s
    WHERE id = ANY(%(ids)s)
    """

    async with db.cursor() as cur: 
        await cur.execute(sql, params)


async def mark_and_remove_flight_tail_imagery(
        db: Connection,
        project_id: UUID,
        batch_id: UUID
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
        "status": ImageStatus.UPLOADED.value,
        "batch_id": batch_id
    }

    sql = """
        WITH trajectory_data AS (
            SELECT
                id, 
                location,
                uploaded_at, 
                LAG(location) OVER (ORDER BY uploaded_at ASC) as previous_location
            FROM project_images
            WHERE project_id = %(project_id)s
                AND status =  %(status)s
                AND batch_id = %(batch_id)s
        )
        SELECT 
            id, 
            location,
            uploaded_at, 
            previous_location,
            degrees(ST_Azimuth(previous_location, location)) AS azimuth,
            ST_Distance(previous_location, location) AS distance_moved
        WHERE previous_location IS NOT NULL
        FROM trajectory_data
        ORDER BY uploaded_at ASC;
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        project_image_results = await cur.fetchall()

    project_length = len(project_image_results)

    # Sets search limit based on batch size.
    limit = min(max(30, project_length // 3), 60)
    search_limit = min(limit, project_length - 1)

    takeoff_loop = range(search_limit)
    takeoff_mission_start_idx = None
    takeoff_baseline = None
    takeoff_tails_indices = []

    landing_loop = range(project_length - 1, project_length - search_limit, -1)
    landing_mission_start_idx = None
    landing_baseline = None
    landing_tails_indices = []

    # 1. Check for flight tails that occur during takeoff.
    for i in takeoff_loop: 
        if project_image_results[i]['distance_moved'] < 1.0:
            continue 

        current_azimuth = project_image_results[i]['azimuth']
        if takeoff_baseline is None: 
            takeoff_baseline = current_azimuth
            continue
        
        azimuth_difference = _calculate_angular_difference(takeoff_baseline, current_azimuth)
        # A 45-degree change in baseline suggests a change in direction during the flight.
        # Note: This threshold may need tuning for environmental conditions or specific mission types. 
        if azimuth_difference < 45:
            takeoff_baseline = _calculate_circular_mean(takeoff_baseline, current_azimuth)

        elif azimuth_difference > 45:
            if _confirm_stable_heading(project_image_results, i, 1):
                takeoff_mission_start_idx = i 
                break
    
    if takeoff_mission_start_idx is not None: 
        takeoff_tails_indices = list(range(takeoff_mission_start_idx))

     # 2. Check for flight tails that occur during landing.
    for i in landing_loop: 
        if project_image_results[i]['distance_moved'] < 1.0:
            continue 

        current_azimuth = project_image_results[i]['azimuth']
        if landing_baseline is None: 
            landing_baseline = current_azimuth
            continue

        azimuth_difference = _calculate_angular_difference(landing_baseline, current_azimuth)
        if azimuth_difference < 45:
            landing_baseline = _calculate_circular_mean(landing_baseline, current_azimuth)

        elif azimuth_difference > 45:
            if _confirm_stable_heading(project_image_results, i, -1):
                landing_mission_start_idx = i 
                break
    
    if landing_mission_start_idx is not None: 
        landing_tails_indices = list(range(landing_mission_start_idx + 1, project_length))

    # 3. Aggregate flight tail images and flag detected images
    all_tail_indices = takeoff_tails_indices + landing_tails_indices
    if all_tail_indices: 
        await _flag_flight_tail_images(db, project_image_results, all_tail_indices)
