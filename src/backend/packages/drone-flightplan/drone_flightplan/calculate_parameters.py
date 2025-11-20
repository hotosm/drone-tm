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
    """A helper function to calculate constants for a new drone added."""
    # Sensor calcs
    sensor_diagonal_mm = math.sqrt(sensor_width_mm**2 + sensor_height_mm**2)
    sensor_crop_factor = 43.27 / sensor_diagonal_mm
    actual_focal_length_mm = equiv_focal_length_mm / sensor_crop_factor

    # For degrees, simply: horizontal_fov_rad * 180 / math.pi
    horizontal_fov_rads = 2 * math.atan(sensor_width_mm / (2 * actual_focal_length_mm))
    vertical_fov_rads = 2 * math.atan(sensor_height_mm / (2 * actual_focal_length_mm))
    # mm --> cm to match GSD in cm/px (the *100 in formula)
    gsd_to_agl_const = (actual_focal_length_mm * image_width_px) / (
        sensor_width_mm * 100
    )

    print(f"Actual focal length:  {actual_focal_length_mm:.2f}mm")
    print(f"Horizontal FOV:       {horizontal_fov_rads:.2f}rad")
    print(f"Vertical FOV:         {vertical_fov_rads:.2f}rad")
    print(f"GSD To AGL Const:     {gsd_to_agl_const}")


def calculate_adjusted_max_battery_life(drone_type: DroneType, ground_speed: float) -> float:
    """
    Calculates the adjusted max battery life based on ground speed using a simplified power model.

    This model assumes that the total power consumption of the drone is the sum of
    power required for hovering and power required to overcome drag.
    P_total = P_hover + P_drag

    - We assume P_drag is proportional to the square of the velocity (a common simplification).
    - We use the manufacturer's spec (quoted battery life at a given testing speed) as a
      reference point.
    - We also need to assume a ratio for P_hover vs P_drag at that reference speed. A ratio
      of 2:1 (hover to drag) is chosen as a reasonable starting point for many quadcopters
      at moderate speeds.
    - Wind and temperature are not factored in.
    
    Simplified power model: P_total = P_hover + k * v^2
    Energy E = P_total * T
    So, T = E / (P_hover + k * v^2)

    Assume P_hover is 2/3 and P_drag is 1/3 of total power at v_test_mps.
    This is a reasonable assumption for moderate speeds.
    P_total_test = P_hover + k * v_test_mps^2
    P_hover = 2 * k * v_test_mps^2
    So, P_total_test = 3 * k * v_test_mps^2
    And E = T_quoted * 3 * k * v_test_mps^2

    Now calculate time at the mission ground_speed (v_g)
    T_adjusted = E / (P_hover + k * v_g^2)
    T_adjusted = (T_quoted * 3 * k * v_test_mps^2) / (2 * k * v_test_mps^2 + k * ground_speed^2)
    The 'k' constant cancels out.
    T_adjusted = T_quoted * (3 * v_test_mps^2) / (2 * v_test_mps^2 + ground_speed^2)

    Args:
        drone_type: The type of drone.
        ground_speed: The ground speed of the drone in m/s.

    Returns:
        The estimated adjusted max battery life in minutes.
    """
    drone_specs = DRONE_SPECS[drone_type]
    battery_specs = drone_specs.get("max_battery_life_minutes")

    if not battery_specs:
        return 0.0

    t_quoted = battery_specs["quoted_value"]
    v_test_kmh = battery_specs["testing_speed"]
    v_test_mps = v_test_kmh / 3.6

    if v_test_mps == 0:
        return t_quoted

    numerator = 3 * (v_test_mps**2)
    denominator = 2 * (v_test_mps**2) + ground_speed**2

    if denominator == 0:
        return 0.0

    adjusted_max_battery_life = t_quoted * (numerator / denominator)

    return adjusted_max_battery_life


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

    Forward Photo height = AGL * Vertical_FOV
    Side Photo width = AGL * Horizontal_FOV
    forward overlap distance =  forward photo height * forward overlap
    side overlap distance = side photo width * side overlap
    forward spacing =  forward photo height - forward overlap distance
    side spacing = side photo width - side overlap distance
    ground speed = forward spacing / image interval
    """
    # Get the drone specifications from the Enum
    drone_specs = DRONE_PARAMS[drone_type]
    VERTICAL_FOV = drone_specs["VERTICAL_FOV"]
    HORIZONTAL_FOV = drone_specs["HORIZONTAL_FOV"]
    GSD_TO_AGL_CONST = drone_specs["GSD_TO_AGL_CONST"]

    if gsd:
        agl = gsd * GSD_TO_AGL_CONST

    # Calculations
    forward_photo_height = agl * VERTICAL_FOV
    side_photo_width = agl * HORIZONTAL_FOV
    forward_overlap_distance = forward_photo_height * forward_overlap / 100
    side_overlap_distance = side_photo_width * side_overlap / 100
    forward_spacing = forward_photo_height - forward_overlap_distance
    side_spacing = side_photo_width - side_overlap_distance
    ground_speed = forward_spacing / image_interval

    # While Mini 4 Pro can go 12m/s and Mini 5 Pro 15m/s, we cap the ground speed at 11.5 m/s to
    # avoid problems with the RC2 controller.
    # Speeds over 12 m/s cause the controller to change the speed to 2.5 m/s, which is too slow.
    # Keeping it below 12 m/s ensures the flight plan works correctly.
    if ground_speed > 12 and (
        drone_type
        in [DroneType.DJI_MINI_5_PRO, DroneType.DJI_MINI_4_PRO, DroneType.DJI_AIR_3]
    ):
        ground_speed = 11.5
    elif drone_type == DroneType.POTENSIC_ATOM_2:
        # This seems to be the max speed for the Potensic Atom 2
        ground_speed = 8.0
    else:
        # FIXME what should be the default?
        ground_speed = 11.5

    adjusted_max_battery_life = calculate_adjusted_max_battery_life(
        drone_type, ground_speed
    )

    return {
        "forward_photo_height": round(forward_photo_height, 0),
        "side_photo_width": round(side_photo_width, 0),
        "forward_spacing": round(forward_spacing, 2),
        "side_spacing": round(side_spacing, 2),
        "ground_speed": round(ground_speed, 2),
        "altitude_above_ground_level": agl,
        "adjusted_max_battery_life": round(adjusted_max_battery_life, 2),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate parameters for a drone which can be used for flight plans.",
        formatter_class=argparse.RawTextHelpFormatter,
    )

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
