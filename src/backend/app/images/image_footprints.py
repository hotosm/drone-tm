import math

import pyproj
from shapely.affinity import rotate
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform, unary_union


# Convert lon/lat to meters for footprint and area math.
# A degree is not a fixed ground distance, so we avoid area math in EPSG:4326.
projector = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
inverse_projector = pyproj.Transformer.from_crs(
    "EPSG:3857", "EPSG:4326", always_xy=True
)

# Fallbacks when EXIF/project metadata is missing.
DEFAULT_DIAGONAL_FOV_DEG = 82.1
DEFAULT_IMAGE_WIDTH = 4000
DEFAULT_IMAGE_HEIGHT = 3000


def _as_float(value) -> float | None:
    # EXIF values can be messey as strings, blanks, or missing.
    # This function converts values into numbers or None.
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _footprint_size_meters(
    gsd_cm_px: float | None,
    altitude_m: float | None,
    image_width: float | None,
    image_height: float | None,
) -> tuple[float, float] | None:
    """Estimate the ground width/height covered by one image."""
    # Prefer GSD: it tells us directly how much ground each pixel covers.
    gsd_cm_px = _as_float(gsd_cm_px)
    altitude_m = _as_float(altitude_m)
    image_width = _as_float(image_width) or DEFAULT_IMAGE_WIDTH
    image_height = _as_float(image_height) or DEFAULT_IMAGE_HEIGHT

    if gsd_cm_px and gsd_cm_px > 0:
        # Example: 2 cm/px * 4000 px / 100 = 80m on the ground.
        return (
            gsd_cm_px * image_width / 100,
            gsd_cm_px * image_height / 100,
        )

    # If no GSD: altitude + camera FOV gives an approximate ground rectangle.
    if altitude_m and altitude_m > 0:
        # Keep the rectangle shaped like the image, usually 4:3.
        aspect_ratio = image_width / image_height
        diagonal_m = 2 * altitude_m * math.tan(
            math.radians(DEFAULT_DIAGONAL_FOV_DEG) / 2
        )
        # Convert the estimated diagonal into width and height.
        height_m = diagonal_m / math.sqrt(1 + aspect_ratio**2)
        width_m = aspect_ratio * height_m
        return width_m, height_m

    return None


def image_footprint_polygon(image: dict) -> Polygon | None:
    """Build one image footprint as a yaw-rotated rectangle in meters."""
    # No GPS point means no map footprint.
    if not image.get("location"):
        return None

    # Calculate how big this image is on the ground.
    # GSD preferred, altitude/FOV is the second choice.
    footprint_size = _footprint_size_meters(
        image.get("gsd_cm_px"),
        image.get("altitude_m"),
        image.get("image_width"),
        image.get("image_height"),
    )
    if not footprint_size:
        return None

    # Build in meters first, then convert back to lon/lat only for display.
    width_m, height_m = footprint_size
    # Convert image GPS point into meter coordinates
    center = transform(projector.transform, shape(image["location"])) 
    x, y = center.x, center.y
    half_width = width_m / 2
    half_height = height_m / 2

    # Draw rectangle corners (not rotated)
    footprint = Polygon(
        [
            (x - half_width, y - half_height),
            (x + half_width, y - half_height),
            (x + half_width, y + half_height),
            (x - half_width, y + half_height),
            (x - half_width, y - half_height),
        ]
    )

    # Rotate it using drone/camera heading when EXIF has yaw.
    yaw_deg = _as_float(image.get("yaw_deg"))
    if yaw_deg is not None:
        # Shapely rotates counter-clockwise from east; yaw is clockwise from north.
        footprint = rotate(footprint, 90 - yaw_deg, origin=center)

    return footprint


def image_footprints_feature_collection(images: list[dict]) -> dict:
    """Return map-ready GeoJSON outlines for all image footprints."""
    # Frontend map layers need GeoJSON in lon/lat.
    features = []
    for image in images:
        footprint = image_footprint_polygon(image)
        if footprint is None:
            continue

        # Convert meters back to lon/lat. MapLibre expects GeoJSON coordinates in that.
        footprint_wgs84 = transform(inverse_projector.transform, footprint)
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(footprint_wgs84),
                "properties": {"image_id": str(image["id"])},
            }
        )

    return {"type": "FeatureCollection", "features": features}


def coverage_percentage_from_footprints(
    coverage_geometry: dict,
    images: list[dict],
) -> float:
    """Calculate covered area percentage from unioned rectangular footprints."""
    # Merge rectangles, clip to the task, then divide by task area.
    target_m = transform(projector.transform, shape(coverage_geometry))
    footprints = [
        footprint
        for footprint in (image_footprint_polygon(image) for image in images)
        if footprint is not None
    ]

    if not footprints or target_m.is_empty or target_m.area <= 0:
        return 0.0

    # unary_union counts overlapping photo footprints only once
    # photos outside the task area don't count
    covered_m = unary_union(footprints).intersection(target_m)
    return min(100.0, (covered_m.area / target_m.area) * 100)
