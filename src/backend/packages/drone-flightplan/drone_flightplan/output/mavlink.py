"""
Create a MAVLink Mission Plain-Text File Format (.waypoints)

This generates flight plans compatible with QGroundControl, Mission Planner,
and other MAVLink-compatible ground control stations.

The first waypoint in the input GeoJSON is treated as the takeoff point.
Supports two flight modes:
- WAYPOINTS: Takes a photo at each waypoint
- WAYLINES: Enables interval photo capture during the flight

Details: https://mavlink.io/en/services/mission.html
File Format: https://mavlink.io/en/file_formats/#mission_plain_text_file

FIXME This module was developed due to a misunderstanding of how
FIXME interfacing with QGroundControl should work.
FIXME
FIXME In future we could consider using this to generate
FIXME a .waypoints Mavlink file, then sending directly to the
FIXME drone software (Ardupilot / PX4) using pymavlink.
FIXME https://github.com/ArduPilot/pymavlink
FIXME
FIXME This way we could fly the drones directly from
FIXME the click of a button (in theory).
"""

import argparse
import logging
from typing import Union

import geojson
from geojson import FeatureCollection

from drone_flightplan.enums import FlightMode

log = logging.getLogger(__name__)


# MAVLink Command IDs (MAV_CMD)
# Navigation commands for movement
MAV_CMD_NAV_WAYPOINT = 16  # Navigate to waypoint
MAV_CMD_NAV_TAKEOFF = 22  # Takeoff from ground
MAV_CMD_NAV_LAND = 21  # Land at location
MAV_CMD_NAV_RETURN_TO_LAUNCH = 20  # Return to home/launch point

# DO commands for immediate actions
MAV_CMD_DO_CHANGE_SPEED = 178  # Change vehicle speed
MAV_CMD_DO_SET_CAM_TRIGG_DIST = 206  # Set camera trigger distance interval
MAV_CMD_DO_DIGICAM_CONTROL = 203  # Take a single photo
MAV_CMD_DO_MOUNT_CONTROL = 205  # Control gimbal/camera mount

# MAVLink Frame types - define coordinate reference systems
# NOTE: For plain-text format, use simple frame numbers, NOT _INT variants
MAV_FRAME_GLOBAL = 0  # Global coordinates (WGS84), altitude is MSL
MAV_FRAME_GLOBAL_RELATIVE_ALT = 3  # Global coords, altitude relative to takeoff
MAV_FRAME_MISSION = 2  # No specific frame (for commands without position)


def create_mavlink_mission_item(
    index: int,
    current_wp: int,
    frame: int,
    command: int,
    param1: float,
    param2: float,
    param3: float,
    param4: float,
    latitude: float,
    longitude: float,
    altitude: float,
    autocontinue: int = 1,
) -> str:
    """
    Create a single MAVLink mission item line in plain-text format.

    This follows the QGroundControl WPL format where each field is tab-separated.

    CRITICAL: For the plain-text format, coordinates are NOT encoded (no 1E7 multiplier).
    The coordinate order is: LONGITUDE, LATITUDE, ALTITUDE (params 5, 6, 7).

    Args:
        index: Sequence number of the mission item (0-based)
        current_wp: 1 if this is the current/active waypoint, 0 otherwise
        frame: Coordinate frame (MAV_FRAME_*)
        command: MAVLink command ID (MAV_CMD_*)
        param1-4: Command-specific parameters
        latitude: Latitude in degrees
        longitude: Longitude in degrees
        altitude: Altitude in meters
        autocontinue: 1 to continue to next item, 0 to pause

    Returns:
        Formatted mission item string with tab-separated values
    """
    # Plain-text format uses raw float values (NOT encoded with 1E7)
    # Order: INDEX, CURRENT, FRAME, COMMAND, P1, P2, P3, P4, LONGITUDE, LATITUDE, ALTITUDE, AUTOCONTINUE
    return (
        f"{index}\t{int(current_wp)}\t{int(frame)}\t{int(command)}\t"
        f"{float(param1):.6f}\t{float(param2):.6f}\t{float(param3):.6f}\t{float(param4):.6f}\t"
        f"{float(longitude):.8f}\t{float(latitude):.8f}\t{float(altitude):.6f}\t{int(autocontinue)}"
    )


