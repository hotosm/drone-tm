import argparse
import logging
import os
import tempfile
from typing import Union

import geojson
from geojson import FeatureCollection
from shapely.geometry import shape

from drone_flightplan.add_elevation_from_dem import add_elevation_from_dem
from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.create_placemarks import create_placemarks
from drone_flightplan.waypoints import create_waypoint
from drone_flightplan.drone_type import DroneType, DRONE_PARAMS, drone_type_arg
from drone_flightplan.enums import FlightMode, GimbalAngle, flight_mode_arg
from drone_flightplan.output.dji import create_wpml
from drone_flightplan.output.potensic_v1 import create_potensic_sqlite
from drone_flightplan.output.potensic_v2 import create_potensic_json
from drone_flightplan.output.mavlink import create_mavlink_plan
from drone_flightplan.output.qgroundcontrol import create_qgroundcontrol_plan
from drone_flightplan.output.litchi import create_litchi_csv
from drone_flightplan.terrain_following_waylines import waypoints2waylines

log = logging.getLogger(__name__)


def build_placemarks(
    aoi: Union[str, FeatureCollection, dict],
    forward_overlap: float,
    side_overlap: float,
    agl: float,
    gsd: float = None,
    image_interval: int = 2,
    dem: str = None,
    flight_mode: FlightMode = FlightMode.WAYLINES,
    rotation_angle: float = 0.0,
    take_off_point: list[float] = None,
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO,
    gimbal_angle: GimbalAngle = GimbalAngle.OFF_NADIR,
):
    """Generate placemarks for a flight plan, applying terrain following when
    a DEM is provided.

    Returns:
        (placemarks, waypoint_data) tuple. `placemarks` is a GeoJSON dict ready
        for either output-file writing or direct return to the frontend.
        `waypoint_data` retains battery/flight-time metadata from
        `create_waypoint` for callers that surface it to the UI.
    """
    # If the user says 30o clockwise rotation, we actually rotate 330o anticlockwise
    rotation_angle = 360 - rotation_angle
    generate_3d = False  # TODO: For 3d imagery support, drone_flightplan package needs to be updated

    parameters = calculate_parameters(
        forward_overlap,
        side_overlap,
        agl,
        gsd,
        image_interval,
        drone_type,
    )

    waypoint_data = create_waypoint(
        project_area=aoi,
        agl=agl,
        gsd=gsd,
        forward_overlap=forward_overlap,
        side_overlap=side_overlap,
        rotation_angle=rotation_angle,
        generate_3d=generate_3d,
        take_off_point=take_off_point,
        drone_type=drone_type,
        mode=flight_mode,
        gimbal_angle=gimbal_angle,
    )
    points_geojson = waypoint_data["geojson"]

    # ---- Terrain follow support ----
    if dem:
        # Per-call temp file so concurrent generations don't clobber each other.
        # GDAL's GeoJSON driver needs a path it can write to, so a managed
        # NamedTemporaryFile + remove-after-read is the cleanest fit.
        fd, elevation_path = tempfile.mkstemp(suffix=".geojson", prefix="elevation_")
        os.close(fd)
        # GDAL won't write to an existing file with the GeoJSON driver
        os.remove(elevation_path)
        try:
            add_elevation_from_dem(dem, points_geojson, elevation_path)
            with open(elevation_path) as f:
                points_geojson = f.read()
        finally:
            if os.path.exists(elevation_path):
                os.remove(elevation_path)

    placemarks = create_placemarks(geojson.loads(points_geojson), parameters)

    if dem and flight_mode == FlightMode.WAYLINES:
        placemarks = waypoints2waylines(placemarks, 5)

    return placemarks, waypoint_data


def write_flightplan_file(
    placemarks: dict,
    drone_type: DroneType,
    outfile: str,
    flight_mode: FlightMode = FlightMode.WAYLINES,
) -> str:
    """Serialize placemarks to the drone-specific output format on disk."""
    output_format = DRONE_PARAMS[drone_type].get("OUTPUT_FORMAT")

    if output_format == "DJI_WMPL":
        outpath = create_wpml(placemarks, outfile)
    elif output_format == "POTENSIC_SQLITE":
        outpath = create_potensic_sqlite(placemarks, outfile)
    elif output_format == "POTENSIC_JSON":
        outpath = create_potensic_json(placemarks, outfile)
    elif output_format == "MAVLINK_PLAN":
        outpath = create_mavlink_plan(placemarks, outfile)
    elif output_format == "QGROUNDCONTROL":
        outpath = create_qgroundcontrol_plan(placemarks, outfile)
    elif output_format == "LITCHI":
        outpath = create_litchi_csv(placemarks, outfile, flight_mode=flight_mode)
    else:
        raise ValueError(f"Unsupported output format: {output_format}")

    log.info(f"Flight plan generated: {outpath}")
    return outpath


