import json

from drone_flightplan.create_flightplan import build_placemarks

# Deliberately skewed, so the optimal angle is not 0
SKEWED_AOI = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [85.3000, 27.7000],
                        [85.3040, 27.7006],
                        [85.3035, 27.7024],
                        [85.2996, 27.7019],
                        [85.3000, 27.7000],
                    ]
                ],
            },
        }
    ],
}

PLAN_PARAMS = {
    "aoi": SKEWED_AOI,
    "forward_overlap": 70,
    "side_overlap": 70,
    "agl": 100,
    "take_off_point": [85.3000, 27.7000],
}


def test_no_angle_auto_aligns_with_longest_edge():
    _, waypoint_data = build_placemarks(rotation_angle=None, **PLAN_PARAMS)
    assert waypoint_data["rotation_angle"] != 0


def test_explicit_zero_is_not_auto_aligned():
    _, waypoint_data = build_placemarks(rotation_angle=0.0, **PLAN_PARAMS)
    assert waypoint_data["rotation_angle"] == 0


def test_applied_angle_round_trips():
    """The UI seeds its rotation control from this angle, so the plan must not move."""
    auto_plan, auto_data = build_placemarks(rotation_angle=None, **PLAN_PARAMS)
    replayed_plan, replayed_data = build_placemarks(
        rotation_angle=auto_data["rotation_angle"], **PLAN_PARAMS
    )

    assert replayed_data["rotation_angle"] == auto_data["rotation_angle"]
    assert json.dumps(replayed_plan, sort_keys=True) == json.dumps(
        auto_plan, sort_keys=True
    )
