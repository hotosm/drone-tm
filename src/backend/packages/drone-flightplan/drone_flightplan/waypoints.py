import argparse
import logging
from math import sqrt, degrees, atan2
from typing import Optional

import geojson
import pyproj
from shapely.affinity import rotate
from shapely.geometry import Point, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.enums import GimbalAngle
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
    aoi_polygon: BaseGeometry,
    x_spacing: float,
    y_spacing: float,
    rotation_angle: float = 0.0,
    side_overlap: float = 70.0,
) -> list[dict[str, object]]:
    """Generate an optimized grid of points within a given Area of Interest (AOI) polygon.

    This function creates a grid of flight waypoints inside an AOI polygon,
    accounting for rotation and ensuring proper coverage based on the side overlap
    parameter. The grid is optimized to avoid unnecessary waypoints at corners
    while maintaining the required photo overlap at all polygon edges.

    Parameters:
        aoi_polygon (BaseGeometry): The Shapely polygon representing the area of interest.
        x_spacing (float): Spacing between points along the x-axis (in meters).
        y_spacing (float): Spacing between waylines along the y-axis (in meters).
        rotation_angle (float, optional): Angle (in degrees) to rotate the flight grid
            around the AOI centroid. Defaults to 0.0.
        side_overlap (float, optional): Side overlap percentage (e.g., 70 means 70% overlap).
            Defaults to 70.0.

    Returns:
        list[dict]: A list of dictionaries with:
            - "coordinates": The Shapely Point of the waypoint.
            - "angle": The flight direction (alternating -90 / +90 degrees per row).
    """
    # Calculate the minimum acceptable distance from waypoints to polygon edges
    # based on the required side overlap percentage
    # E.g., if side_overlap is 70%, we need points within 30% of y_spacing from edges
    overlap_threshold = y_spacing * (1 - side_overlap / 100)

    # Add a buffer to include edge points during containment tests
    # This ensures we capture waypoints near the polygon boundary
    buffered_polygon = add_buffer_to_aoi(aoi_polygon, x_spacing * 0.5)

    # Get the centroid for rotation operations
    centroid = aoi_polygon.centroid

    # Rotate the AOI polygon to align with the desired flight direction
    rotated_polygon = rotate(
        aoi_polygon, rotation_angle, origin=centroid, use_radians=False
    )

    # Get the bounding box of the rotated polygon
    # We use only the rotated bounds for a tighter, more efficient grid
    minx, miny, maxx, maxy = rotated_polygon.bounds

    # Add strategic padding to ensure corner coverage
    # The padding accounts for the maximum distance corners might be from waylines
    # after rotation, based on the diagonal extent of a grid cell
    corner_padding = sqrt(x_spacing**2 + y_spacing**2) * 0.5
    minx -= corner_padding
    miny -= corner_padding
    maxx += corner_padding
    maxy += corner_padding

    # Calculate the number of grid points needed along each axis
    xpoints = int((maxx - minx) / x_spacing) + 1
    ypoints = int((maxy - miny) / y_spacing) + 1

    points: list[dict] = []
    current_axis = "x"  # Used to alternate flight direction between rows

    # Generate the base flight grid
    for yi in range(ypoints):
        for xi in range(xpoints):
            # Calculate position in the rotated coordinate system
            x = minx + xi * x_spacing
            y = miny + yi * y_spacing
            unrotated_point = Point(x, y)

            # Rotate the point back around the AOI centroid to get final position
            rotated_point = rotate(
                unrotated_point, rotation_angle, origin=centroid, use_radians=False
            )

            # Alternate flight direction between waylines
            # -90 degrees for even rows, +90 degrees for odd rows
            angle = -90 if current_axis == "x" else 90

            # Only include points that fall inside the buffered AOI
            if buffered_polygon.contains(rotated_point):
                points.append({"coordinates": rotated_point, "angle": angle})

        # Switch flight direction for the next row
        current_axis = "y" if current_axis == "x" else "x"

    # Verify corner coverage to ensure required overlap at all edges
    # For rotated grids, corners can sometimes fall outside the coverage area
    # of the nearest wayline, creating gaps in photo overlap
    corners = [
        Point(aoi_polygon.bounds[0], aoi_polygon.bounds[1]),  # Bottom-left
        Point(aoi_polygon.bounds[0], aoi_polygon.bounds[3]),  # Top-left
        Point(aoi_polygon.bounds[2], aoi_polygon.bounds[1]),  # Bottom-right
        Point(aoi_polygon.bounds[2], aoi_polygon.bounds[3]),  # Top-right
    ]

    if not points:
        return points

    # Extract point geometries for distance calculations
    point_coords = [p["coordinates"] for p in points]
    corners_missing_coverage = []

    # Check each corner to see if it has adequate coverage
    for corner in corners:
        # Find the nearest waypoint to this corner
        nearest_point = min(point_coords, key=lambda p: corner.distance(p))
        dist = corner.distance(nearest_point)

        # If the corner is too far from the nearest waypoint,
        # it won't have the required photo overlap
        if dist > overlap_threshold:
            corners_missing_coverage.append(corner)

    # Add targeted waypoints to cover any under-covered corners
    # Instead of adding entire waylines, we add only the specific points needed
    if corners_missing_coverage:
        log.info(
            f"Adding {len(corners_missing_coverage)} targeted waypoints "
            f"to ensure {side_overlap}% overlap at corners"
        )

        # For each under-covered corner, find the optimal wayline position
        for corner in corners_missing_coverage:
            # Determine which direction to extend the grid
            # Based on whether the corner is closer to min or max bounds
            rotated_corner = rotate(
                corner, -rotation_angle, origin=centroid, use_radians=False
            )

            # Calculate the y-coordinate for a new wayline near this corner
            # Snap to the nearest grid line position
            new_y = miny + round((rotated_corner.y - miny) / y_spacing) * y_spacing

            # Determine the flight angle for this new wayline
            # based on its index in the grid
            yi = round((new_y - miny) / y_spacing)
            current_axis = "x" if yi % 2 == 0 else "y"
            angle = -90 if current_axis == "x" else 90

            # Generate points along this new wayline
            for xi in range(xpoints):
                x = minx + xi * x_spacing
                unrotated_point = Point(x, new_y)
                rotated_point = rotate(
                    unrotated_point, rotation_angle, origin=centroid, use_radians=False
                )

                # Only add if inside the buffered polygon and not a duplicate
                if buffered_polygon.contains(rotated_point):
                    # Check if this point is too close to existing points
                    is_duplicate = any(
                        rotated_point.distance(p["coordinates"]) < x_spacing * 0.1
                        for p in points
                    )
                    if not is_duplicate:
                        points.append({"coordinates": rotated_point, "angle": angle})

    return points


