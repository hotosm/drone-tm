import argparse
from enum import Enum


class StrEnum(str, Enum):
    """Wrapper for string enums, until Python 3.11 upgrade."""

    pass


class DroneType(StrEnum):
    DJI_MINI_4_PRO = "DJI_MINI_4_PRO"
    DJI_AIR_3 = "DJI_AIR_3"
    DJI_MINI_5_PRO = "DJI_MINI_5_PRO"
    POTENSIC_ATOM_2 = "POTENSIC_ATOM_2"


DRONE_SPECS = {
    DroneType.DJI_MINI_4_PRO: {
        # 1/1.3-inch CMOS
        # 4:3 (or 16:9 cropped)
        "sensor_height_mm": 7.2,
        "sensor_width_mm": 9.6,
        "equiv_focal_length_mm": 24,
        "image_width_px": 4032,  # taken from actual files, at 12MP
    },
    DroneType.DJI_AIR_3: {
        # 1/1.3-inch CMOS
        # 4:3 (or 16:9 cropped)
        "sensor_height_mm": 7.2,
        "sensor_width_mm": 9.6,
        "equiv_focal_length_mm": 24,
        "image_width_px": 4032,  # at 12MP
    },
    DroneType.DJI_MINI_5_PRO: {
        # 1-inch CMOS
        # 4:3 (or 16:9 cropped)
        "sensor_height_mm": 9.6,
        "sensor_width_mm": 12.8,
        "equiv_focal_length_mm": 24,
        "image_width_px": 4032,  # at 12MP
    },
    DroneType.POTENSIC_ATOM_2: {
        # 1/2-inch CMOS
        # 4:3 (or 16:9 cropped)
        "sensor_height_mm": 4.80,
        "sensor_width_mm": 6.40,
        "equiv_focal_length_mm": 26,
        "image_width_px": 4608,
    },
}
# NOTE see calculate_parameters._calculate_constants
# 1. First get an accurate sensor width and height for the CMOS size
#    https://commonlands.com/blogs/technical/cmos-sensor-size
# 2. Next we must calculate the ACTUAL focal length, not the
#    EQUIVALENT focal length (for a 35mm camera).
# 3. Calculate the horizontal and vertical field of views using the formulas
#    below.
# 4. Calculate the GSD to AGL constant conversion factor with the formula below.abs
#    (we use this to calculate the altitude to fly, given a set GSD in cm/px)
#
# Here is a spreadsheet of DJI Drone specs:
#   https://docs.google.com/spreadsheets/d/15QyC3Y0HT1-zZm3nhE_2hRYHh6y5AnwBnO32uFtwNTw
#
# Some resources for double checking work:
#   https://www.scantips.com/lights/fieldofview.html
#   https://ardupilot.org/planner/docs/mission-planner-flight-plan.html
#   https://github.com/spifftek70/Drone-Footprints
#   https://github.com/OpenDroneMap/ODM/tree/master/contrib/orthorectify
# -------------------------------------------------------------
#
# - Vertical Field of View (FOV):
#   Formula: Vertical FOV = 2 * tan⁻¹(sensor height / 2 * focal length) * 180 / math.pi
#
# - Horizontal Field of View (FOV):
#   Formula: Horizontal FOV = 2 * tan⁻¹(sensor width / 2 * focal length) * 180 / math.pi
#
#   The typical GSD formula (for width only, in cm/px) is:
#      GSD = (AGL * sensor_width_mm) / (focal_length_mm * image_width_px) * 100
#   so our constant is
#      AGL/GSD = (focal_length_mm * image_width_px) / (sensor_width_mm * 100)
#   And we use it like so
#      AGL = GSD_cm_per_px * GSD_TO_AGL_CONST
DRONE_PARAMS = {
    DroneType.DJI_MINI_4_PRO: {
        "VERTICAL_FOV": 0.99,
        "HORIZONTAL_FOV": 1.25,
        "GSD_TO_AGL_CONST": 27.95,
        "OUTPUT_FORMAT": "DJI_WMPL",
    },
    # NOTE Mini 4 Pro, Mini 3 Pro, and Air 3 all have same CMOS size
    # and focal length, so have the same stats here
    DroneType.DJI_AIR_3: {
        "VERTICAL_FOV": 0.99,
        "HORIZONTAL_FOV": 1.25,
        "GSD_TO_AGL_CONST": 27.95,
        "OUTPUT_FORMAT": "DJI_WMPL",
    },
    # NOTE the params are basically the same despite 1" CMOS, due to
    # increase in both actual_focal_length_mm and sensor_width_mm
    DroneType.DJI_MINI_5_PRO: {
        "VERTICAL_FOV": 0.99,
        "HORIZONTAL_FOV": 1.25,
        "GSD_TO_AGL_CONST": 27.95,
        "OUTPUT_FORMAT": "DJI_WMPL",
    },
    DroneType.POTENSIC_ATOM_2: {
        "VERTICAL_FOV": 0.93,
        "HORIZONTAL_FOV": 1.17,
        "GSD_TO_AGL_CONST": 34.61,
        "OUTPUT_FORMAT": "POTENSIC_SQLITE",
    },
}


def drone_type_arg(value: str) -> DroneType:
    try:
        return DroneType[value.upper()]
    except KeyError:
        valid_options = ", ".join(DroneType.__members__)
        raise argparse.ArgumentTypeError(
            f"Invalid drone type '{value}'. Valid options are: {valid_options}"
        )
