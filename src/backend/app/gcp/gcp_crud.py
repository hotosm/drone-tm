import math
import requests
import uuid
from shapely.geometry import Point, Polygon
from typing import List, Dict, Tuple
from app.s3 import get_presigned_url
from app.waypoints import waypoint_schemas
from app.config import settings


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
) -> List[float]:
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

    return [west, south, east, north]


def fetch_json_from_presigned_url(url: str):
    """
    Fetch a JSON file from an AWS presigned URL.
    """
    response = requests.get(url)
    response.raise_for_status()  # Raise an exception for HTTP errors
    return response.json()


async def find_matching_images_that_contains_point(bounding_boxes, gps_coordinate):
    """
    Find images whose bounding boxes contain the specified GPS coordinate.
    """
    matching_images = []
    point = Point(gps_coordinate)  # Longitude, Latitude format
    for filename, bbox in bounding_boxes.items():
        min_lon, min_lat, max_lon, max_lat = bbox
        polygon = Polygon(
            [
                (min_lon, min_lat),
                (min_lon, max_lat),
                (max_lon, max_lat),
                (max_lon, min_lat),
                (min_lon, min_lat),
            ]
        )

        if polygon.contains(point):
            matching_images.append(filename)
    return matching_images


async def calculate_bbox_from_images_file(images_json_url: str):
    """
    Create bounding boxes for all images from a presigned JSON file URL.
    """
    # Fetch the JSON data from the presigned URL
    images = fetch_json_from_presigned_url(images_json_url)

    # Calculate bounding boxes
    bounding_boxes = {}
    for image in images:
        filename = image["filename"]
        lat = image["latitude"]
        lon = image["longitude"]
        altitude = image["altitude"]
        width = image["width"]
        height = image["height"]
        focal_ratio = image["focal_ratio"]
        fnumber = image["fnumber"]

        # Calculate the bounding box
        bbox = await calculate_bounding_box(
            lat, lon, width, height, focal_ratio, fnumber, altitude
        )
        bounding_boxes[filename] = bbox

    return bounding_boxes


async def calculate_image_footprint(
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


async def process_images_for_point(
    project_id: uuid.UUID, task_id: uuid.UUID, point: waypoint_schemas.PointField
) -> List[str]:
    """
    Process images to find those containing a specific point and return their pre-signed URLs.

    Args:
        project_id (uuid.UUID): The ID of the project.
        task_id (uuid.UUID): The ID of the task.
        point (waypoint_schemas.PointField): The point to check.

    Returns:
        List[str]: A list of pre-signed URLs for matching images.
    """

    # S3 path for the `images.json` file provided by ODM
    s3_images_json_path = f"dtm-data/projects/{project_id}/{task_id}/images.json"

    # Generate pre-signed URL for the `images.json` file
    s3_images_json_url = get_presigned_url(settings.S3_BUCKET_NAME, s3_images_json_path)

    # Fetch bounding boxes from the `images.json` file
    bbox_list = await calculate_bbox_from_images_file(s3_images_json_url)

    # Extract the longitude and latitude of the point
    point_tuple = (point.longitude, point.latitude)

    # Find images whose bounding boxes contain the given point
    matching_images = await find_matching_images_that_contains_point(
        bbox_list, point_tuple
    )

    # Generate pre-signed URLs for the matching images
    presigned_urls = [
        get_presigned_url(
            settings.S3_BUCKET_NAME,
            f"dtm-data/projects/{project_id}/{task_id}/images/{image}",
        )
        for image in matching_images
    ]

    return presigned_urls