def create_takeoff_item(placemark: dict, index: int) -> str:
    """
    Create a takeoff command from the first waypoint.

    The takeoff point uses altitude and coordinates from the first feature
    in the GeoJSON. This is where the drone will lift off from ground.

    Args:
        placemark: GeoJSON feature with takeoff point data
        index: Mission item sequence number

    Returns:
        Formatted takeoff mission item string
    """
    try:
        coordinate = placemark["geometry"]["coordinates"]
        longitude = coordinate[0]
        latitude = coordinate[1]

        props = placemark.get("properties", {})
        altitude = float(props.get("altitude", 0))

    except (IndexError, KeyError) as e:
        raise ValueError(f"Invalid takeoff placemark structure: {e}")

    # Use relative altitude frame for takeoff (frame 3)
    # Altitude is relative to the takeoff location (home position)
    # MAV_CMD_NAV_TAKEOFF params:
    # param1: Minimum pitch (if airborne already)
    # param2: Empty
    # param3: Empty
    # param4: Yaw angle (0 = use current heading)
    takeoff = create_mavlink_mission_item(
        index=index,
        current_wp=0,
        frame=MAV_FRAME_GLOBAL_RELATIVE_ALT,  # Frame 3
        command=MAV_CMD_NAV_TAKEOFF,
        param1=0,  # Minimum pitch
        param2=0,  # Empty
        param3=0,  # Empty
        param4=0,  # Yaw angle
        latitude=latitude,
        longitude=longitude,
        altitude=altitude,
        autocontinue=1,
    )

    return takeoff


def create_waypoint_item(placemark: dict, index: int, current_wp: int = 0) -> str:
    """
    Create a navigation waypoint mission item from placemark data.

    This is a standard waypoint the drone will fly to and may hold position at.

    Args:
        placemark: GeoJSON feature with waypoint properties
        index: Mission item sequence number
        current_wp: 1 if this is the current waypoint, 0 otherwise

    Returns:
        Formatted mission item string
    """
    try:
        coordinate = placemark["geometry"]["coordinates"]
        longitude = coordinate[0]
        latitude = coordinate[1]

        props = placemark.get("properties", {})
        altitude = float(props.get("altitude", 0))
        # FIXME not used yet
        # speed = props.get("speed", 0)
        # gimbal_angle = props.get("gimbal_angle", -90)

    except (IndexError, KeyError) as e:
        raise ValueError(f"Invalid placemark structure: {e}")

    # Use global frame with relative altitude (frame 3)
    # Altitude is measured from takeoff point, not sea level
    frame = MAV_FRAME_GLOBAL_RELATIVE_ALT

    # Create the waypoint command
    # MAV_CMD_NAV_WAYPOINT params:
    # param1: Hold time in seconds (0 = don't hold, fly through)
    # param2: Acceptance radius in meters (how close to get to waypoint)
    # param3: Pass through (0=waypoint, positive value=radius to pass through)
    # param4: Yaw angle in degrees (NaN or 0 = use heading)
    waypoint = create_mavlink_mission_item(
        index=index,
        current_wp=current_wp,
        frame=frame,
        command=MAV_CMD_NAV_WAYPOINT,
        param1=0,  # Hold time (0 = fly through immediately)
        param2=2,  # Acceptance radius (2m is reasonable for mapping)
        param3=0,  # Don't pass through with radius
        param4=0,  # Yaw angle (direction drone faces)
        latitude=latitude,
        longitude=longitude,
        altitude=altitude,
        autocontinue=1,
    )

    return waypoint


