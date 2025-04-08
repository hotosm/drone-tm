"""Drone FlightPlan Package."""

import os

__all__ = [
    "add_elevation_from_dem",
    "create_flightplan",
    "create_waypoint",
    "create_wpml",
    "calculate_parameters",
    "create_placemarks",
]

package_root = os.path.dirname(os.path.abspath(__file__))
