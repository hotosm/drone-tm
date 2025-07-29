import argparse
import json
from typing import Union

import geojson
from geojson import FeatureCollection


def create_placemarks(
    waypoints_geojson: Union[str, FeatureCollection, dict], parameters: dict
):
    """Arguments:
        waypoints_geojson: The waypoint coordinates to be included in the flightplan mission
        parameters: The drone flight parameters in a json
    Returns:
        Geojson object.
    """
    ground_speed = parameters["ground_speed"]
    agl = parameters["altitude_above_ground_level"]

    try:
        first_point = waypoints_geojson["features"][0]
        base_elevation = first_point["geometry"]["coordinates"][2]
    except IndexError:
        base_elevation = 0

    for feature in waypoints_geojson["features"]:
        coords = feature["geometry"]["coordinates"]
        try:
            elevation = coords[2]
            difference_in_elevation = base_elevation - elevation
            altitude = agl - difference_in_elevation
            coords[2] = altitude
        except IndexError:
            altitude = agl
            coords.append(altitude)

        feature["properties"]["speed"] = ground_speed
        feature["properties"]["altitude"] = altitude

    return waypoints_geojson


def main(args_list: list[str] | None = None):
    def json_to_dict(value):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            raise argparse.ArgumentTypeError(f"Invalid JSON string: {value}")

    parser = argparse.ArgumentParser(
        description="Generate placemark data for drone missions."
    )
    parser.add_argument(
        "--waypoints_geojson",
        required=True,
        type=str,
        help="The waypoint coordinates to be included in the flightplan mission",
    )
    # NOTE this is passed as a json string via cmd line, not as a json file
    parser.add_argument(
        "--parameters",
        type=json_to_dict,
        help="The drone flight parameters in a json. Including ground_speed and altitude_above_ground_level.",
    )

    parser.add_argument("--outfile", required=True, help="output GeoJSON file")

    args = parser.parse_args(args_list)

    if args.parameters is None:
        raise ValueError("The parameters json must be included via command line")
    if "altitude_above_ground_level" not in args.parameters:
        raise ValueError(
            "altitude_above_ground_level is missing in the parameters json"
        )
    if "ground_speed" not in args.parameters:
        raise ValueError("ground_speed is missing in the parameters")

    inpointsfile = open(args.waypoints_geojson, "r")
    points = inpointsfile.read()

    placemark_data = create_placemarks(geojson.loads(points), args.parameters)

    with open(args.outfile, "w") as f:
        f.write(geojson.dumps(placemark_data, indent=2))


if __name__ == "__main__":
    main()

# python3 create_placemarks.py --waypoints_geojson '/home/niraj/NAXA/HOT/drone-flightplan/drone_flightplan/waypoints_2.geojson' --parameters '{"forward_photo_height": 84.0, "side_photo_width": 149.0, "forward_spacing": 20.95, "side_spacing": 44.6, "ground_speed": 10.47, "altitude_above_ground_level": 118}'
