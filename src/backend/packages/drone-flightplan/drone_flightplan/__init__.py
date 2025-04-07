"""Drone FlightPlan Package."""

import os

from drone_flightplan.add_elevation_from_dem import add_elevation_from_dem
from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.create_flightplan import create_flightplan
from drone_flightplan.create_placemarks import create_placemarks
from drone_flightplan.waypoints import create_waypoint
from drone_flightplan.wpml import create_wpml

package_root = os.path.dirname(os.path.abspath(__file__))
