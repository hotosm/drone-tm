"""
Create Litchi CSV Flight Plan Format (.csv)

This generates flight plans in CSV format that can be imported into Litchi
for autonomous drone missions. Litchi is a popular third-party flight control
app for DJI drones.

The CSV format includes waypoint coordinates, altitude, heading, gimbal control,
and up to 15 actions per waypoint for camera control and other operations.

Litchi supports:
- Waypoint missions with photo capture
- Curved or straight line paths between waypoints
- Time and distance-based photo intervals
- Point of Interest (POI) tracking
- Above ground altitude mode

Litchi Hub: https://flylitchi.com/hub
Documentation: Community forums and exported CSV examples

Note: Some features like photo_timeinterval and photo_distinterval are in the
CSV format but may have limited support depending on drone model and firmware.

Also see implementation from OpenGeoOne here:
https://github.com/OpenGeoOne/qgis-drone-flight-planner/blob/main/algoritmos/Funcs.py
"""

import argparse
import csv
import logging
from typing import Union, Optional

import geojson
from geojson import FeatureCollection

from drone_flightplan.enums import FlightMode

log = logging.getLogger(__name__)


# Litchi Action Types
# These are the values used in actiontype1-15 fields
ACTION_NONE = -1  # No action
ACTION_STAY_FOR = 0  # Stay/hover for specified time (param in milliseconds)
ACTION_TAKE_PHOTO = 1  # Take a single photo
ACTION_START_RECORDING = 2  # Start video recording
ACTION_STOP_RECORDING = 3  # Stop video recording
ACTION_ROTATE_AIRCRAFT = 4  # Rotate aircraft to angle (param in degrees)
ACTION_TILT_CAMERA = 5  # Tilt camera/gimbal (param in degrees)

# Litchi Gimbal Modes
GIMBAL_MODE_DISABLED = 0  # Gimbal control disabled (manual control)
GIMBAL_MODE_FOCUS_POI = 1  # Focus on Point of Interest
GIMBAL_MODE_INTERPOLATE = 2  # Interpolate gimbal angles between waypoints

# Litchi Rotation Direction
ROTATION_CLOCKWISE = 0  # Rotate clockwise
ROTATION_COUNTERCLOCKWISE = 1  # Rotate counter-clockwise

# Litchi Altitude Modes
ALTITUDE_MODE_MSL = 0  # Mean Sea Level (absolute altitude)
ALTITUDE_MODE_AGL = 1  # Above Ground Level (terrain following)


def create_litchi_waypoint(
    latitude: float,
    longitude: float,
    altitude: float,
    heading: float = 0,
    curvesize: float = 0,
    gimbal_pitch: float = -90,
    speed: float = 8.0,
    actions: Optional[list[tuple[int, float]]] = None,
    altitude_mode: int = ALTITUDE_MODE_AGL,
    poi_latitude: float = 0,
    poi_longitude: float = 0,
    poi_altitude: float = 0,
    photo_time_interval: float = -1,
    photo_dist_interval: float = -1,
) -> dict:
    """
    Create a single Litchi waypoint with all parameters.

    A Litchi waypoint includes position, heading, gimbal control, speed,
    and up to 15 sequential actions that execute at the waypoint.

    Args:
        latitude: Waypoint latitude in degrees (WGS84)
        longitude: Waypoint longitude in degrees (WGS84)
        altitude: Altitude in meters (MSL or AGL depending on altitude_mode)
        heading: Aircraft heading in degrees (0-360, 0=North)
        curvesize: Curve radius in meters (0 = stop at waypoint, >0 = curved path)
        gimbal_pitch: Camera pitch angle (-90 = straight down, 0 = forward)
        speed: Flight speed in m/s
        actions: List of (action_type, param) tuples (max 15 actions)
        altitude_mode: ALTITUDE_MODE_MSL (0) or ALTITUDE_MODE_AGL (1)
        poi_latitude: Point of Interest latitude (for GIMBAL_MODE_FOCUS_POI)
        poi_longitude: Point of Interest longitude
        poi_altitude: Point of Interest altitude
        photo_time_interval: Automatic photo interval in seconds (-1 = disabled)
        photo_dist_interval: Automatic photo interval in meters (-1 = disabled)

    Returns:
        Dictionary with all Litchi CSV fields for one waypoint
    """
    # Initialize waypoint data
    waypoint = {
        "latitude": f"{latitude:.8f}",
        "longitude": f"{longitude:.8f}",
        "altitude(m)": f"{altitude:.1f}",
        "heading(deg)": f"{heading:.0f}",
        "curvesize(m)": f"{curvesize:.1f}",
        "rotationdir": ROTATION_CLOCKWISE,
        "gimbalmode": GIMBAL_MODE_INTERPOLATE,
        "gimbalpitchangle": f"{gimbal_pitch:.0f}",
    }

    # Add up to 15 actions (action type and parameter pairs)
    if actions is None:
        actions = []

    # Pad actions list to 15 items with "no action"
    while len(actions) < 15:
        actions.append((ACTION_NONE, 0))

    # Add action type and param fields (15 pairs = 30 fields)
    for i, (action_type, param) in enumerate(actions[:15], start=1):
        waypoint[f"actiontype{i}"] = int(action_type)
        waypoint[f"actionparam{i}"] = (
            int(param) if action_type == ACTION_STAY_FOR else f"{param:.1f}"
        )

    # Add remaining fields
    waypoint.update(
        {
            "altitudemode": altitude_mode,
            "speed(m/s)": f"{speed:.1f}",
            "poi_latitude": f"{poi_latitude:.8f}",
            "poi_longitude": f"{poi_longitude:.8f}",
            "poi_altitude(m)": f"{poi_altitude:.1f}",
            "poi_altitudemode": ALTITUDE_MODE_AGL,
            "photo_timeinterval": f"{photo_time_interval:.1f}",
            "photo_distinterval": f"{photo_dist_interval:.1f}",
        }
    )

    return waypoint


