"""Business logic for project images."""

import hashlib
import json
import tempfile
from typing import Any, Optional
from uuid import UUID

import exiftool
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.images.image_schemas import ProjectImageCreate, ProjectImageOut
from app.models.enums import ImageStatus


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
            decoded = value.decode("utf-8", errors="ignore")
            return _sanitize_string(decoded)
        except (UnicodeDecodeError, AttributeError):
            return _sanitize_string(str(value))
    if isinstance(value, dict):
        return {k: _sanitize_exif_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_exif_value(item) for item in value]
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
        # Write bytes to a temp file since exiftool works with files
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as tmp_file:
            tmp_file.write(image_bytes)
            tmp_file.flush()

            # Extract metadata using exiftool
            with exiftool.ExifToolHelper() as et:
                metadata_list = et.get_metadata(tmp_file.name)

            if not metadata_list:
                log.warning("No EXIF data found in image")
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
        log.error(f"Error extracting EXIF data: {e}")
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
            location, exif, uploaded_by, status, batch_id
        ) VALUES (
            %(project_id)s, %(task_id)s, %(filename)s, %(s3_key)s, %(hash_md5)s,
            {location_sql}, %(exif)s, %(uploaded_by)s, %(status)s, %(batch_id)s
        )
        RETURNING id, project_id, task_id, filename, s3_key, hash_md5,
                  ST_AsGeoJSON(location)::json as location, exif, uploaded_by,
                  uploaded_at, classified_at, status, duplicate_of, batch_id, rejection_reason
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


async def mark_image_as_duplicate(
    db: Connection, image_id: UUID, duplicate_of: UUID
) -> None:
    """Mark an image as a duplicate of another image.

    Args:
        db: Database connection
        image_id: ID of the image to mark as duplicate
        duplicate_of: ID of the original image
    """
    sql = """
        UPDATE project_images
        SET status = %(status)s, duplicate_of = %(duplicate_of)s
        WHERE id = %(image_id)s
    """

    async with db.cursor() as cur:
        await cur.execute(
            sql,
            {
                "status": ImageStatus.DUPLICATE.value,
                "duplicate_of": str(duplicate_of),
                "image_id": str(image_id),
            },
        )

    log.info(f"Marked image {image_id} as duplicate of {duplicate_of}")


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
