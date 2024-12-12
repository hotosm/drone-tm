import math
import requests
import uuid
from shapely.geometry import Point, Polygon
from typing import List, Dict, Tuple
from app.s3 import get_presigned_url
from app.waypoints import waypoint_schemas
from app.config import settings
from pyproj import Transformer
from loguru import logger as log


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
    try:
        response = requests.get(url)
        response.raise_for_status()  # Raise an exception for HTTP errors
        return response.json()
    except Exception as e:
        log.warning(f"Error fetching JSON file: {e}")
        return None


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


async def calculate_bbox_from_images_file(
    images_json_url: str, fov_degree: float, altitude: float
):
    """
    Create bounding boxes for all images from a presigned JSON file URL.
    """
    # Fetch the JSON data from the presigned URL
    images = fetch_json_from_presigned_url(images_json_url)

    # Calculate bounding boxes for each image
    bounding_boxes = {}
    for image in images or []:
        filename = image["filename"]
        lat = image["latitude"]
        lon = image["longitude"]
        width = image["width"]
        height = image["height"]

        aspect_ratio = width / height

        bbox = await calc_bbox(lat, lon, altitude, fov_degree, aspect_ratio)
        bounding_boxes[filename] = bbox
    return bounding_boxes


async def calculate_footprints_of_image(altitude, fov_in_degree, aspect_ratio):
    """
    Calculate the width (A) and height (B) of an image given:
    - altitude: Drone height
    - fov_in_degree: Field of View (in degrees)
    - aspect_ratio: Aspect Ratio (width/height)

    The calculations is done based on this blog post:
    https://www.techforwildlife.com/blog/2019/1/29/calculating-a-drone-cameras-image-footprint

    Returns:
    - Width of the image , Height of the image
    """
    # Convert theta from degrees to radians
    fov_in_radian = math.radians(fov_in_degree)

    # Calculate the diagonal of the image (D)
    D = 2 * altitude * math.tan(fov_in_radian / 2)

    # Calculate width of the image
    width = D / math.sqrt(1 + aspect_ratio**2)

    # Calculate height of the image
    height = (aspect_ratio * D) / math.sqrt(1 + aspect_ratio**2)

    return width, height


async def calc_bbox(lat, long, altitude, fov_degree, aspect_ratio):
    # Define the bounding box coordinates in EPSG:3857
    # Update offset function to work with EPSG:3857 coordinates
    async def offset_coordinates_3857(x, y, dx, dy):
        """
        Calculate new coordinates in EPSG:3857 given distance offsets.
        """
        new_x = x + dx
        new_y = y + dy
        return new_x, new_y

    # Initialize transformer for WGS84 to EPSG:3857 and vice versa
    wgs84_to_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    epsg_3857_to_wgs84 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

    # Convert centroid coordinates to EPSG:3857
    centroid_3857 = wgs84_to_3857.transform(long, lat)

    # Calculate the width and height of the image footprint
    footprint_width, footprint_height = await calculate_footprints_of_image(
        altitude, fov_degree, aspect_ratio
    )

    # Calculate half-width and half-height in meters (same as before)
    half_width = footprint_width / 2
    half_height = footprint_height / 2

    # Calculate the four corners in EPSG:3857
    top_left_3857 = await offset_coordinates_3857(
        centroid_3857[0], centroid_3857[1], -half_width, half_height
    )
    top_right_3857 = await offset_coordinates_3857(
        centroid_3857[0], centroid_3857[1], half_width, half_height
    )
    bottom_right_3857 = await offset_coordinates_3857(
        centroid_3857[0], centroid_3857[1], half_width, -half_height
    )
    bottom_left_3857 = await offset_coordinates_3857(
        centroid_3857[0], centroid_3857[1], -half_width, -half_height
    )

    # Convert corners back to WGS84
    top_left_wgs84 = epsg_3857_to_wgs84.transform(top_left_3857[0], top_left_3857[1])
    top_right_wgs84 = epsg_3857_to_wgs84.transform(top_right_3857[0], top_right_3857[1])
    bottom_right_wgs84 = epsg_3857_to_wgs84.transform(
        bottom_right_3857[0], bottom_right_3857[1]
    )
    bottom_left_wgs84 = epsg_3857_to_wgs84.transform(
        bottom_left_3857[0], bottom_left_3857[1]
    )

    # Extract longitude and latitude values
    longitudes = [
        top_left_wgs84[0],
        top_right_wgs84[0],
        bottom_right_wgs84[0],
        bottom_left_wgs84[0],
    ]
    latitudes = [
        top_left_wgs84[1],
        top_right_wgs84[1],
        bottom_right_wgs84[1],
        bottom_left_wgs84[1],
    ]

    # Calculate the bounding box: [min_longitude, min_latitude, max_longitude, max_latitude]
    bbox = [
        min(longitudes),  # min_longitude
        min(latitudes),  # min_latitude
        max(longitudes),  # max_longitude
        max(latitudes),  # max_latitude
    ]

    return bbox


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


async def find_images_in_a_project_for_point(
    project_id: uuid.UUID,
    task_id_list: List[uuid.UUID],
    point: waypoint_schemas.PointField,
    fov_degree: float,
    altitude: float,
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

    # Extract the longitude and latitude of the point
    point_tuple = (point.longitude, point.latitude)

    # Find the matching images from each task
    images_list = []
    for task_id in task_id_list:
        task_id_str = str(task_id[0])
        s3_images_json_path_for_task = (
            f"dtm-data/projects/{project_id}/{task_id_str}/images.json"
        )
        s3_images_json_url = get_presigned_url(
            settings.S3_BUCKET_NAME, s3_images_json_path_for_task
        )

        # Fetch bounding boxes from the `images.json` file
        bbox_list = await calculate_bbox_from_images_file(
            s3_images_json_url, fov_degree, altitude
        )

        # Find images whose bounding boxes contain the given point
        matching_images = await find_matching_images_that_contains_point(
            bbox_list, point_tuple
        )
        images_list += [f"{task_id_str}/images/{image}" for image in matching_images]

    # Generate pre-signed URLs for the matching images
    presigned_urls = [
        get_presigned_url(
            settings.S3_BUCKET_NAME,
            f"dtm-data/projects/{project_id}/{image}",
        )
        for image in images_list
    ]

    return presigned_urls


async def find_images_in_a_task_for_point(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    point: waypoint_schemas.PointField,
    fov_degree: float,
    altitude: float,
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
    bbox_list = await calculate_bbox_from_images_file(
        s3_images_json_url, fov_degree, altitude
    )

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