def create_litchi_csv(
    placemark_geojson: Union[str, FeatureCollection, dict],
    output_file_path: str = "/tmp/mission.csv",
    flight_mode: FlightMode = FlightMode.WAYLINES,
    photo_interval_time: float = 2.0,
    photo_interval_distance: Optional[float] = None,
    hover_time: float = 0,
    use_terrain_follow: bool = True,
    curve_size: float = 0,
    heading_mode: str = "auto",
) -> str:
    """
    Generate a Litchi CSV mission file from placemark coordinates.

    This creates a complete mission plan that can be imported into Litchi.
    The mission structure depends on the flight mode:

    WAYPOINTS mode:
    - Stops at each waypoint (curvesize=0)
    - Takes a photo at each waypoint
    - Optional hover time before taking photo

    WAYLINES mode:
    - Can fly curved paths between waypoints (curvesize>0)
    - Continuous photo capture using time or distance intervals
    - Photos are NOT taken as waypoint actions but via interval triggering

    Args:
        placemark_geojson: GeoJSON FeatureCollection with waypoint data.
            Each feature should have properties:
            - altitude: altitude in meters (required)
            - speed: (optional) speed in m/s
            - gimbal_angle: (optional) camera pitch angle in degrees
            - heading: (optional) aircraft heading in degrees
        output_file_path: Path for output .csv file
        flight_mode: WAYPOINTS (photo at each point) or WAYLINES (interval photos)
        speed: Default flight speed in m/s
        photo_interval_time: Time between photos in seconds (WAYLINES mode)
        photo_interval_distance: Distance between photos in meters (WAYLINES mode)
            If set, distance takes precedence over time interval
        hover_time: Time to hover at each waypoint in seconds (0 = no hover)
        use_terrain_follow: If True, use Above Ground Level altitude mode
        curve_size: Curve radius for smooth turns in meters (0 = stop at waypoints)
            Note: If curvesize > 0, waypoint actions may not execute
        heading_mode: "auto" (calculate from path), "fixed" (use heading property),
            or a specific angle in degrees

    Returns:
        Path to the created CSV file

    Raises:
        ValueError: If no waypoints found or invalid GeoJSON format
    """
    # Parse GeoJSON if it's a string
    if isinstance(placemark_geojson, str):
        placemark_geojson = geojson.loads(placemark_geojson)

    features = placemark_geojson.get("features", [])

    if not features:
        raise ValueError("No waypoints found in GeoJSON")

    # Determine altitude mode
    altitude_mode = ALTITUDE_MODE_AGL if use_terrain_follow else ALTITUDE_MODE_MSL
    altitude_mode_str = "Above Ground" if use_terrain_follow else "Mean Sea Level"

    log.info(f"Creating Litchi mission with {len(features)} waypoints")
    log.info(f"Flight mode: {flight_mode.value}")
    log.info(f"Altitude mode: {altitude_mode_str}")

    # Build waypoints list
    waypoints = []

    for i, feature in enumerate(features):
        props = feature.get("properties", {})
        coord = feature["geometry"]["coordinates"]

        longitude = coord[0]
        latitude = coord[1]

        altitude = float(props.get("altitude", 100))
        waypoint_speed = float(props.get("speed", 12.0))
        gimbal_angle = float(props.get("gimbal_angle", -80))

        # Determine heading
        if heading_mode == "auto":
            # Calculate heading from next waypoint if available
            if i < len(features) - 1:
                next_coord = features[i + 1]["geometry"]["coordinates"]
                import math

                dx = next_coord[0] - longitude
                dy = next_coord[1] - latitude
                heading = (math.degrees(math.atan2(dx, dy)) + 360) % 360
            else:
                heading = props.get("heading", 0)  # Use property or 0 for last waypoint
        elif heading_mode == "fixed":
            heading = float(props.get("heading", 0))
        else:
            try:
                heading = float(heading_mode)
            except (ValueError, TypeError):
                heading = 0

        # Build actions list based on flight mode
        actions = []

        if flight_mode == FlightMode.WAYPOINTS:
            # WAYPOINTS MODE: Stop, optionally hover, take photo

            # Add hover action if specified
            if hover_time > 0:
                hover_ms = int(hover_time * 1000)
                actions.append((ACTION_STAY_FOR, hover_ms))
                log.debug(f"Waypoint {i}: Adding {hover_time}s hover before photo")

            # Take photo at this waypoint
            actions.append((ACTION_TAKE_PHOTO, 0))

            # Force curvesize to 0 so drone stops at waypoint
            waypoint_curvesize = 0

        else:
            # WAYLINES MODE: No waypoint actions, use interval triggering
            # Photos are triggered by time/distance intervals, not waypoint actions
            waypoint_curvesize = curve_size
            # actions list stays empty (or could add other actions if needed)

        # Determine photo interval settings
        # Note: These fields are in the CSV but support varies by drone/firmware
        if flight_mode == FlightMode.WAYLINES:
            if photo_interval_distance is not None and photo_interval_distance > 0:
                time_interval = -1
                dist_interval = photo_interval_distance
            else:
                time_interval = photo_interval_time
                dist_interval = -1
        else:
            # WAYPOINTS mode doesn't use interval triggering
            time_interval = -1
            dist_interval = -1

        # Create the waypoint
        waypoint = create_litchi_waypoint(
            latitude=latitude,
            longitude=longitude,
            altitude=altitude,
            heading=heading,
            curvesize=waypoint_curvesize,
            gimbal_pitch=gimbal_angle,
            speed=waypoint_speed,
            actions=actions,
            altitude_mode=altitude_mode,
            photo_time_interval=time_interval,
            photo_dist_interval=dist_interval,
        )

        waypoints.append(waypoint)
        log.debug(f"Added waypoint {i}: ({latitude:.6f}, {longitude:.6f}, {altitude}m)")

    # Write CSV file
    if not waypoints:
        raise ValueError("No waypoints were created")

    # Get fieldnames from first waypoint (they're ordered correctly)
    fieldnames = list(waypoints[0].keys())

    with open(output_file_path, "w", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(waypoints)

    log.info(
        f"Created Litchi CSV mission with {len(waypoints)} waypoints "
        f"in {flight_mode.value} mode at {output_file_path}"
    )

    if flight_mode == FlightMode.WAYLINES and curve_size > 0:
        log.warning(
            f"Curve size is {curve_size}m. Waypoint actions may not execute "
            "if drone flies through waypoints. Set curvesize=0 to stop at waypoints."
        )

    if flight_mode == FlightMode.WAYLINES:
        if photo_interval_distance:
            log.info(f"Photo interval: Every {photo_interval_distance}m")
        else:
            log.info(f"Photo interval: Every {photo_interval_time}s")
        log.info(
            "Note: Photo interval triggering must be manually started in Litchi app. "
            "The photo_timeinterval and photo_distinterval CSV fields have limited support."
        )

    return output_file_path


def main(args_list: list[str] | None = None):
    """Command-line interface for generating Litchi CSV mission files."""
    parser = argparse.ArgumentParser(
        description="Generate Litchi CSV file for drone missions. "
        "Creates waypoint missions compatible with Litchi flight control app."
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
        help="The output file path for the .csv file",
    )
    parser.add_argument(
        "--flight-mode",
        type=str,
        choices=["waypoints", "waylines"],
        default="waylines",
        help="Flight mode: 'waypoints' (photo at each point, stops at waypoints) or "
        "'waylines' (interval photos, smooth flight)",
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
        "--hover-time",
        type=float,
        default=0,
        help="Time to hover at each waypoint before taking photo in seconds (default: 0)",
    )
    parser.add_argument(
        "--terrain-follow",
        action="store_true",
        default=True,
        help="Use Above Ground Level altitude mode (default: True)",
    )
    parser.add_argument(
        "--no-terrain-follow",
        dest="terrain_follow",
        action="store_false",
        help="Use Mean Sea Level altitude mode instead of Above Ground Level",
    )
    parser.add_argument(
        "--curve-size",
        type=float,
        default=0,
        help="Curve radius for smooth turns in meters (default: 0 = stop at waypoints). "
        "Note: Actions may not execute if curve size > 0",
    )
    parser.add_argument(
        "--heading-mode",
        type=str,
        default="auto",
        help="Heading mode: 'auto' (calculate from flight path), 'fixed' (use GeoJSON heading property), "
        "or a specific angle in degrees (default: 'auto')",
    )

    args = parser.parse_args(args_list)

    # Convert string to FlightMode enum
    flight_mode = FlightMode(args.flight_mode)

    # Read input GeoJSON
    with open(args.placemark, "r") as f:
        placemark_data = f.read()

    # Generate Litchi CSV
    create_litchi_csv(
        geojson.loads(placemark_data),
        args.outfile,
        flight_mode=flight_mode,
        photo_interval_time=args.photo_interval_time,
        photo_interval_distance=args.photo_interval_distance,
        hover_time=args.hover_time,
        use_terrain_follow=args.terrain_follow,
        curve_size=args.curve_size,
        heading_mode=args.heading_mode,
    )


if __name__ == "__main__":
    main()
