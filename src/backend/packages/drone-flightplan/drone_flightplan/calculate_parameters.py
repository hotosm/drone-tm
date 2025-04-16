import argparse
import logging
from drone_flightplan.drone_type import DroneType

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)


def calculate_parameters(
    forward_overlap: float,
    side_overlap: float,
    agl: float,
    gsd: float = None,
    image_interval: int = 2,
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO,
):
    """Parameters
    ---------------------------------
    AGL(Altitude above ground level in meter ) = 115
    Forward overlap = 75
    Side overlap = 75

    ## Fixed Parameters
    Image interval = 2 sec
    Vertical FOV = 0.71
    Horizontal FOV = 1.26

    Forward Photo height = AGL * Vertical_FOV = 115*0.71 = 81.65
    Side Photo width = AGL * Horizontal_FOV = 115*1.26 = 144
    forward overlap distance =  forward photo height * forward overlap = 75 / 100 * 81.65 = 61.5
    side overlap distance = side photo width * side overlap = 75 / 100 * 144 = 108
    forward spacing =  forward photo height - forward overlap distance = 81.65 - 61.5 = 20.15
    side spacing = side photo width - side overlap distance = 144 - 108 = 36
    ground speed = forward spacing / image interval = 10

    """
    # Get the drone specifications from the Enum
    drone_specs = drone_type.value
    VERTICAL_FOV = drone_specs["VERTICAL_FOV"]
    HORIZONTAL_FOV = drone_specs["HORIZONTAL_FOV"]
    GSD_to_AGL_CONST = drone_specs["GSD_to_AGL_CONST"]

    if gsd:
        agl = gsd * GSD_to_AGL_CONST

    # Calculations
    forward_photo_height = agl * VERTICAL_FOV
    side_photo_width = agl * HORIZONTAL_FOV
    forward_overlap_distance = forward_photo_height * forward_overlap / 100
    side_overlap_distance = side_photo_width * side_overlap / 100
    forward_spacing = forward_photo_height - forward_overlap_distance
    side_spacing = side_photo_width - side_overlap_distance
    ground_speed = forward_spacing / image_interval

    # Cap ground speed at 11.5 m/s to avoid problems with the DJI Mini 4 Pro controller.
    # Speeds over 12 m/s cause the controller to change the speed to 2.5 m/s, which is too slow.
    # Keeping it below 12 m/s ensures the flight plan works correctly.

    if ground_speed > 12:
        ground_speed = 11.5

    return {
        "forward_photo_height": round(forward_photo_height, 0),
        "side_photo_width": round(side_photo_width, 0),
        "forward_spacing": round(forward_spacing, 2),
        "side_spacing": round(side_spacing, 2),
        "ground_speed": round(ground_speed, 2),
        "altitude_above_ground_level": agl,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate parameters for a drone which can be used for flight plans."
    )

    group = parser.add_mutually_exclusive_group(required=True)

    parser.add_argument(
        "--drone_type",
        type=lambda dt: DroneType[dt.upper()],
        default=DroneType.DJI_MINI_4_PRO,
        help="The type of drone to use, e.g., DJI_MINI_4_PRO.",
    )
    group.add_argument(
        "--altitude_above_ground_level",
        type=float,
        help="The flight altitude in meters.",
    )
    group.add_argument(
        "--gsd",
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
        "--image_interval",
        type=int,
        default=2,
        help="The time interval between two consecutive images in seconds.",
    )

    args = parser.parse_args()

    results = calculate_parameters(
        args.forward_overlap,
        args.side_overlap,
        args.altitude_above_ground_level,
        args.gsd,
        args.image_interval,
        args.drone_type,
    )

    for key, value in results.items():
        log.info(f"{key}: {value}")

    return results


if __name__ == "__main__":
    main()
