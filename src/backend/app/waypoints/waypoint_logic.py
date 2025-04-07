from geojson_pydantic import Point, Polygon
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform


def check_point_within_buffer(
    point: Point, polygon_geojson: Polygon, buffer_distance: float
):
    """Check if a point is within the buffer of a polygon.

    Parameters:
    - point_coords: tuple (lon, lat) for the point's coordinates
    - polygon_coords: list of (lon, lat) tuples for the polygon's coordinates
    - buffer_distance: buffer distance in meters

    Returns:
    - True if the point is within the buffer, False otherwise
    """
    # Create a shapely polygon and point using the input coordinates
    polygon = shape(polygon_geojson["features"][0]["geometry"])
    from shapely.geometry import Point

    point = Point(point)

    # Create a transformer to project from EPSG:4326 to EPSG:3857 (meters)
    transformer_to_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

    # Transform the polygon and point to EPSG:3857 (meters)
    projected_polygon = transform(transformer_to_3857.transform, polygon)
    projected_point = transform(transformer_to_3857.transform, point)

    # Create a buffer around the polygon boundary
    polygon_buffer = projected_polygon.buffer(
        buffer_distance
    )  # buffer distance in meters

    # Check if the point is within the buffer
    is_within_buffer = polygon_buffer.contains(projected_point)
    return is_within_buffer
