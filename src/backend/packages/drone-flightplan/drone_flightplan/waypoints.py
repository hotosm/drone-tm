import argparse
import logging
from math import sqrt
from typing import Optional

import geojson
import pyproj
from shapely.affinity import rotate
from shapely.geometry import Point, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

from drone_flightplan.calculate_parameters import calculate_parameters as cp
from drone_flightplan.drone_type import DroneType

log = logging.getLogger(__name__)


def add_buffer_to_aoi(
    aoi_polygon: BaseGeometry, buffer_distance: float
) -> BaseGeometry:
    """Add a buffer around the AOI polygon.

    Parameters:
        aoi_polygon (BaseGeometry): The Shapely shape representing the area of interest.
        buffer_distance (float): The distance to buffer around the polygon (in meters).

    Returns:
        BaseGeometry: The buffered polygon.
    """
    return aoi_polygon.buffer(buffer_distance)


def generate_grid_in_aoi(
    aoi_polygon: shape, x_spacing: float, y_spacing: float, rotation_angle: float = 0.0
) -> list[Point]:
    """Generate a grid of points within a given Area of Interest (AOI) polygon.

    Parameters:
        aoi_polygon (shape): The Shapely shape representing the area of interest.
        x_spacing (float): The spacing between points along the x-axis (in meters).
        y_spacing (float): The spacing between points along the y-axis (in meters).

    Returns:
        list[Point]: A list of Points representing the generated grid within the AOI.
    """
    buffered_polygon = add_buffer_to_aoi(aoi_polygon, x_spacing)

    # Calculate the centroid for rotating the grid around the polygon's center
    centroid = aoi_polygon.centroid

    # rotate polygon
    rotated_polygon = rotate(aoi_polygon, 30, origin=centroid, use_radians=False)

    # Get the bounds of the unrotated AOI to set limits for point generation
    rotated_minx, rotated_miny, rotated_maxx, rotated_maxy = rotated_polygon.bounds

    # original polygon bounds
    original_minx, original_miny, original_maxx, original_maxy = aoi_polygon.bounds

    # Compute the minimum and maximum bounds considering both the rotated and original polygons
    minx = min(rotated_minx, original_minx)
    miny = min(rotated_miny, original_miny)
    maxx = max(rotated_maxx, original_maxx)
    maxy = max(rotated_maxy, original_maxy)

    # List to store the points
    points = []

    # Define a grid in the unrotated space
    xpoints = int((maxx - minx) / x_spacing) + 1
    ypoints = int((maxy - miny) / y_spacing) + 1
    current_axis = "x"  # Start with the x-axis

    # Generate points in the unrotated grid
    for yi in range(ypoints):
        for xi in range(xpoints):
            # Create the point in the unrotated space
            x = minx + xi * x_spacing
            y = miny + yi * y_spacing
            point = Point(x, y)

            # Rotate the point using Shapely's rotate function
            rotated_point = rotate(
                point, rotation_angle, origin=centroid, use_radians=False
            )

            # Assign angle based on the current axis
            angle = -90 if current_axis == "x" else 90

            # Check if the rotated point is inside the original AOI polygon (unrotated polygon)
            if buffered_polygon.contains(rotated_point):
                points.append({"coordinates": rotated_point, "angle": angle})

        # Toggle the axis after processing one row
        current_axis = "y" if current_axis == "x" else "x"

    return points


def calculate_distance(point1, point2):
    """Calculate Euclidean distance between two points."""
    return sqrt((point1.x - point2.x) ** 2 + (point1.y - point2.y) ** 2)


