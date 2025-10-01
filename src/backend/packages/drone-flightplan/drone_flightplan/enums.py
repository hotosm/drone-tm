from enum import Enum


class RCLostOptions(Enum):
    """Enum for RCLost options."""

    CONTINUE = (
        "goContinue"  # The aircraft continues to fly in the out-of-control position.
    )
    EXECUTE_LOST_ACTION = "executeLostAction"  # The aircraft executes the lost action.


class RCLostAction(Enum):
    """Enum for RCLost actions."""

    LAND = "landing"  # The aircraft landed on the spot in an out-of-control position.
    HOVER = "hover"  # The aircraft hovers in the out-of-control position.
    GO_BACK = "goBack"  # The aircraft flies from the out-of-control position to the take-off point.


class GimbalAngle(Enum):
    """Enum to describe key gimbal angle settings."""

    OFF_NADIR = "-80"
    OBLIQUE = "-45"
    NADIR = "-90"