def create_flightplan(
    aoi: Union[str, FeatureCollection, dict],
    forward_overlap: float,
    side_overlap: float,
    agl: float,
    gsd: float = None,
    image_interval: int = 2,
    dem: str = None,
    outfile: str = None,
    flight_mode: FlightMode = FlightMode.WAYLINES,
    rotation_angle: float = 0.0,
    take_off_point: list[float] = None,
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO,
    gimbal_angle: GimbalAngle = GimbalAngle.OFF_NADIR,
):
    """Arguments:
        aoi: The area of interest in GeoJSON format.
        forward_overlap: The forward overlap in percentage.
        side_overlap: The side overlap in percentage.
        agl: The altitude above ground level in meters.
        gsd: The ground sampling distance in cm/px.
        image_interval: The time interval between two consecutive images in seconds.
        rotation_angle: The rotation angle for the flight grid in degrees.

    Returns:
        Path to the generated drone flightplan file (e.g. kmz).
    """
    placemarks, _ = build_placemarks(
        aoi=aoi,
        forward_overlap=forward_overlap,
        side_overlap=side_overlap,
        agl=agl,
        gsd=gsd,
        image_interval=image_interval,
        dem=dem,
        flight_mode=flight_mode,
        rotation_angle=rotation_angle,
        take_off_point=take_off_point,
        drone_type=drone_type,
        gimbal_angle=gimbal_angle,
    )
    return write_flightplan_file(placemarks, drone_type, outfile, flight_mode)


def validate_coordinates(value):
    try:
        lon, lat = map(float, value.split(","))
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise argparse.ArgumentTypeError(
                "Coordinates must be in the format 'longitude,latitude' and within valid ranges."
            )
        return [lon, lat]
    except ValueError:
        raise argparse.ArgumentTypeError(
            "Invalid format. Coordinates must be in 'longitude,latitude' format."
        )


def main():
    parser = argparse.ArgumentParser(
        description="Generate waypoints for drone missions.",
        formatter_class=argparse.RawTextHelpFormatter,
    )

    parser.add_argument(
        "--project_geojson",
        required=True,
        type=str,
        help="The GeoJSON polygon representing the area of interest.",
    )

    group = parser.add_mutually_exclusive_group(required=True)

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
        "--drone_type",
        type=drone_type_arg,
        default=DroneType.DJI_MINI_4_PRO,
        help=(
            "The type of drone to use. Options:\n"
            + "\n".join(f"- {name}" for name in DroneType.__members__)
        ),
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

    parser.add_argument("--inraster", help="input DEM GeoTIFF raster file")
    parser.add_argument("--outfile", required=True, help="output GeoJSON file")
    parser.add_argument(
        "--flight_mode",
        type=flight_mode_arg,
        default=FlightMode.WAYLINES,
        help=(
            "Flight mode options:\n"
            + "\n".join(f"- {name}" for name in FlightMode.__members__)
        ),
    )
    parser.add_argument(
        "--rotation_angle",
        type=float,
        default=0.0,
        help="The rotation angle for the flight grid in degrees.",
    )

    takeoff_group = parser.add_mutually_exclusive_group(required=True)
    takeoff_group.add_argument(
        "--take_off_point",
        type=validate_coordinates,
        help="Take off Point Coordinates in 'longitude,latitude' format (e.g., 82.52,28.29).",
    )
    takeoff_group.add_argument(
        "--use_centroid_as_take_off_point",
        action="store_true",
        help="Use the centroid of the AOI polygon as the takeoff point instead of specifying coordinates.",
    )

    args = parser.parse_args()

    with open(args.project_geojson) as f:
        aoi = geojson.load(f)

    if args.use_centroid_as_take_off_point:
        geom = shape(aoi["features"][0]["geometry"])
        centroid = geom.centroid
        take_off_point = [centroid.x, centroid.y]
    else:
        take_off_point = args.take_off_point

    create_flightplan(
        aoi,
        args.forward_overlap,
        args.side_overlap,
        args.altitude_above_ground_level,
        args.gsd,
        args.image_interval,
        args.inraster,
        args.outfile,
        args.flight_mode,
        args.rotation_angle,
        take_off_point,
        args.drone_type,
    )


if __name__ == "__main__":
    main()


# python3 create_flightplan.py --project_geojson '/home/niraj/NAXA/HOT/adarsha_polygons_for_terrain_testing.geojson'  --altitude_above_ground_level 118 --forward_overlap 75 --side_overlap 70 --image_interval 2 --inraster '/home/niraj/Downloads/Bhanu.tif'  --outfile /home/niraj/NAXA/HOT/drone-flightplan/drone_flightplan