def create_path(
    points: list[Point],
    forward_spacing: float,
    rotation_angle: float = 0.0,
    generate_3d: bool = False,
    take_off_point: list[float] = None,
    polygon: Optional[Polygon] = None,
) -> list[dict]:
    """Create a continuous path of waypoints from a grid of points.

    Parameters:
        points (list[Point]): A list of Points representing the grid.
        forward_spacing (float): The spacing between rows of points (in meters).
        generate_3d (bool): Whether to generate additional 3D waypoints for the path.
        take_off_point (list[float]): Optional takeoff point coordinates.
        polygon (Polygon): Optional Shapely Polygon to filter points.

    Returns:
        list[dict]: A list of dictionaries representing the waypoints along the path.
    """
    # TODO: Make the gimbal angle dynamic. Right now it is static to -80

    def filter_points_in_polygon(segment_points, polygon, is_edge_segment=False):
        """Filter points outside the given polygon. If more than 2 points are outside the polygon,"""
        # Edge segments are first and last lines of the grid.
        # They are ignores to maintain overlap with the adjacent task grid.
        if not polygon or is_edge_segment:
            return segment_points

        # Filter points outside the polygon
        outside_points = [
            point
            for point in segment_points
            if not (
                polygon.contains(point["coordinates"])
                or polygon.touches(point["coordinates"])
            )
        ]

        # If more than 2 outside points, remove first and last
        if len(outside_points) > 2:
            filtered_points = [
                p
                for p in segment_points
                if p not in [outside_points[0], outside_points[-1]]
            ]
            return filtered_points

        return segment_points

    def process_angle_based_segments(coordinates_list):
        # Create a deep copy of the original list
        result_list = coordinates_list.copy()

        # Find the segments based on angle changes
        segments = []
        current_segment = []
        current_angle = None

        for i, coord in enumerate(coordinates_list):
            if current_angle is None:
                current_angle = coord["angle"]

            if coord["angle"] == current_angle:
                current_segment.append(i)
            else:
                segments.append((current_segment, current_angle))
                current_segment = [i]
                current_angle = coord["angle"]

        # Add the last segment if it exists
        if current_segment:
            segments.append((current_segment, current_angle))

        # Process each segment
        for segment_indices, angle in segments:
            # Only reverse segments where angle is -90
            if angle == -90:
                # Get the original values for this segment
                segment_values = [coordinates_list[i] for i in segment_indices]

                # Reverse the segment
                reversed_segment = segment_values[::-1]

                # Replace the values in the result list
                for new_value, original_index in zip(
                    reversed_segment, segment_indices, strict=False
                ):
                    result_list[original_index] = new_value

        return result_list, segments

    # Process the points and get segments information
    processed_data, segments = process_angle_based_segments(points)

    # Initialize new data list
    new_data = []

    for idx, (segment_indices, angle) in enumerate(segments):
        # Determine if it's a first or last segment
        is_edge_segment = (idx == 0) or (idx == len(segments) - 1)

        # Get segment points
        segment_points = [processed_data[i] for i in segment_indices]

        # Filter points outside the polygon
        segment_points = filter_points_in_polygon(
            segment_points, polygon, is_edge_segment
        )

        # Skip empty segments
        if not segment_points:
            continue

        # Calculate extra point before first point
        first_point = segment_points[0]
        shapely_point = first_point["coordinates"]
        start_x, start_y = shapely_point.x, shapely_point.y

        if angle == -90:
            start_x += forward_spacing
        elif angle == 90:
            start_x -= forward_spacing

        # Rotate the point using Shapely's rotate function
        rotated_start_point = rotate(
            Point(start_x, start_y),
            rotation_angle,
            origin=shapely_point,  # Rotate around the first point
            use_radians=False,
        )

        # Add start point
        new_data.append(
            {
                "coordinates": rotated_start_point,
                "angle": angle,
                "take_photo": False,
                "gimbal_angle": "-80",
            }
        )

        # Add all points in the segment
        for point in segment_points:
            new_data.append(
                {
                    "coordinates": point["coordinates"],
                    "angle": point["angle"],
                    "take_photo": True,
                    "gimbal_angle": "-80",
                }
            )

        # Calculate extra point after last point
        last_point = segment_points[-1]
        shapely_point = last_point["coordinates"]
        end_x, end_y = shapely_point.x, shapely_point.y

        if angle == -90:
            end_x -= forward_spacing
        elif angle == 90:
            end_x += forward_spacing

        # Rotate the point AFTER applying the offset
        rotated_end_point = rotate(
            Point(end_x, end_y),
            rotation_angle,
            origin=shapely_point,  # Rotate around the last point
            use_radians=False,
        )

        # Add end point
        new_data.append(
            {
                "coordinates": rotated_end_point,
                "angle": angle,
                "take_photo": False,
                "gimbal_angle": "-80",
            }
        )

    return new_data


def generate_3d_waypoints(
    row_points: list[Point], row_index: int, angle: int
) -> list[dict]:
    """Generate additional 3D waypoints by alternating the gimbal angle for each row.

    Parameters:
        row_points (list[Point]): A list of Points in the current row.
        row_index (int): The index of the current row.
        angle (int): The angle at which the gimbal should be tilted.

    Returns:
        list[dict]: A list of dictionaries representing the additional 3D waypoints.
    """
    # Return path with -45 degree angle
    return_path = [
        {
            "coordinates": wp,
            "angle": str(-angle),
            "take_photo": True,
            "gimbal_angle": (
                "-45" if row_index % 2 == 0 else "45"
            ),  # Alternate angles based on row index
        }
        for wp in reversed(row_points)
    ]
    return_path[0]["take_photo"] = False
    return_path[-1]["take_photo"] = False

    # Forward path with 45 degree angle
    forward_path = [
        {
            "coordinates": wp,
            "angle": str(angle),
            "take_photo": True,
            "gimbal_angle": (
                "45" if row_index % 2 == 0 else "-45"
            ),  # Alternate angles based on row index
        }
        for wp in row_points
    ]
    forward_path[0]["take_photo"] = False
    forward_path[-1]["take_photo"] = False

    return return_path + forward_path


