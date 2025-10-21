"""
Create QGroundControl Plan File Format (.plan)

This generates flight plans in JSON format that can be directly imported into
QGroundControl for mission planning and execution.

The plan file includes:
- Mission items (waypoints, takeoff, camera control, etc.)
- Optional geofence (not implemented here, but structure provided)
- Optional rally points (not implemented here, but structure provided)

The first waypoint in the input GeoJSON is treated as the takeoff point and
also sets the planned home position.

File Format Documentation:
https://docs.qgroundcontrol.com/master/en/qgc-dev-guide/file_formats/plan.html

MAVLink Command Reference:
https://mavlink.io/en/messages/common.html#MAV_CMD
"""

import argparse
import json
import logging
from typing import Union, Optional

import geojson
from geojson import FeatureCollection

from drone_flightplan.enums import FlightMode

log = logging.getLogger(__name__)


# MAVLink Command IDs (MAV_CMD) - same as used in mavlink module
MAV_CMD_NAV_WAYPOINT = 16  # Navigate to waypoint
MAV_CMD_NAV_TAKEOFF = 22  # Takeoff from ground
MAV_CMD_NAV_LAND = 21  # Land at location
MAV_CMD_NAV_RETURN_TO_LAUNCH = 20  # Return to home/launch point
MAV_CMD_DO_CHANGE_SPEED = 178  # Change vehicle speed
MAV_CMD_DO_SET_CAM_TRIGG_DIST = 206  # Set camera trigger distance
MAV_CMD_DO_SET_CAM_TRIGG_INTERVAL = 214  # Set camera trigger time interval
MAV_CMD_DO_DIGICAM_CONTROL = 203  # Take a single photo
MAV_CMD_DO_MOUNT_CONTROL = 205  # Control gimbal/camera mount

# MAVLink Frame types
MAV_FRAME_GLOBAL = 0  # Global coordinates (WGS84), altitude is MSL
MAV_FRAME_GLOBAL_RELATIVE_ALT = 3  # Global coords, altitude relative to takeoff
MAV_FRAME_MISSION = 2  # No specific frame (for commands without position)

# Firmware types for QGC
FIRMWARE_TYPE_GENERIC = 0
FIRMWARE_TYPE_ARDUPILOT = 12
FIRMWARE_TYPE_PX4 = 3

# Vehicle types (MAV_TYPE)
VEHICLE_TYPE_FIXED_WING = 1
VEHICLE_TYPE_QUADROTOR = 2
VEHICLE_TYPE_COAXIAL = 3
VEHICLE_TYPE_HEXAROTOR = 13
VEHICLE_TYPE_OCTOROTOR = 14

# Altitude modes
ALTITUDE_MODE_RELATIVE = 0  # Relative to home position
ALTITUDE_MODE_AMSL = 1  # Above Mean Sea Level (absolute altitude)


def create_simple_item(
    command: int,
    frame: int,
    latitude: float,
    longitude: float,
    altitude: float,
    param1: float = 0,
    param2: float = 0,
    param3: float = 0,
    param4: Optional[float] = None,
    auto_continue: bool = True,
    altitude_mode: int = ALTITUDE_MODE_RELATIVE,
) -> dict:
    """
    Create a SimpleItem dictionary for the QGC plan format.

    A SimpleItem represents a single MAVLink MISSION_ITEM command with all
    its parameters. This is the basic building block of a mission.

    Args:
        command: MAVLink command ID (MAV_CMD_*)
        frame: Coordinate frame (MAV_FRAME_*)
        latitude: Latitude in degrees
        longitude: Longitude in degrees
        altitude: Altitude in meters
        param1-4: Command-specific parameters (see MAVLink docs)
        auto_continue: Whether to automatically continue to next item
        altitude_mode: ALTITUDE_MODE_RELATIVE (0) or ALTITUDE_MODE_AMSL (1)

    Returns:
        Dictionary representing a SimpleItem in QGC format
    """
    return {
        "type": "SimpleItem",
        "autoContinue": auto_continue,
        "command": command,
        "doJumpId": 1,  # Used for DO_JUMP commands, 1 is default
        "frame": frame,
        "params": [
            param1,
            param2,
            param3,
            param4,
            latitude,  # param5 (x)
            longitude,  # param6 (y)
            altitude,  # param7 (z)
        ],
        "Altitude": altitude,
        "AltitudeMode": altitude_mode,
        "AMSLAltAboveTerrain": None,  # Set to None for now, QGC calculates this
    }


