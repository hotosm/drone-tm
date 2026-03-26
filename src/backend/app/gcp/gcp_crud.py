import math
import uuid
from typing import List

from loguru import logger as log
from psycopg import Connection

from app.s3 import maybe_presign_s3_key
from app.waypoints import waypoint_schemas


async def _image_footprint_radius_meters(altitude: float, fov_degree: float) -> float:
    """Estimate the half-diagonal ground coverage of a drone image in meters.

    This gives a conservative search radius: any image whose center is within
    this distance of a GCP point *might* contain that point.
    """
    # Diagonal ground distance = 2 * altitude * tan(fov/2)
    fov_rad = math.radians(fov_degree)
    diagonal = 2 * altitude * math.tan(fov_rad / 2)
    # Half-diagonal is the max distance from image center to any corner
    return diagonal / 2


async def find_images_for_point_db(
    db: Connection,
    project_id: uuid.UUID,
    point: waypoint_schemas.PointField,
    fov_degree: float,
    altitude: float,
    max_results: int = 5,
) -> List[str]:
    """Find project images whose footprint contains the given GCP point.

    Uses a two-step approach:
    1. PostGIS ST_DWithin to find candidate images near the point (fast index scan)
    2. Python-side footprint check to confirm the point falls within each image's
       computed ground footprint

    Returns presigned URLs for matching images, limited to max_results.
    """
    search_radius_m = await _image_footprint_radius_meters(altitude, fov_degree)

    # ST_DWithin on geography type uses meters
    query = """
        SELECT
            s3_key,
            ST_X(location::geometry) AS lon,
            ST_Y(location::geometry) AS lat,
            exif
        FROM project_images
        WHERE project_id = %(project_id)s
          AND location IS NOT NULL
          AND ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
                %(radius)s
              )
        ORDER BY ST_Distance(
            location::geography,
            ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
        )
    """
    params = {
        "project_id": str(project_id),
        "lon": point.longitude,
        "lat": point.latitude,
        "radius": search_radius_m,
    }

    async with db.cursor() as cur:
        await cur.execute(query, params)
        rows = await cur.fetchall()

    if not rows:
        log.info(
            f"No candidate images found within {search_radius_m:.0f}m "
            f"of ({point.longitude}, {point.latitude})"
        )
        return []

    # Refine: check that the GCP point actually falls within each image's footprint
    matching_s3_keys: List[str] = []
    for s3_key, img_lon, img_lat, exif in rows:
        if _point_in_image_footprint(
            point.longitude,
            point.latitude,
            img_lon,
            img_lat,
            altitude,
            fov_degree,
            exif,
        ):
            matching_s3_keys.append(s3_key)
            if len(matching_s3_keys) >= max_results:
                break

    log.info(
        f"Found {len(matching_s3_keys)} images containing "
        f"({point.longitude}, {point.latitude}) from {len(rows)} candidates"
    )

    return [
        url
        for s3_key in matching_s3_keys
        if (url := maybe_presign_s3_key(s3_key)) is not None
    ]


def _point_in_image_footprint(
    pt_lon: float,
    pt_lat: float,
    img_lon: float,
    img_lat: float,
    altitude: float,
    fov_degree: float,
    exif: dict | None,
) -> bool:
    """Check if a point falls within an image's computed ground footprint.

    Computes the image footprint from center coordinates, altitude, FOV,
    and aspect ratio (from EXIF), then checks containment.
    """
    # Get aspect ratio from EXIF if available, default to 4:3
    aspect_ratio = 4 / 3
    if exif:
        w = exif.get("ImageWidth") or exif.get("ExifImageWidth")
        h = exif.get("ImageHeight") or exif.get("ExifImageHeight")
        if w and h:
            try:
                aspect_ratio = float(w) / float(h)
            except (ValueError, ZeroDivisionError):
                pass

    # Calculate footprint dimensions in meters
    fov_rad = math.radians(fov_degree)
    diagonal = 2 * altitude * math.tan(fov_rad / 2)
    footprint_h = diagonal / math.sqrt(1 + aspect_ratio**2)
    footprint_w = aspect_ratio * footprint_h

    # Convert half-dimensions to approximate lat/lon offsets
    earth_radius = 6378137.0
    half_h = footprint_h / 2
    half_w = footprint_w / 2

    delta_lat = (half_h / earth_radius) * (180 / math.pi)
    delta_lon = (half_w / (earth_radius * math.cos(math.radians(img_lat)))) * (
        180 / math.pi
    )

    # Simple bounding box containment check
    return (img_lon - delta_lon) <= pt_lon <= (img_lon + delta_lon) and (
        img_lat - delta_lat
    ) <= pt_lat <= (img_lat + delta_lat)