def exclude_no_fly_zones(points: list[dict], no_fly_zones: list[Polygon]) -> list[dict]:
    """Exclude waypoints that fall within defined no-fly zones.

    Parameters:
        points (list[dict]): A list of waypoints.
        no_fly_zones (list[Polygon]): A list of Polygons representing no-fly zones.

    Returns:
        list[dict]: A list of waypoints excluding those within no-fly zones.
    """
    return [
        point
        for point in points
        if not any(nfz.contains(point["coordinates"]) for nfz in no_fly_zones)
    ]


def remove_middle_points(data):
    processed_data = []
    i = 0

    while i < len(data):
        current_angle = data[i]["angle"]
        segment_start = i

        # Find the end of the segment with the same angle
        while i < len(data) and data[i]["angle"] == current_angle:
            i += 1

        segment_end = i

        # If the segment has more than 4 points, keep only the first 2 and the last 2
        if segment_end - segment_start > 4:
            processed_data.extend(data[segment_start : segment_start + 2])
            processed_data.extend(data[segment_end - 2 : segment_end])
        else:
            processed_data.extend(data[segment_start:segment_end])

    # Make take_photo = False for all the points
    for point in processed_data:
        point["take_photo"] = False

    return processed_data


def create_waypoint(
    project_area: dict,
    agl: float,
    gsd: float,
    forward_overlap: float,
    side_overlap: float,
    rotation_angle: float = 0.0,
    generate_3d: bool = False,
    no_fly_zones: dict = None,
    take_off_point: list[float] = None,
    mode: str = "waylines",
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO,
) -> str:
    """Create waypoints or waylines for a given project area based on specified parameters.

    Parameters:
        project_area (dict): GeoJSON dictionary representing the project area.
        agl (float): Altitude above ground level.
        gsd (float): Ground Sampling Distance.
        forward_overlap (float): Forward overlap percentage for the waypoints.
        side_overlap (float): Side overlap percentage for the waypoints.
        rotation_angle (float): The rotation angle for the flight grid in degrees.
        generate_3d (bool): Flag to determine if 3D waypoints should be generated.
        no_fly_zones (dict, optional): GeoJSON dictionary representing no-fly zones.
        mode (str): "waypoints" for individual points, "waylines" for path lines.

    Returns:
        geojson: waypoints generated within the project area in the geojson format

    Example Response:
    {
        "type": "FeatureCollection",
            "features": [
                {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                    85.328347,
                    27.729837
                    ]
                },
                "properties": {
                    "index": 0,
                    "angle": "0",
                    "take_photo": false,
                    "gimbal_angle": "-90"
                }
            }
        }
    }

    """
    parameters = cp(forward_overlap, side_overlap, agl, gsd, drone_type)
    side_spacing = parameters["side_spacing"]
    forward_spacing = parameters["forward_spacing"]

    polygon = shape(project_area["features"][0]["geometry"])

    wgs84 = pyproj.CRS("EPSG:4326")
    web_mercator = pyproj.CRS("EPSG:3857")

    transformer_to_3857 = pyproj.Transformer.from_crs(
        wgs84, web_mercator, always_xy=True
    ).transform
    transformer_to_4326 = pyproj.Transformer.from_crs(
        web_mercator, wgs84, always_xy=True
    ).transform

    polygon_3857 = transform(transformer_to_3857, polygon)

    # Generate grid within the rotated AOI
    grid = generate_grid_in_aoi(
        polygon_3857, forward_spacing, side_spacing, rotation_angle
    )

    # Create path (either waypoints or waylines) and rotate back to original angle
    initial_path = create_path(
        grid,
        forward_spacing,
        rotation_angle,
        generate_3d=generate_3d,
        polygon=polygon_3857,
    )  # TODO: Make the gimbal angle dynamic

    # Path initialization
    path = []

    # Conditionally add takeoff point if available
    if take_off_point:
        # Get the first and last point of the initial path
        first_path_point = initial_path[0]["coordinates"]
        last_path_point = initial_path[-1]["coordinates"]

        # Calculate distances from the takeoff point
        distance_to_first = calculate_distance(
            Point(transformer_to_3857(*take_off_point)), first_path_point
        )
        distance_to_last = calculate_distance(
            Point(transformer_to_3857(*take_off_point)), last_path_point
        )
        if distance_to_last < distance_to_first:
            initial_path.reverse()

        initial_point = {
            "coordinates": Point(transformer_to_3857(*take_off_point)),
            "take_photo": False,
            "angle": 0,
            "gimbal_angle": "-80",  # TODO: Make it dynamic
        }
        path.append(initial_point)

    # Add the rest of the points with rotation
    path.extend(
        [
            {
                "coordinates": point["coordinates"],
                "angle": point["angle"],
                "take_photo": point["take_photo"],
                "gimbal_angle": point["gimbal_angle"],
            }
            for point in initial_path
        ]
    )

    # If mode is "waylines", simplify to only start and end points
    if mode == "waylines":
        waypoints = remove_middle_points(path)
    else:
        waypoints = path

    # If no-fly zones are provided, exclude points that fall inside no-fly zones
    if no_fly_zones:
        no_fly_polygons = [
            transform(transformer_to_3857, shape(zone["geometry"]))
            for zone in no_fly_zones["features"]
        ]
        waypoints = exclude_no_fly_zones(waypoints, no_fly_polygons)

    # Generate GeoJSON features
    features = []
    for index, wp in enumerate(waypoints):
        coordinates_4326 = transformer_to_4326(wp["coordinates"].x, wp["coordinates"].y)
        feature = geojson.Feature(
            geometry=geojson.Point(coordinates_4326),
            properties={
                "index": index,
                "heading": wp["angle"],
                "take_photo": wp["take_photo"],
                "gimbal_angle": wp["gimbal_angle"],
            },
        )
        features.append(feature)
    feature_collection = geojson.FeatureCollection(features)
    return geojson.dumps(feature_collection, indent=2)