def create_takeoff_item(
    latitude: float, longitude: float, altitude: float, pitch: float = 0
) -> dict:
    """
    Create a takeoff command item.

    This commands the drone to takeoff from its current position and climb
    to the specified altitude.

    Args:
        latitude: Takeoff point latitude
        longitude: Takeoff point longitude
        altitude: Altitude to climb to (relative to takeoff point)
        pitch: Minimum pitch angle (for fixed-wing aircraft)

    Returns:
        SimpleItem dictionary for takeoff command
    """
    return create_simple_item(
        command=MAV_CMD_NAV_TAKEOFF,
        frame=MAV_FRAME_GLOBAL_RELATIVE_ALT,
        latitude=latitude,
        longitude=longitude,
        altitude=altitude,
        param1=pitch,  # Minimum pitch (if airborne already)
        param2=0,  # Empty
        param3=0,  # Empty
        param4=None,  # Yaw angle (None = don't change)
        altitude_mode=ALTITUDE_MODE_RELATIVE,
    )


def create_waypoint_item(
    latitude: float,
    longitude: float,
    altitude: float,
    hold_time: float = 0,
    acceptance_radius: float = 2.0,
    pass_radius: float = 0,
    yaw: Optional[float] = None,
    altitude_mode: int = ALTITUDE_MODE_RELATIVE,
) -> dict:
    """
    Create a navigation waypoint item.

    This is a standard waypoint that the drone will fly to. The drone can
    optionally hold position at the waypoint or fly through it.

    Args:
        latitude: Waypoint latitude
        longitude: Waypoint longitude
        altitude: Waypoint altitude
        hold_time: Time to hold position at waypoint (0 = fly through)
        acceptance_radius: How close to get to waypoint (meters)
        pass_radius: Radius to pass through waypoint (0 = exact point)
        yaw: Heading angle in degrees (None = use current heading)
        altitude_mode: Relative (0) or absolute (1) altitude

    Returns:
        SimpleItem dictionary for waypoint command
    """
    return create_simple_item(
        command=MAV_CMD_NAV_WAYPOINT,
        frame=MAV_FRAME_GLOBAL_RELATIVE_ALT,
        latitude=latitude,
        longitude=longitude,
        altitude=altitude,
        param1=hold_time,
        param2=acceptance_radius,
        param3=pass_radius,
        param4=yaw,
        altitude_mode=altitude_mode,
    )


def create_camera_trigger_distance_item(distance: float) -> dict:
    """
    Create a camera trigger distance command.

    This sets up automatic photo capture at regular distance intervals.
    The camera will trigger every time the drone travels the specified distance.

    Args:
        distance: Distance between photos in meters (0 to disable)

    Returns:
        SimpleItem dictionary for camera trigger distance command
    """
    return create_simple_item(
        command=MAV_CMD_DO_SET_CAM_TRIGG_DIST,
        frame=MAV_FRAME_MISSION,
        latitude=0,
        longitude=0,
        altitude=0,
        param1=distance,  # Distance in meters (0 = stop)
        param2=0,  # Shutter integration time (0 = ignore)
        param3=0,  # Trigger immediately (1 = yes, 0 = no)
        param4=0,  # Reserved
    )


def create_camera_trigger_time_item(interval: float) -> dict:
    """
    Create a camera trigger time interval command.

    This sets up automatic photo capture at regular time intervals.
    The camera will trigger every time the specified interval passes.

    Args:
        interval: Time between photos in seconds (0 or -1 to disable)

    Returns:
        SimpleItem dictionary for camera trigger time command
    """
    return create_simple_item(
        command=MAV_CMD_DO_SET_CAM_TRIGG_INTERVAL,
        frame=MAV_FRAME_MISSION,
        latitude=0,
        longitude=0,
        altitude=0,
        param1=interval if interval > 0 else -1,  # -1 stops triggering
        param2=0,  # Shutter integration time (0 = ignore)
        param3=0,  # Reserved
        param4=0,  # Reserved
    )


def create_take_photo_item() -> dict:
    """
    Create a single photo capture command.

    This triggers the camera to take one photo immediately at the current
    position. Used in WAYPOINTS mode for precise photo locations.

    Returns:
        SimpleItem dictionary for take photo command
    """
    return create_simple_item(
        command=MAV_CMD_DO_DIGICAM_CONTROL,
        frame=MAV_FRAME_MISSION,
        latitude=1,  # param5: shoot command (1 = take photo)
        longitude=0,  # param6: command identity
        altitude=0,  # param7: empty
        param1=0,  # Session control (0 = ignore)
        param2=0,  # Zoom absolute position (0 = ignore)
        param3=0,  # Zoom relative position (0 = ignore)
        param4=0,  # Focus (0 = ignore)
    )


