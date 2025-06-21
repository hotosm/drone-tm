import argparse
from enums import Enum


class StrEnum(str, Enum):
    """Wrapper for string enums, until Python 3.11 upgrade."""

    pass


class DroneType(StrEnum):
    DJI_MINI_4_PRO = "DJI_MINI_4_PRO"
    DJI_AIR_3 = "DJI_AIR_3"
    POTENSIC_ATOM_2 = "POTENSIC_ATOM_2"


# NOTE param calcs:
# The CMOS size in inches doesn't directly correspond to the sensor's
#   physical width or height in millimeters or inches. It's a
#   historical convention used to compare sensor sizes.
# We we cannot use the aspect ratio plus some simple trigonometry.
# It's more complex that that, see this article:
#   https://commonlands.com/blogs/technical/cmos-sensor-size
# A commonly agreed upon formula of the diagonal at 4:3 aspect ratio:
#   1" = 16.0mm, 1/2" = 8.0mm, 1/3" = 6.0mm, 1/4" = 4.5mm
# Here is a list of common sizes:
#   https://en.wikipedia.org/wiki/Image_sensor_format#Table_of_sensor_formats_and_sizes
# Here is a spreadsheet of DJI Drone specs:
#   https://docs.google.com/spreadsheets/d/15QyC3Y0HT1-zZm3nhE_2hRYHh6y5AnwBnO32uFtwNTw
#
# -------------------------------------------------------------
#
# - Vertical Field of View (FOV):
#   Formula: Vertical FOV = 2 * tan⁻¹(sensor height / 2 * focal length)
#
# - Horizontal Field of View (FOV):
#   Formula: Horizontal FOV = 2 * tan⁻¹(sensor width / 2 * focal length)
#
# - Ground Sampling Distance constant (GSD to AGL constant):
#   This constant is a multiplication factor to convert a target
#   GSD (in meters per pixel) into the required flight altitude (AGL, in meters).
#   The typical GSD formula (for width only) is:
#     GSD = (AGL * sensor_width_mm) / (focal_length_mm * image_width_px)
#   Solving for AGL:
#     AGL = (GSD * focal_length_mm * image_width_px) / sensor_width_mm
#   So:
#     GSD_TO_AGL_CONST = (focal_length_mm * image_width_px) / sensor_width_mm
#   Final AGL = GSD_m_per_px * GSD_TO_AGL_CONST
DRONE_PARAMS = {
    # CMOS sensor 1/1.3" = 9.6mm width x 7.2mm height
    # Focal length = 24mm
    # Image width = 8064px
    DroneType.DJI_MINI_4_PRO: {
        # 2 * tan^(-1)(7.2 / (2 * 24))
        # 2 * tan^(-1)(0.15) ≈ 0.2977799 radians
        "VERTICAL_FOV": 0.2977799,
        # 2 * tan^(-1)(9.6 / (2 * 24))
        # 2 * tan^(-1)(0.2) ≈ 0.39479112 radians
        "HORIZONTAL_FOV": 0.39479112,
        # (24 * 8064) / 9.6 = 20160
        # So for GSD of 0.01m/px: AGL = 0.01 * 20160 = 20.16m
        "GSD_TO_AGL_CONST": 20.16,
    },
    # NOTE Mini 4 Pro, Mini 3 Pro, and Air 3 all have same CMOS size
    # and focal length, so have the same stats here
    DroneType.DJI_AIR_3: {
        "VERTICAL_FOV": 0.2977799,
        "HORIZONTAL_FOV": 0.39479112,
        "GSD_TO_AGL_CONST": 20.16,
    },
    # CMOS sensor 1/2" = 8.0mm width x 6.4mm height
    # Focal length = 26mm
    # Image width = 8000px
    DroneType.POTENSIC_ATOM_2: {
        # 2 * tan^(-1)(6.4 / (2 * 26))
        # 2 * tan^(-1)(0.123) ≈ 0.24477056 radians
        "VERTICAL_FOV": 0.24477056,
        # 2 * tan^(-1)(8 / (2 * 26))
        # 2 * tan^(-1)(0.137931) ≈ 0.2741322 radians
        "HORIZONTAL_FOV": 0.2741322,
        # (26 * 8000) / 8 = 26000
        # So for GSD of 0.01m/px: AGL = 0.01 * 26000 = 26.0m
        "GSD_TO_AGL_CONST": 26.0,
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