def calculate_distance(point1, point2):
    """Calculate Euclidean distance between two points."""
    return sqrt((point1.x - point2.x) ** 2 + (point1.y - point2.y) ** 2)


def calculate_optimal_rotation_angle(polygon: BaseGeometry) -> float:
    """Calculate the optimal rotation angle based on the polygon's longest edge.

    This function finds the minimum rotated rectangle (oriented bounding box)
    that contains the polygon, then returns the angle of the longest edge.
    Flying along the longest edge minimizes the number of turns required.

    Parameters:
        polygon (BaseGeometry): The Shapely polygon representing the area of interest.

    Returns:
        float: The rotation angle in degrees (0-180) aligned with the longest edge.
    """
    # Get the minimum rotated rectangle (oriented bounding box)
    min_rect = polygon.minimum_rotated_rectangle

    # Get the coordinates of the rectangle
    coords = list(min_rect.exterior.coords)

    # Calculate edge lengths and their angles
    edges = []
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]

        # Calculate edge length
        length = sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

        # Calculate angle in degrees
        angle = degrees(atan2(y2 - y1, x2 - x1))

        edges.append((length, angle))

    # Find the longest edge
    longest_edge = max(edges, key=lambda x: x[0])
    angle = longest_edge[1]

    # Normalize angle to 0-180 range (since 0° and 180° are the same flight direction)
    # Also, we want the angle that aligns with the X-axis of our grid
    if angle < 0:
        angle += 180

    # The grid is naturally aligned along the x-axis (0°)
    # So we return the angle needed to rotate the polygon to align its longest edge with x-axis
    # which is the negative of the edge angle
    rotation_angle = -angle

    # Normalize to -180 to 180 range
    if rotation_angle < -180:
        rotation_angle += 360
    elif rotation_angle > 180:
        rotation_angle -= 360

    return rotation_angle


