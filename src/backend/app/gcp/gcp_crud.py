import math
from shapely.geometry import Point, Polygon


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


def find_images_with_coordinate(bounding_boxes, gps_coordinate):
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