def create_camera_trigger_distance(index: int, distance: float = 0) -> str:
    """
    Create a camera trigger distance command.

    This sets up automatic photo capture at regular distance intervals.
    Setting distance to 0 disables the interval capture.

    Args:
        index: Mission item sequence number
        distance: Distance between photos in meters (0 to disable)

    Returns:
        Formatted mission item string
    """
    # MAV_CMD_DO_SET_CAM_TRIGG_DIST params:
    # param1: Distance in meters (0 = stop triggering)
    # param2: Shutter integration time (0 = ignore)
    # param3: Trigger camera once immediately (1 = yes, 0 = no)
    # param4: Reserved
    return create_mavlink_mission_item(
        index=index,
        current_wp=0,
        frame=MAV_FRAME_MISSION,  # No position needed
        command=MAV_CMD_DO_SET_CAM_TRIGG_DIST,
        param1=distance,
        param2=0,  # Shutter time (0 = ignore)
        param3=0,  # Don't trigger immediately
        param4=0,  # Reserved
        latitude=0,
        longitude=0,
        altitude=0,
        autocontinue=1,
    )


def create_camera_trigger_time(index: int, interval: float = 0) -> str:
    """
    Create a camera trigger time interval command.

    This sets up automatic photo capture at regular time intervals.
    Setting interval to 0 disables the time-based capture.

    Args:
        index: Mission item sequence number
        interval: Time between photos in seconds (0 to disable)

    Returns:
        Formatted mission item string
    """
    # MAV_CMD_DO_SET_CAM_TRIGG_INTERVAL params:
    # param1: Time interval in seconds (-1 = stop triggering)
    # param2: Shutter integration time (0 = ignore)
    # Using command 214
    return create_mavlink_mission_item(
        index=index,
        current_wp=0,
        frame=MAV_FRAME_MISSION,
        command=214,  # MAV_CMD_DO_SET_CAM_TRIGG_INTERVAL
        param1=interval if interval > 0 else -1,  # -1 stops triggering
        param2=0,
        param3=0,
        param4=0,
        latitude=0,
        longitude=0,
        altitude=0,
        autocontinue=1,
    )


def create_take_photo_command(index: int) -> str:
    """
    Create a single photo capture command.

    This triggers the camera to take one photo immediately.
    Used in WAYPOINTS mode for photo capture at specific locations.

    Args:
        index: Mission item sequence number

    Returns:
        Formatted mission item string
    """
    # MAV_CMD_DO_DIGICAM_CONTROL params:
    # param1: Session control (0 = ignore)
    # param2: Zoom absolute position (0 = ignore)
    # param3: Zoom relative position (0 = ignore)
    # param4: Focus (0 = ignore)
    # param5: Shoot command (1 = take photo)
    return create_mavlink_mission_item(
        index=index,
        current_wp=0,
        frame=MAV_FRAME_MISSION,  # DO commands always use mission frame
        command=MAV_CMD_DO_DIGICAM_CONTROL,
        param1=0,
        param2=0,
        param3=0,
        param4=0,
        latitude=1,  # param5: shoot command (1 = take photo)
        longitude=0,  # param6: command identity
        altitude=0,  # param7: empty
        autocontinue=1,
    )


def create_gimbal_control(
    index: int, pitch: float = -90, roll: float = 0, yaw: float = 0
) -> str:
    """
    Create a gimbal/camera mount control command.

    This positions the camera gimbal at specified angles.
    Commonly used to point camera straight down for mapping.

    Args:
        index: Mission item sequence number
        pitch: Pitch angle in degrees (-90 = straight down, 0 = forward)
        roll: Roll angle in degrees (0 = level)
        yaw: Yaw angle in degrees (0 = forward, relative to vehicle)

    Returns:
        Formatted mission item string
    """
    # MAV_CMD_DO_MOUNT_CONTROL params:
    # param1: Pitch angle
    # param2: Roll angle
    # param3: Yaw angle
    # param4: Reserved
    return create_mavlink_mission_item(
        index=index,
        current_wp=0,
        frame=MAV_FRAME_MISSION,
        command=MAV_CMD_DO_MOUNT_CONTROL,
        param1=pitch,
        param2=roll,
        param3=yaw,
        param4=0,  # Reserved
        latitude=0,
        longitude=0,
        altitude=0,
        autocontinue=1,
    )