def create_gimbal_control_item(
    pitch: float = -90, roll: float = 0, yaw: float = 0
) -> dict:
    """
    Create a gimbal/camera mount control command.

    This positions the camera gimbal at specified angles. Commonly used
    to point the camera straight down for mapping missions.

    Args:
        pitch: Pitch angle in degrees (-90 = straight down, 0 = forward)
        roll: Roll angle in degrees (0 = level)
        yaw: Yaw angle in degrees (0 = forward, relative to vehicle)

    Returns:
        SimpleItem dictionary for gimbal control command
    """
    return create_simple_item(
        command=MAV_CMD_DO_MOUNT_CONTROL,
        frame=MAV_FRAME_MISSION,
        latitude=0,
        longitude=0,
        altitude=0,
        param1=pitch,
        param2=roll,
        param3=yaw,
        param4=0,  # Reserved
    )


def create_speed_change_item(
    speed: float, throttle: float = -1, is_relative: bool = False
) -> dict:
    """
    Create a speed change command.

    This changes the vehicle's target speed during the mission.

    Args:
        speed: Target speed in m/s (-1 means no change)
        throttle: Throttle percentage (-1 means no change)
        is_relative: True if speed change is relative to current, False for absolute

    Returns:
        SimpleItem dictionary for speed change command
    """
    return create_simple_item(
        command=MAV_CMD_DO_CHANGE_SPEED,
        frame=MAV_FRAME_MISSION,
        latitude=0,
        longitude=0,
        altitude=0,
        param1=0 if not is_relative else 1,  # Speed type (0=airspeed, 1=groundspeed)
        param2=speed,
        param3=throttle,
        param4=0 if not is_relative else 1,  # Relative (0=absolute, 1=relative)
    )


def create_return_to_launch_item() -> dict:
    """
    Create a return to launch (RTL) command.

    This commands the drone to return to the takeoff/home position.
    The drone will typically climb to a safe altitude, return home, and land.

    Returns:
        SimpleItem dictionary for RTL command
    """
    return create_simple_item(
        command=MAV_CMD_NAV_RETURN_TO_LAUNCH,
        frame=MAV_FRAME_GLOBAL_RELATIVE_ALT,
        latitude=0,
        longitude=0,
        altitude=0,
        param1=0,
        param2=0,
        param3=0,
        param4=0,
    )


