"""Drone FlightPlan Package."""

import os
from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.create_placemarks import create_placemarks
from drone_flightplan.waypoints import create_waypoint
from drone_flightplan.add_elevation_from_dem import add_elevation_from_dem
from drone_flightplan.output.dji import create_wpml
from drone_flightplan.create_flightplan import (
    build_placemarks,
    create_flightplan,
    write_flightplan_file,
)

__all__ = [
    "add_elevation_from_dem",
    "build_placemarks",
    "create_flightplan",
    "create_waypoint",
    "create_wpml",
    "calculate_parameters",
    "create_placemarks",
    "write_flightplan_file",
]

package_root = os.path.dirname(os.path.abspath(__file__))