def create_return_to_launch(index: int) -> str:
    """
    Create a return to launch (RTL) command.

    This commands the drone to return to the takeoff/home position.
    It will typically climb to a safe altitude, return, and land.

    Args:
        index: Mission item sequence number

    Returns:
        Formatted mission item string
    """
    # MAV_CMD_NAV_RETURN_TO_LAUNCH has no parameters
    # The drone uses its stored home position
    return create_mavlink_mission_item(
        index=index,
        current_wp=0,
        frame=MAV_FRAME_GLOBAL_RELATIVE_ALT,  # Frame 3
        command=MAV_CMD_NAV_RETURN_TO_LAUNCH,
        param1=0,
        param2=0,
        param3=0,
        param4=0,
        latitude=0,
        longitude=0,
        altitude=0,
        autocontinue=1,
    )


def create_mavlink_plan(
    placemark_geojson: Union[str, FeatureCollection, dict],
    output_file_path: str = "/tmp/mission.waypoints",
    flight_mode: FlightMode = FlightMode.WAYPOINTS,
    photo_interval_time: float = 2.0,
) -> str:
    """
    Generate a MAVLink mission plan file from placemark coordinates.

    The mission structure is:
    1. Home position (index 0) - stored at takeoff location
    2. Takeoff command - from first feature's altitude and position
    3. Optional: Set initial gimbal position
    4. Optional: Start interval photo capture (WAYLINES mode only)
    5. Navigation waypoints - from remaining features
       - WAYPOINTS mode: Take photo at each waypoint
       - WAYLINES mode: Photos taken automatically by interval
    6. Optional: Stop interval photo capture (WAYLINES mode only)
    7. Return to launch - fly back to home position

    Args:
        placemark_geojson: GeoJSON FeatureCollection with waypoint data
        output_file_path: Path for output .waypoints file
        flight_mode: WAYPOINTS (photo at each point) or WAYLINES (interval photos)
        photo_interval_time: Time between photos in seconds for WAYLINES mode

    Returns:
        Path to the created mission file
    """
    # Parse GeoJSON if it's a string
    if isinstance(placemark_geojson, str):
        placemark_geojson = geojson.loads(placemark_geojson)

    features = placemark_geojson.get("features", [])

    if not features:
        raise ValueError("No waypoints found in GeoJSON")

    if len(features) < 1:
        raise ValueError("At least one waypoint (takeoff point) is required")

    # Start building the mission file
    lines = []

    # Header: QGC WPL <VERSION>
    # Version 110 means format version 1.1.0 (used for plain-text missions)
    lines.append("QGC WPL 110")

    mission_items = []
    item_index = 0

    # STEP 1: Create Home Position
    # First item is always the home position (index 0, current waypoint = 1)
    # This is where the drone will return to if connection is lost
    # Use the first coordinate (takeoff point) as home
    # IMPORTANT: Home position uses frame 0 (MAV_FRAME_GLOBAL)
    first_coord = features[0]["geometry"]["coordinates"]
    first_props = features[0].get("properties", {})
    home_altitude = float(first_props.get("altitude", 0))

    home_position = create_mavlink_mission_item(
        index=0,
        current_wp=1,  # Mark as current waypoint (mission starts here)
        frame=MAV_FRAME_GLOBAL,  # Frame 0: Absolute altitude (MSL)
        command=MAV_CMD_NAV_WAYPOINT,
        param1=0,
        param2=0,
        param3=0,
        param4=0,
        latitude=first_coord[1],
        longitude=first_coord[0],
        altitude=home_altitude,
        autocontinue=1,
    )
    mission_items.append(home_position)
    item_index += 1

    # STEP 2: Create Takeoff Command
    takeoff_item = create_takeoff_item(features[0], item_index)
    mission_items.append(takeoff_item)
    item_index += 1

    # STEP 3: Set Initial Gimbal Position (if specified)
    first_gimbal = first_props.get("gimbal_angle")
    if first_gimbal is not None:
        gimbal_item = create_gimbal_control(index=item_index, pitch=float(first_gimbal))
        mission_items.append(gimbal_item)
        item_index += 1

    # Track last gimbal angle to avoid duplicate commands
    last_gimbal_angle = first_gimbal

    # STEP 4: Start Photo Interval (WAYLINES mode only)
    if flight_mode == FlightMode.WAYLINES:
        log.info(f"WAYLINES mode: Starting photo interval at {photo_interval_time}s")
        camera_start = create_camera_trigger_time(
            index=item_index, interval=photo_interval_time
        )
        mission_items.append(camera_start)
        item_index += 1

    # STEP 5: Add Navigation Waypoints
    for i, feature in enumerate(features[1:], start=1):
        props = feature.get("properties", {})

        # Only add gimbal command if angle has changed
        gimbal_angle = props.get("gimbal_angle")
        if gimbal_angle is not None and gimbal_angle != last_gimbal_angle:
            gimbal_item = create_gimbal_control(
                index=item_index, pitch=float(gimbal_angle)
            )
            mission_items.append(gimbal_item)
            item_index += 1
            last_gimbal_angle = gimbal_angle

        # Add the navigation waypoint
        waypoint = create_waypoint_item(feature, item_index)
        mission_items.append(waypoint)
        item_index += 1

        # WAYPOINTS MODE: Take photo at this waypoint
        # In WAYPOINTS mode, we trigger the camera at each specific location
        # This gives precise control over where photos are captured
        if flight_mode == FlightMode.WAYPOINTS:
            photo_item = create_take_photo_command(index=item_index)
            mission_items.append(photo_item)
            item_index += 1

    # STEP 6: Stop Photo Interval (WAYLINES mode only)
    # After reaching the last waypoint, disable the interval photo capture
    # This prevents taking photos during the return flight
    if flight_mode == FlightMode.WAYLINES:
        log.info("WAYLINES mode: Stopping photo interval capture")
        camera_stop = create_camera_trigger_time(
            index=item_index,
            interval=0,  # 0 or -1 disables interval capture
        )
        mission_items.append(camera_stop)
        item_index += 1

    # STEP 7: Return to Launch
    # After completing the mission, return to the home position
    # The drone will fly back and typically land automatically
    rtl_item = create_return_to_launch(item_index)
    mission_items.append(rtl_item)
    item_index += 1

    # Write Mission File
    # Add all mission items to the output
    lines.extend(mission_items)

    # Write to file with newline separation
    with open(output_file_path, "w") as f:
        f.write("\n".join(lines))

    log.info(
        f"Created MAVLink mission plan with {len(mission_items)} items "
        f"in {flight_mode.value} mode at {output_file_path}"
    )

    return output_file_path


def main(args_list: list[str] | None = None):
    """Command-line interface for generating MAVLink mission plans."""
    parser = argparse.ArgumentParser(
        description="Generate MAVLink mission plan (.waypoints) file for drone missions. "
        "The first waypoint in the GeoJSON is used as the takeoff point."
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
        help="The output file path for the .waypoints file",
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
        "--photo-interval",
        type=float,
        default=2.0,
        help="Time interval between photos in seconds for waylines mode (default: 2.0)",
    )

    args = parser.parse_args(args_list)

    # Convert string to FlightMode enum
    flight_mode = FlightMode(args.flight_mode)

    # Read input GeoJSON
    with open(args.placemark, "r") as f:
        placemark_data = f.read()

    # Generate mission plan
    create_mavlink_plan(
        geojson.loads(placemark_data),
        args.outfile,
        flight_mode=flight_mode,
        photo_interval_time=args.photo_interval,
    )


if __name__ == "__main__":
    main()
