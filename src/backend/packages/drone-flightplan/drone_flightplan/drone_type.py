from enum import Enum


class DroneType(int, Enum):
    DJI_MINI_4_PRO = {
        # Constants (For DJI Mini 4 Pro)
        "VERTICAL_FOV": 0.71,
        "HORIZONTAL_FOV": 1.26,
        "GSD_to_AGL_CONST": 29.7,
    }

    DJI_AIR_3 = {
        # Constants (For DJI Air 3)
        # Vertical Field of View (FOV):
        # Formula: Vertical FOV = 2 * tan^(-1)(sensor height / 2 * focal length)
        # The vertical FOV for DJI Air 3 is calculated as: 2 * tan^(-1)(6.3 / (2 * 19.4)) ≈ 0.3224 radians
        "VERTICAL_FOV": 0.3224,
        # Horizontal Field of View (FOV):
        # Formula: Horizontal FOV = 2 * tan^(-1)(sensor width / 2 * focal length)
        # The horizontal FOV for DJI Air 3 is calculated as: 2 * tan^(-1)(8.4 / (2 * 19.4)) ≈ 0.4269 radians
        "HORIZONTAL_FOV": 0.4269,
        # Ground Sampling Distance constant (GSD to AGL constant):
        # GSD = (sensor height / focal length) * AGL
        # This constant helps in determining the ground resolution per pixel at a given altitude (AGL).
        "GSD_to_AGL_CONST": 30.5,
    }
