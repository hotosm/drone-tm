import argparse
import logging
import math

from drone_flightplan.drone_type import (
    DroneType,
    DRONE_PARAMS,
    DRONE_SPECS,
    drone_type_arg,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)


def print_drone_calcs():

    """Print helpful internal stats for all supported drones."""

    for drone in DroneType:
        print("-----------------------------------------")
        print(f"-------------{drone.name}---------------")
        print("-----------------------------------------")

        stats = DRONE_SPECS[drone]
        _calculate_constants(
            stats["sensor_height_mm"],
            stats["sensor_width_mm"],
            stats["equiv_focal_length_mm"],
            stats["image_width_px"],
        )

        print("")
        print("")


def _calculate_constants(
    sensor_height_mm: float,
    sensor_width_mm: float,
    equiv_focal_length_mm: float,
    image_width_px: int,
):
    """A helper function to calculate constants for a new drone added.

    Prints:
    - Actual focal length
    - Field of View (FOV)
    - Constant used to convert GSD (ground sampling distance) to altitude
    """

    # Sensor calcs
    sensor_diagonal_mm = math.sqrt(sensor_width_mm**2 + sensor_height_mm**2)
    sensor_crop_factor = 43.27 / sensor_diagonal_mm
    actual_focal_length_mm = equiv_focal_length_mm / sensor_crop_factor

    # For degrees, simply: horizontal_fov_rad * 180 / math.pi
    horizontal_fov_rads = 2 * math.atan(sensor_width_mm / (2 * actual_focal_length_mm))
    vertical_fov_rads = 2 * math.atan(sensor_height_mm / (2 * actual_focal_length_mm))
    # mm --> cm to match GSD in cm/px (the *100 in formula)

    # This is used in altitude = gsd * constant
    gsd_to_agl_const = (actual_focal_length_mm * image_width_px) / (
        sensor_width_mm * 100
    )

    print(f"Actual focal length:  {actual_focal_length_mm:.2f}mm")
    print(f"Horizontal FOV:       {horizontal_fov_rads:.2f}rad")
    print(f"Vertical FOV:         {vertical_fov_rads:.2f}rad")
    print(f"GSD To AGL Const:     {gsd_to_agl_const}")


def calculate_parameters(
    forward_overlap: float,
    side_overlap: float,
    agl: float,
    gsd: float = None,
    image_interval: int = 2,
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO,
):
    """
    Converts drone specs + flight settings
    into forward spacing, side spacing, and speed.

    Parameters
    ---------------------------------
    AGL (Altitude above ground level in meter) = 115
    Forward overlap (% overlap between consecutive images along the flight path) = 75
    Side overlap (% overlap between adjacent rows of images) = 75

    ## Fixed Parameters
    Image interval (Time between consecutive images)= 2 sec
    Vertical FOV = 0.71
    Horizontal FOV = 1.26

    Forward Photo height = AGL * Vertical_FOV
    Side Photo width = AGL * Horizontal_FOV
    forward overlap distance =  forward photo height * forward overlap
    side overlap distance = side photo width * side overlap
    forward spacing =  forward photo height - forward overlap distance
    side spacing = side photo width - side overlap distance
    ground speed = forward spacing / image interval

    Returns:
        dict: 
            - forward_photo_height
            - side_photo_width
            - forward_spacing
            - side_spacing
            - ground_speed
            - altitude_above_ground_level   
    """

    # Get the drone specifications from the Enum
    drone_specs = DRONE_PARAMS[drone_type]
    VERTICAL_FOV = drone_specs["VERTICAL_FOV"]
    HORIZONTAL_FOV = drone_specs["HORIZONTAL_FOV"]
    GSD_TO_AGL_CONST = drone_specs["GSD_TO_AGL_CONST"]

    if gsd:
        agl = gsd * GSD_TO_AGL_CONST

    # Calculate dimensions of each image
    forward_photo_height = agl * VERTICAL_FOV
    side_photo_width = agl * HORIZONTAL_FOV

    # How much of that is overlap
    forward_overlap_distance = forward_photo_height * forward_overlap / 100
    side_overlap_distance = side_photo_width * side_overlap / 100

    # Remaining spacing between two images
    forward_spacing = forward_photo_height - forward_overlap_distance
    side_spacing = side_photo_width - side_overlap_distance

    # Drone speed
    ground_speed = forward_spacing / image_interval

    if (
        drone_type in [DroneType.DJI_MINI_4_PRO, DroneType.DJI_AIR_3]
        and ground_speed > 12
    ):
        # Cap ground speed at 11.5 m/s to avoid problems with the DJI Mini 4 Pro controller.
        # Speeds over 12 m/s cause the controller to change the speed to 2.5 m/s, which is too slow.
        # Keeping it below 12 m/s ensures the flight plan works correctly.
        ground_speed = 11.5
    elif drone_type == DroneType.POTENSIC_ATOM_2:
        # This seems to be the max speed for the Potensic Atom 2
        ground_speed = 8

    return {
        "forward_photo_height": round(forward_photo_height, 0),
        "side_photo_width": round(side_photo_width, 0),
        "forward_spacing": round(forward_spacing, 2),
        "side_spacing": round(side_spacing, 2),
        "ground_speed": round(ground_speed, 2),
        "altitude_above_ground_level": agl,
    }


def main():

    """

    Parses terminal arguments and prints out drone flight planning parameters.

    If you run this file from the terminal, it asks the user for:
    - Drone type
    - Either altitude or GSD
    - Overlap %
    - Time between images

    Then it prints the calculated parameters.
    """

    parser = argparse.ArgumentParser(
        description="Generate parameters for a drone which can be used for flight plans.",
        formatter_class=argparse.RawTextHelpFormatter,
    )

    # Takes either gsd or altitude
    group = parser.add_mutually_exclusive_group(required=True)

    parser.add_argument(
        "--drone_type",
        type=drone_type_arg,
        default=DroneType.DJI_MINI_4_PRO,
        help=(
            "The type of drone to use. Options:\n"
            + "\n".join(f"- {name}" for name in DroneType.__members__)
        ),
    )

    group.add_argument(
        "--altitude_above_ground_level",
        type=float,
        help="The flight altitude in meters.",
    )
    group.add_argument(
        "--gsd",
        type=float,
        help="The ground sampling distance in cm/px.",
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
        "--image_interval",
        type=int,
        default=2,
        help="The time interval between two consecutive images in seconds.",
    )

    # Parse all command-line arguments

    args = parser.parse_args()

    results = calculate_parameters(
        args.forward_overlap,
        args.side_overlap,
        args.altitude_above_ground_level,
        args.gsd,
        args.image_interval,
        args.drone_type,
    )

    # Print final outputs to terminal

    for key, value in results.items():
        log.info(f"{key}: {value}")

    return results

if __name__ == "__main__":
    main()