def create_path(
    points: list[Point],
    forward_spacing: float,
    rotation_angle: float = 0.0,
    generate_3d: bool = False,
    take_off_point: list[float] = None,
    polygon: Optional[Polygon] = None,
    gimbal_angle: GimbalAngle = GimbalAngle.OFF_NADIR,
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

    def filter_points_in_polygon(segment_points, polygon, is_edge_segment=False):
        """Filter points outside the given polygon. If more than 2 points are outside the polygon.

        We need this because not all AOIs are rectangular. For example if the AOI is irregular,
        then the two point buffer may have more than 2 points in certain parts and we need to clip
        to ensure two points only.
        """
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
                "gimbal_angle": gimbal_angle.value,
            }
        )

        # Add all points in the segment
        for point in segment_points:
            new_data.append(
                {
                    "coordinates": point["coordinates"],
                    "angle": point["angle"],
                    "take_photo": True,
                    "gimbal_angle": gimbal_angle.value,
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
                "gimbal_angle": gimbal_angle.value,
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
    # TODO incorporate this somewhere? Useful logic

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


def remove_middle_points(data: dict):
    if not data:
        return []

    processed_data = []
    i = 0

    while i < len(data):
        current_angle = data[i]["angle"]
        segment_start = i

        # Find the end of the segment with the same angle
        while i < len(data) and data[i]["angle"] == current_angle:
            i += 1

        segment_end = i
        segment_length = segment_end - segment_start

        # Reduce the segment length to only two points (start and end)
        if segment_length > 2:
            # first point
            processed_data.extend(data[segment_start : segment_start + 1])
            # last point
            processed_data.extend(data[segment_end - 1 : segment_end])
        else:
            processed_data.extend(data[segment_start:segment_end])

    # Make take_photo = False for all the points
    # (instead we use manual shutter interval of 2s, set by user)
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
    gimbal_angle: GimbalAngle = GimbalAngle.OFF_NADIR,
    auto_rotation: bool = True,
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
        drone_type (DroneType): the drone to create the flightplan for.
        gimbal_angle (GimbalAngle): the gimbal angle to set for the flight.
        auto_rotation (bool): If True and rotation_angle is 0.0 or 360.0, automatically
            align flight path with the longest edge of the polygon. Defaults to True.

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
    parameters = calculate_parameters(
        forward_overlap,
        side_overlap,
        agl,
        gsd,
        drone_type=drone_type,
    )

    side_spacing = parameters["side_spacing"]
    forward_spacing = parameters["forward_spacing"]

    # Handle FeatureCollection, Feature, Polygon
    if "features" in project_area:
        polygon = shape(project_area["features"][0]["geometry"])
    elif "geometry" in project_area:
        polygon = shape(project_area["geometry"])
    else:
        polygon = shape(project_area)

    wgs84 = pyproj.CRS("EPSG:4326")
    web_mercator = pyproj.CRS("EPSG:3857")

    transformer_to_3857 = pyproj.Transformer.from_crs(
        wgs84, web_mercator, always_xy=True
    ).transform
    transformer_to_4326 = pyproj.Transformer.from_crs(
        web_mercator, wgs84, always_xy=True
    ).transform

    polygon_3857 = transform(transformer_to_3857, polygon)

    # Auto-calculate optimal rotation angle if not specified
    if rotation_angle in [0.0, 360.0] and auto_rotation:
        rotation_angle = calculate_optimal_rotation_angle(polygon_3857)
        log.info(f"Auto-calculated optimal rotation angle: {rotation_angle:.2f}°")

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
        gimbal_angle=gimbal_angle,
    )

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
            "gimbal_angle": gimbal_angle.value,
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
    parser.add_argument(
        "--auto_rotation",
        action="store_true",
        default=True,
        help="Automatically align flight path with longest edge when rotation_angle is 0.",
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
        auto_rotation=args.auto_rotation,
    )

    with open(args.output_file_path, "w") as f:
        f.write(coordinates)

    return coordinates


if __name__ == "__main__":
    main()