def create_qgroundcontrol_plan(
    placemark_geojson: Union[str, FeatureCollection, dict],
    output_file_path: str = "/tmp/mission.plan",
    flight_mode: FlightMode = FlightMode.WAYPOINTS,
    photo_interval_time: float = 2.0,
    photo_interval_distance: Optional[float] = None,
    firmware_type: int = FIRMWARE_TYPE_PX4,
    vehicle_type: int = VEHICLE_TYPE_QUADROTOR,
    cruise_speed: float = 15.0,
    hover_speed: float = 5.0,
) -> str:
    """
    Generate a QGroundControl .plan file from placemark coordinates.

    This creates a complete mission plan in JSON format that can be imported
    directly into QGroundControl. The mission structure is:

    1. Takeoff from first waypoint location
    2. Optional: Set initial gimbal position
    3. Optional: Start interval photo capture (WAYLINES mode)
    4. Navigate through waypoints:
       - WAYPOINTS mode: Take photo at each specific waypoint
       - WAYLINES mode: Photos taken automatically during flight
    5. Optional: Stop interval photo capture (WAYLINES mode)
    6. Return to launch position

    Args:
        placemark_geojson: GeoJSON FeatureCollection with waypoint data.
            Each feature should have properties:
            - altitude: altitude in meters
            - speed: (optional) speed in m/s
            - gimbal_angle: (optional) camera pitch angle in degrees
        output_file_path: Path for output .plan file
        flight_mode: WAYPOINTS (photo at each point) or WAYLINES (interval photos)
        photo_interval_time: Time between photos in seconds (WAYLINES mode)
        photo_interval_distance: Distance between photos in meters (WAYLINES mode)
            If both time and distance are set, distance takes precedence
        firmware_type: Drone firmware (FIRMWARE_TYPE_ARDUPILOT or FIRMWARE_TYPE_PX4)
        vehicle_type: Type of vehicle (VEHICLE_TYPE_QUADROTOR, etc.)
        cruise_speed: Default cruise speed in m/s
        hover_speed: Default hover speed in m/s

    Returns:
        Path to the created plan file

    Raises:
        ValueError: If no waypoints found or invalid GeoJSON format
    """
    # Parse GeoJSON if it's a string
    if isinstance(placemark_geojson, str):
        placemark_geojson = geojson.loads(placemark_geojson)

    features = placemark_geojson.get("features", [])

    if not features:
        raise ValueError("No waypoints found in GeoJSON")
    if len(features) < 1:
        raise ValueError("At least one waypoint (takeoff point) is required")

    # Get takeoff/home position from first waypoint
    first_feature = features[0]
    first_coord = first_feature["geometry"]["coordinates"]
    first_props = first_feature.get("properties", {})

    home_longitude = first_coord[0]
    home_latitude = first_coord[1]
    home_altitude = float(first_props.get("altitude", 50))

    # Initialize mission items list
    mission_items = []

    # STEP 1: Create Takeoff Command
    log.info(
        f"Adding takeoff at ({home_latitude}, {home_longitude}) "
        f"to altitude {home_altitude}m"
    )

    takeoff_item = create_takeoff_item(
        latitude=home_latitude, longitude=home_longitude, altitude=home_altitude
    )
    mission_items.append(takeoff_item)

    # STEP 2: Set Initial Gimbal Position (if specified)
    first_gimbal = first_props.get("gimbal_angle")
    last_gimbal_angle = first_gimbal

    if first_gimbal is not None:
        log.info(f"Setting initial gimbal angle to {first_gimbal}°")
        gimbal_item = create_gimbal_control_item(pitch=float(first_gimbal))
        mission_items.append(gimbal_item)

    # STEP 3: Set Initial Speed (if specified)
    first_speed = first_props.get("speed")
    last_speed = first_speed

    if first_speed is not None:
        log.info(f"Setting initial speed to {first_speed} m/s")
        speed_item = create_speed_change_item(speed=float(first_speed))
        mission_items.append(speed_item)

    # STEP 4: Start Photo Interval (WAYLINES mode only)
    if flight_mode == FlightMode.WAYLINES:
        # Distance-based triggering takes precedence over time-based
        if photo_interval_distance is not None and photo_interval_distance > 0:
            log.info(
                f"WAYLINES mode: Starting photo interval at {photo_interval_distance}m"
            )
            camera_item = create_camera_trigger_distance_item(photo_interval_distance)
        else:
            log.info(
                f"WAYLINES mode: Starting photo interval at {photo_interval_time}s"
            )
            camera_item = create_camera_trigger_time_item(photo_interval_time)
        mission_items.append(camera_item)

    # STEP 5: Add Navigation Waypoints
    # Skip first feature as it's used for takeoff
    waypoint_count = 0
    for i, feature in enumerate(features[1:], start=1):
        props = feature.get("properties", {})
        coord = feature["geometry"]["coordinates"]

        longitude = coord[0]
        latitude = coord[1]
        altitude = float(props.get("altitude", home_altitude))

        # Change speed if specified and different from last speed
        speed = props.get("speed")
        if speed is not None and speed != last_speed:
            log.debug(f"Changing speed to {speed} m/s at waypoint {i}")
            speed_item = create_speed_change_item(speed=float(speed))
            mission_items.append(speed_item)
            last_speed = speed

        # Change gimbal angle if specified and different from last angle
        gimbal_angle = props.get("gimbal_angle")
        if gimbal_angle is not None and gimbal_angle != last_gimbal_angle:
            log.debug(f"Changing gimbal to {gimbal_angle}° at waypoint {i}")
            gimbal_item = create_gimbal_control_item(pitch=float(gimbal_angle))
            mission_items.append(gimbal_item)
            last_gimbal_angle = gimbal_angle

        # Add the navigation waypoint
        log.debug(f"Adding waypoint {i} at ({latitude}, {longitude}, {altitude}m)")
        waypoint_item = create_waypoint_item(
            latitude=latitude, longitude=longitude, altitude=altitude
        )
        mission_items.append(waypoint_item)
        waypoint_count += 1

        # WAYPOINTS MODE: Take photo at this specific waypoint
        if flight_mode == FlightMode.WAYPOINTS:
            photo_item = create_take_photo_item()
            mission_items.append(photo_item)

    log.info(f"Added {waypoint_count} waypoints to mission")

    # STEP 6: Stop Photo Interval (WAYLINES mode only)
    if flight_mode == FlightMode.WAYLINES:
        log.info("WAYLINES mode: Stopping photo interval capture")
        if photo_interval_distance is not None and photo_interval_distance > 0:
            camera_stop = create_camera_trigger_distance_item(0)
        else:
            camera_stop = create_camera_trigger_time_item(0)
        mission_items.append(camera_stop)

    # STEP 7: Return to Launch
    log.info("Adding return to launch command")
    rtl_item = create_return_to_launch_item()
    mission_items.append(rtl_item)

    # Build the complete plan structure
    plan = {
        "fileType": "Plan",
        "version": 1,
        "groundStation": "QGroundControl",
        # Mission object with all waypoints and commands
        "mission": {
            "version": 2,
            "firmwareType": firmware_type,
            "vehicleType": vehicle_type,
            "cruiseSpeed": cruise_speed,
            "hoverSpeed": hover_speed,
            "globalPlanAltitudeMode": ALTITUDE_MODE_RELATIVE,
            # Planned home position (where RTL will return to)
            "plannedHomePosition": [home_latitude, home_longitude, home_altitude],
            # All mission items
            "items": mission_items,
        },
        # Empty geofence (can be populated later if needed)
        "geoFence": {"version": 2, "circles": [], "polygons": []},
        # Empty rally points (can be populated later if needed)
        "rallyPoints": {"version": 2, "points": []},
    }

    # Write the plan to file as formatted JSON
    with open(output_file_path, "w") as f:
        json.dump(plan, f, indent=2)

    log.info(
        f"Created QGroundControl plan with {len(mission_items)} items "
        f"in {flight_mode.value} mode at {output_file_path}"
    )

    return output_file_path