def validate_coordinates(value):
    try:
        lon, lat = map(float, value.split(","))
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise argparse.ArgumentTypeError(
                "Coordinates must be in the format 'longitude,latitude' and within valid ranges."
            )
        return [lon, lat]
    except ValueError:
        raise argparse.ArgumentTypeError(
            "Invalid format. Coordinates must be in 'longitude,latitude' format."
        )


def main():
    """The main entry point of the script. Parses command-line arguments and
    generates waypoints for a drone mission based on the provided parameters.
    """
    parser = argparse.ArgumentParser(
        description="Generate waypoints for drone missions."
    )
    parser.add_argument(
        "--project_geojson_polygon",
        required=True,
        type=str,
        help="The GeoJSON polygon representing the area of interest.",
    )
    parser.add_argument(
        "--altitude_above_ground_level",
        required=True,
        type=float,
        help="The flight altitude in meters.",
    )
    parser.add_argument(
        "--forward_overlap",
        type=float,
        default=70.0,
        help="The forward overlap in percentage.",
    )
    parser.add_argument(
        "--side_overlap",
        type=float,
        default=70.0,
        help="The side overlap in percentage.",
    )
    parser.add_argument(
        "--rotation_angle",
        type=float,
        default=0.0,
        help="The rotation angle for the flight grid in degrees.",
    )
    parser.add_argument(
        "--generate_3d", action="store_true", help="Generate 3D imagery."
    )
    parser.add_argument(
        "--no_fly_zones", type=str, help="GeoJSON file containing no-fly zones."
    )
    parser.add_argument(
        "--output_file_path",
        type=str,
        required=True,
        help="The output GeoJSON file path for the waypoints.",
    )
    parser.add_argument(
        "--take_off_point",
        required=True,
        type=validate_coordinates,
        help="Take off Point Coordinates in 'longitude,latitude' format (e.g., 82.52,28.29).",
    )
    parser.add_argument(
        "--mode",
        default="waylines",
        type=str,
        help="Flight mode (waypoints or waylines).",
    )
    args = parser.parse_args()

    with open(args.project_geojson_polygon, "r") as f:
        boundary = geojson.load(f)

    no_fly_zones = None
    if args.no_fly_zones:
        with open(args.no_fly_zones, "r") as f:
            no_fly_zones = geojson.load(f)

    coordinates = create_waypoint(
        boundary,
        args.altitude_above_ground_level,
        None,  # GSD can be None if you calculate based on altitude
        args.forward_overlap,
        args.side_overlap,
        args.rotation_angle,
        args.generate_3d,
        no_fly_zones,
        args.take_off_point,
        args.mode,
    )

    with open(args.output_file_path, "w") as f:
        f.write(coordinates)

    return coordinates


if __name__ == "__main__":
    main()
