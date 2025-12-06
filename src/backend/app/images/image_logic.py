"""Business logic for project images."""

import hashlib
import json
from io import BytesIO
from typing import Any, Optional
from uuid import UUID

from loguru import logger as log
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.images.image_schemas import ProjectImageCreate, ProjectImageOut
from app.models.enums import ImageStatus


def _convert_exif_value(value: Any) -> Any:
    """Convert EXIF values to JSON-serializable types.

    PIL's EXIF data contains special types like IFDRational, TiffImagePlugin.IFDRational
    which need to be converted to standard Python types for JSON serialization.
    """
    # Handle IFDRational (PIL's rational number type)
    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        # Convert rational to float
        return (
            float(value.numerator) / float(value.denominator)
            if value.denominator != 0
            else 0.0
        )

    # Handle bytes
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="ignore")
        except UnicodeDecodeError:
            return str(value)

    # Handle tuples (convert to list for JSON)
    if isinstance(value, tuple):
        return [_convert_exif_value(item) for item in value]

    # Handle lists
    if isinstance(value, list):
        return [_convert_exif_value(item) for item in value]

    # Handle dicts
    if isinstance(value, dict):
        return {k: _convert_exif_value(v) for k, v in value.items()}

    # Handle other non-serializable types
    if not isinstance(value, (str, int, float, bool, type(None))):
        return str(value)

    return value


def extract_exif_data(
    image_bytes: bytes,
) -> tuple[Optional[dict[str, Any]], Optional[dict[str, float]]]:
    """Extract EXIF data and GPS coordinates from image bytes.

    Args:
        image_bytes: Image file content as bytes

    Returns:
        Tuple of (exif_dict, location_dict)
        - exif_dict: All EXIF data as a dictionary
        - location_dict: GPS coordinates as {"lat": float, "lon": float} or None
    """
    try:
        image = Image.open(BytesIO(image_bytes))
        exif_data = image._getexif()

        if not exif_data:
            log.warning("No EXIF data found in image")
            return None, None

        # Convert EXIF data to readable format
        exif_dict = {}
        gps_info = {}

        for tag_id, value in exif_data.items():
            tag_name = TAGS.get(tag_id, tag_id)

            # Handle GPS data specially
            if tag_name == "GPSInfo":
                for gps_tag_id, gps_value in value.items():
                    gps_tag_name = GPSTAGS.get(gps_tag_id, gps_tag_id)
                    # Convert GPS values to JSON-serializable types
                    gps_info[gps_tag_name] = _convert_exif_value(gps_value)
            else:
                # Convert all EXIF values to JSON-serializable types
                exif_dict[tag_name] = _convert_exif_value(value)

        # Extract GPS coordinates
        location = None
        if gps_info:
            location = _parse_gps_coordinates(gps_info)

        # Add GPS info to EXIF dict
        if gps_info:
            exif_dict["GPSInfo"] = gps_info

        # Log EXIF data for debugging
        log.debug(f"Extracted EXIF data with {len(exif_dict)} tags")
        log.debug(f"EXIF sample: {list(exif_dict.keys())[:5]}")

        # Verify EXIF data is JSON-serializable
        try:
            json.dumps(exif_dict)
        except TypeError as e:
            log.error(f"EXIF data contains non-serializable types: {e}")
            log.error(f"Problematic EXIF keys: {exif_dict.keys()}")
            # Find the problematic field
            for key, value in exif_dict.items():
                try:
                    json.dumps({key: value})
                except TypeError:
                    log.error(f"Non-serializable field: {key} = {type(value)} {value}")
            raise

        return exif_dict, location

    except Exception as e:
        log.error(f"Error extracting EXIF data: {e}")
        return None, None


def _parse_gps_coordinates(gps_info: dict) -> Optional[dict[str, float]]:
    """Parse GPS coordinates from EXIF GPS info.

    Args:
        gps_info: GPS info dictionary from EXIF

    Returns:
        Dictionary with lat/lon or None
    """
    try:
        # Get latitude
        lat_ref = gps_info.get("GPSLatitudeRef")
        lat_data = gps_info.get("GPSLatitude")

        # Get longitude
        lon_ref = gps_info.get("GPSLongitudeRef")
        lon_data = gps_info.get("GPSLongitude")

        if not (lat_data and lon_data):
            return None

        # Convert to decimal degrees
        lat = _convert_to_degrees(lat_data)
        lon = _convert_to_degrees(lon_data)

        # Apply reference (N/S, E/W)
        if lat_ref == "S":
            lat = -lat
        if lon_ref == "W":
            lon = -lon

        return {"lat": lat, "lon": lon}

    except Exception as e:
        log.error(f"Error parsing GPS coordinates: {e}")
        return None


def _convert_to_degrees(value: tuple) -> float:
    """Convert GPS coordinates from degrees/minutes/seconds to decimal degrees.

    Args:
        value: Tuple of (degrees, minutes, seconds)

    Returns:
        Decimal degrees as float
    """
    degrees = float(value[0])
    minutes = float(value[1])
    seconds = float(value[2])

    return degrees + (minutes / 60.0) + (seconds / 3600.0)


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
            location, exif, uploaded_by, status
        ) VALUES (
            %(project_id)s, %(task_id)s, %(filename)s, %(s3_key)s, %(hash_md5)s,
            {location_sql}, %(exif)s, %(uploaded_by)s, %(status)s
        )
        RETURNING id, project_id, task_id, filename, s3_key, hash_md5,
                  ST_AsGeoJSON(location)::json as location, exif, uploaded_by,
                  uploaded_at, classified_at, status, duplicate_of
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