def main(args_list: list[str] | None = None):
    """Command-line interface for generating QGroundControl plan files."""
    parser = argparse.ArgumentParser(
        description="Generate QGroundControl .plan file for drone missions. "
        "The first waypoint in the GeoJSON is used as the takeoff point "
        "and planned home position."
    )
    parser.add_argument(
        "--placemark",
        required=True,
        type=str,
        help="The placemark GeoJSON file containing waypoints",
    )
    parser.add_argument(
        "--outfile",
        required=True,
        type=str,
        help="The output file path for the .plan file",
    )
    parser.add_argument(
        "--flight-mode",
        type=str,
        choices=["waypoints", "waylines"],
        default="waypoints",
        help="Flight mode: 'waypoints' (photo at each point) or "
        "'waylines' (interval photos along path)",
    )
    parser.add_argument(
        "--photo-interval-time",
        type=float,
        default=2.0,
        help="Time interval between photos in seconds for waylines mode (default: 2.0)",
    )
    parser.add_argument(
        "--photo-interval-distance",
        type=float,
        default=None,
        help="Distance interval between photos in meters for waylines mode "
        "(overrides time interval if set)",
    )
    parser.add_argument(
        "--firmware",
        type=str,
        choices=["ardupilot", "px4", "generic"],
        default="px4",
        help="Drone firmware type (default: px4)",
    )
    parser.add_argument(
        "--vehicle",
        type=str,
        choices=["quadrotor", "hexarotor", "octorotor", "fixed-wing"],
        default="quadrotor",
        help="Vehicle type (default: quadrotor)",
    )
    parser.add_argument(
        "--cruise-speed",
        type=float,
        default=15.0,
        help="Cruise speed in m/s (default: 15.0)",
    )
    parser.add_argument(
        "--hover-speed",
        type=float,
        default=5.0,
        help="Hover speed in m/s (default: 5.0)",
    )

    args = parser.parse_args(args_list)

    # Convert string to FlightMode enum
    flight_mode = FlightMode(args.flight_mode)

    # Convert firmware string to constant
    firmware_map = {
        "generic": FIRMWARE_TYPE_GENERIC,
        "ardupilot": FIRMWARE_TYPE_ARDUPILOT,
        "px4": FIRMWARE_TYPE_PX4,
    }
    firmware_type = firmware_map[args.firmware]

    # Convert vehicle string to constant
    vehicle_map = {
        "quadrotor": VEHICLE_TYPE_QUADROTOR,
        "hexarotor": VEHICLE_TYPE_HEXAROTOR,
        "octorotor": VEHICLE_TYPE_OCTOROTOR,
        "fixed-wing": VEHICLE_TYPE_FIXED_WING,
    }
    vehicle_type = vehicle_map[args.vehicle]

    # Read input GeoJSON
    with open(args.placemark, "r") as f:
        placemark_data = f.read()

    create_qgroundcontrol_plan(
        geojson.loads(placemark_data),
        args.outfile,
        flight_mode=flight_mode,
        photo_interval_time=args.photo_interval_time,
        photo_interval_distance=args.photo_interval_distance,
        firmware_type=firmware_type,
        vehicle_type=vehicle_type,
        cruise_speed=args.cruise_speed,
        hover_speed=args.hover_speed,
    )


if __name__ == "__main__":
    main()
