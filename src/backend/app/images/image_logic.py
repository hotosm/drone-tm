"""Business logic for project images."""

import functools
import hashlib
import json
import shutil
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import exiftool
from app.images.image_schemas import ProjectImageCreate, ProjectImageOut
from app.models.enums import ImageStatus
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json

# Capture timestamps in preference order, paired with offset tags.
_CAPTURE_TIME_FIELDS = (
    ("SubSecDateTimeOriginal", None),
    ("DateTimeOriginal", "OffsetTimeOriginal"),
    ("GPSDateTime", None),
    ("SubSecCreateDate", None),
    ("CreateDate", "OffsetTimeDigitized"),
)

_EXIF_DATETIME_FORMATS = (
    "%Y:%m:%d %H:%M:%S.%f%z",
    "%Y:%m:%d %H:%M:%S%z",
    "%Y:%m:%d %H:%M:%S.%f",
    "%Y:%m:%d %H:%M:%S",
)

_CAPTURE_EXIF_KEYS = [
    "Make",
    "Model",
    *(field for pair in _CAPTURE_TIME_FIELDS for field in pair if field),
]


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
) -> tuple[dict[str, Any] | None, dict[str, float] | None, str | None]:
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
) -> tuple[dict[str, float] | None, str | None]:
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


def _parse_gps_string(gps_str: str) -> float | None:
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
) -> UUID | None:
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


async def reject_assigned_images(db: Connection, image_ids: list, reason: str) -> None:
    """Mark the given images REJECTED with a reason.

    Only touches rows that are still a clean 'assigned' with no existing
    rejection_reason, so post-classification passes (flight-tail, stationary)
    never overwrite a higher-priority quality rejection (blur, bad gimbal, etc.).
    """
    if not image_ids:
        return

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
        await cur.execute(
            sql,
            {
                "status": ImageStatus.REJECTED.value,
                "reason": reason,
                "time": datetime.now(timezone.utc),
                "ids": image_ids,
            },
        )


async def get_images_by_project(
    db: Connection, project_id: UUID, status: ImageStatus | None = None
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


@dataclass
class ProjectCaptureMetadata:
    acquisition_start: datetime | None
    acquisition_end: datetime | None
    sensor: str | None
    image_count: int
    # Number of naive capture times interpreted as UTC.
    timezone_assumed_count: int = 0


def _parse_exif_datetime(
    raw: Any, offset: Any = None, *, require_timezone: bool = False
) -> datetime | None:
    if not isinstance(raw, str):
        return None

    value = raw.strip()
    if not value or value.startswith("0000"):
        return None

    candidates = [value]
    if isinstance(offset, str) and offset.strip():
        candidates.insert(0, value + offset.strip())

    for candidate in candidates:
        for fmt in _EXIF_DATETIME_FORMATS:
            try:
                parsed = datetime.strptime(candidate, fmt)  # noqa: DTZ007
            except ValueError:
                continue
            if parsed.tzinfo:
                return parsed
            return None if require_timezone else parsed.replace(tzinfo=timezone.utc)

    return None


def _capture_time_from_exif(exif: dict[str, Any]) -> tuple[datetime | None, bool]:
    """Prefer timezone-aware EXIF timestamps before assuming UTC."""
    for require_timezone in (True, False):
        for field, offset_field in _CAPTURE_TIME_FIELDS:
            parsed = _parse_exif_datetime(
                exif.get(field),
                exif.get(offset_field) if offset_field else None,
                require_timezone=require_timezone,
            )
            if parsed:
                return parsed, not require_timezone
    return None, False


def _sensor_from_exif(exif: dict[str, Any]) -> str | None:
    make = exif.get("Make")
    model = exif.get("Model")
    make = make.strip() if isinstance(make, str) else ""
    model = model.strip() if isinstance(model, str) else ""

    if not model:
        return make or None
    if make and not model.upper().startswith(make.upper()):
        return f"{make} {model}"
    return model


async def get_project_capture_metadata(
    db: Connection, project_id: UUID
) -> ProjectCaptureMetadata:
    """Derive metadata from the assigned photos used by ODM."""
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT (
                SELECT jsonb_object_agg(key, value)
                FROM jsonb_each(exif)
                WHERE key = ANY(%(keys)s)
            )
            FROM project_images
            WHERE project_id = %(project_id)s
              AND exif IS NOT NULL
              AND status::text = %(status)s
            """,
            {
                "project_id": str(project_id),
                "status": ImageStatus.ASSIGNED.value,
                "keys": _CAPTURE_EXIF_KEYS,
            },
        )
        rows = await cur.fetchall()

    capture_times: list[datetime] = []
    sensors: Counter[str] = Counter()
    timezone_assumed = 0

    for (exif,) in rows:
        if not isinstance(exif, dict):
            continue
        captured, assumed_tz = _capture_time_from_exif(exif)
        if captured:
            capture_times.append(captured)
            timezone_assumed += assumed_tz
        sensor = _sensor_from_exif(exif)
        if sensor:
            sensors[sensor] += 1

    if len(sensors) > 1:
        log.warning(
            f"Project {project_id} imagery reports multiple sensors, "
            f"using the most common: {dict(sensors)}"
        )
    if timezone_assumed:
        log.warning(
            f"Project {project_id}: {timezone_assumed} of {len(capture_times)} "
            "capture times carried no timezone and were read as UTC"
        )

    return ProjectCaptureMetadata(
        acquisition_start=min(capture_times) if capture_times else None,
        acquisition_end=max(capture_times) if capture_times else None,
        sensor=sensors.most_common(1)[0][0] if sensors else None,
        image_count=len(rows),
        timezone_assumed_count=timezone_assumed,
    )
