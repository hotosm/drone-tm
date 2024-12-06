import math
from shapely.geometry import Point, Polygon
from typing import List, Dict, Tuple


async def calculate_bounding_box(
    lat: float,
    long: float,
    width: float,
    height: float,
    focal_ratio: float,
    fnumber: float,
    altitude: float,
    sensor_width: float = 6.17,  # These are drone specific
    sensor_height: float = 4.55,  # These are drone specific
):
    """
    Calculate the geographic bounding box of an image taken by a drone.

    Args:
        lat (float): Latitude of the image center.
        long (float): Longitude of the image center.
        width (int): Image width in pixels.
        height (int): Image height in pixels.
        focal_ratio (float): Focal ratio of the camera.
        fnumber (float): Aperture number of the camera.
        altitude (float): Altitude of the drone in meters.
        sensor_width (float): Physical width of the sensor in mm (default: 6.17mm).
        sensor_height (float): Physical height of the sensor in mm (default: 4.55mm).

    Returns:
        dict: Bounding box with north, south, east, west bounds.
    """
    # Convert sensor dimensions to meters
    sensor_width_m = sensor_width / 1000
    sensor_height_m = sensor_height / 1000

    # Calculate the focal length in meters
    focal_length = fnumber * focal_ratio

    # Calculate GSD (Ground Sampling Distance)
    gsd_width = (sensor_width_m * altitude) / (focal_length * width)
    gsd_height = (sensor_height_m * altitude) / (focal_length * height)

    # Calculate the ground coverage of the image
    coverage_width = gsd_width * width
    coverage_height = gsd_height * height

    # Earth radius in meters
    earth_radius = 6378137

    # Calculate latitudinal and longitudinal offsets
    delta_lat = (coverage_height / 2) / earth_radius * (180 / math.pi)
    delta_lon = (
        (coverage_width / 2)
        / (earth_radius * math.cos(math.radians(lat)))
        * (180 / math.pi)
    )

    # Bounding box coordinates
    north = lat + delta_lat
    south = lat - delta_lat
    east = long + delta_lon
    west = long - delta_lon

    return {"north": north, "south": south, "east": east, "west": west}


def calculate_image_footprint(
    altitude: float, fov_deg: float, aspect_ratio: float
) -> tuple[float, float]:
    """
    Calculate the ground footprint of an image captured by a drone camera.

    Parameters:
        altitude (float): Altitude of the drone in meters.
        fov_deg (float): Field of view (FoV) of the camera in degrees.
        aspect_ratio (float): Aspect ratio of the camera's sensor (width/height).

    Returns:
        tuple[float, float]: Width and height of the image footprint on the ground in meters.
    """
    # Convert FoV from degrees to radians
    fov_rad = math.radians(fov_deg)

    # Calculate the diagonal footprint on the ground
    diagonal_footprint = 2 * altitude * math.tan(fov_rad / 2)

    # Calculate width and height of the footprint
    width = diagonal_footprint / math.sqrt(1 + aspect_ratio**2)
    height = aspect_ratio * width

    return width, height


def find_images_with_coordinate(
    bounding_boxes: Dict[str, Tuple[float, float, float, float]],
    gps_coordinate: Tuple[float, float],
) -> List[str]:
    """
    Find images whose bounding boxes contain the specified GPS coordinate.

    Parameters:
        bounding_boxes (Dict[str, Tuple[float, float, float, float]]):
            A dictionary where keys are image filenames, and values are bounding box coordinates
            as (min_longitude, min_latitude, max_longitude, max_latitude).
        gps_coordinate (Tuple[float, float]):
            A GPS coordinate as a tuple (longitude, latitude).

    Returns:
        List[str]: A list of image filenames whose bounding boxes contain the GPS coordinate.
    """
    matching_images: List[str] = []
    point = Point(
        gps_coordinate
    )  # Create a point for the GPS coordinate (longitude, latitude)

    for filename, bbox in bounding_boxes.items():
        min_lon, min_lat, max_lon, max_lat = bbox
        # Create a polygon for the bounding box
        polygon = Polygon(
            [
                (min_lon, min_lat),
                (min_lon, max_lat),
                (max_lon, max_lat),
                (max_lon, min_lat),
                (min_lon, min_lat),
            ]
        )
        # Check if the point is within the polygon
        if polygon.contains(point):
            matching_images.append(filename)

    return matching_images
