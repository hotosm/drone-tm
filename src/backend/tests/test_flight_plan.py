"""Unit tests for POST /api/public/flight-plan/.

Pure-unit: no database, no HTTP server, no external services. They call
create_waypoint directly (the same pure function the endpoint wraps) so the
suite passes wherever the Python dependencies are installed.
"""

import geojson
from drone_flightplan import create_waypoint
from drone_flightplan.drone_type import DroneType
from drone_flightplan.enums import FlightMode

from app.projects.flight_preview import FlightPlanRequest

# ~400 m × 400 m polygon near Santo Domingo.
_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [-69.5000, 18.6200],
            [-69.5000, 18.6236],
            [-69.4962, 18.6236],
            [-69.4962, 18.6200],
            [-69.5000, 18.6200],
        ]
    ],
}


def _generate():
    feature = geojson.Feature(geometry=_POLYGON)
    return create_waypoint(
        project_area=feature,
        agl=70,
        gsd=None,
        forward_overlap=75,
        side_overlap=70,
        mode=FlightMode.WAYLINES,
        take_off_point=[-69.4981, 18.6218],
        drone_type=DroneType.DJI_MINI_4_PRO,
    )


def test_request_defaults():
    req = FlightPlanRequest(polygon={"type": "Feature", "geometry": _POLYGON})
    assert req.altitude == 70
    assert req.mode == FlightMode.WAYLINES
    assert req.drone_type == DroneType.DJI_MINI_4_PRO
    assert req.take_off_point is None


def test_create_waypoint_returns_point_feature_collection():
    result = _generate()
    fc = geojson.loads(result["geojson"])
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) > 0
    for feat in fc["features"]:
        assert feat["geometry"]["type"] == "Point"
        assert "index" in feat["properties"]
    # First waypoint is the take-off point.
    assert fc["features"][0]["properties"]["index"] == 0
