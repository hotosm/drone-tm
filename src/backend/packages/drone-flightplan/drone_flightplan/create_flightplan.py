import argparse
import logging
from typing import Union

import geojson
from geojson import FeatureCollection

from drone_flightplan.add_elevation_from_dem import add_elevation_from_dem
from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.create_placemarks import create_placemarks
from drone_flightplan.waypoints import create_waypoint
from drone_flightplan.drone_type import DroneType, DRONE_PARAMS, drone_type_arg
from drone_flightplan.output.dji import create_wpml
from drone_flightplan.output.potensic import generate_potensic_sqlite

# Instantiate logger
log = logging.getLogger(__name__)


def create_flightplan(
    aoi: Union[str, FeatureCollection, dict],
    forward_overlap: float,
    side_overlap: float,
    agl: float,
    gsd: float = None,
    image_interval: int = 2,
    dem: str = None,
    outfile: str = None,
    generate_each_points: bool = False,
    rotation_angle: float = 0.0,
    take_off_point: list[float] = None,
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO,
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
        Drone Flightplan in kmz format
    """
    parameters = calculate_parameters(
        forward_overlap,
        side_overlap,
        agl,
        gsd,
        image_interval,
        drone_type,
    )

    waypoints = create_waypoint(
        aoi,
        agl,
        gsd,
        forward_overlap,
        side_overlap,
        rotation_angle,
        generate_each_points,
        take_off_point=take_off_point,
        drone_type=drone_type,
    )

    # Add elevation data to the waypoints
    if dem:
        # TODO: Do this with inmemory data
        outfile_with_elevation = "/tmp/output_file_with_elevation.geojson"
        add_elevation_from_dem(dem, waypoints, outfile_with_elevation)

        inpointsfile = open(outfile_with_elevation, "r")
        waypoints = inpointsfile.read()

    # calculate the placemark data
    placemarks = create_placemarks(geojson.loads(waypoints), parameters)

    # create flightplan files
    output_format = DRONE_PARAMS[drone_type].get("OUTPUT_FORMAT")
    if output_format == "DJI_WMPL":
        outpath = create_wpml(placemarks, outfile)
    elif output_format == "POTENSIC_SQLITE":
        outpath = generate_potensic_sqlite(placemarks, outfile)
    else:
        log.error(f"Unsupported output format: {output_format}")
        return

    log.info(f"Flight plan generated in the path {outpath}")
    return outpath


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
        "--generate_each_points",
        action="store_true",
        help="Do you want waypoints or waylines.",
    )
    parser.add_argument(
        "--rotation_angle",
        type=float,
        default=0.0,
        help="The rotation angle for the flight grid in degrees.",
    )

    parser.add_argument(
        "--take_off_point",
        required=True,
        type=validate_coordinates,
        help="Take off Point Coordinates in 'longitude,latitude' format (e.g., 82.52,28.29).",
    )
    args = parser.parse_args()

    with open(args.project_geojson, "r") as f:
        aoi = geojson.load(f)

    create_flightplan(
        aoi,
        args.forward_overlap,
        args.side_overlap,
        args.altitude_above_ground_level,
        args.gsd,
        args.image_interval,
        args.inraster,
        args.outfile,
        args.generate_each_points,
        args.rotation_angle,
        args.take_off_point,
        args.drone_type,
    )


if __name__ == "__main__":
    main()


# python3 create_flightplan.py --project_geojson '/home/niraj/NAXA/HOT/adarsha_polygons_for_terrain_testing.geojson'  --altitude_above_ground_level 118 --forward_overlap 75 --side_overlap 70 --image_interval 2 --inraster '/home/niraj/Downloads/Bhanu.tif'  --outfile /home/niraj/NAXA/HOT/drone-flightplan/drone_flightplan --generate_each_points
