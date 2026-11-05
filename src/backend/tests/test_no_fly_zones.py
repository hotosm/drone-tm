"""No-fly zones are respected when planning flights and creating tasks."""

import json
import uuid
from math import cos, radians

import pytest
from app.images.flight_gap_identification import _generate_flightplan_for_geometry
from app.projects import project_logic, project_schemas
from app.waypoints import waypoint_routes
from drone_flightplan import (
    NoFlyZoneConflictError,
    calculate_parameters,
    create_placemarks,
    create_waypoint,
)
from drone_flightplan.drone_type import DroneType
from drone_flightplan.enums import FlightMode
from drone_flightplan.terrain_following_waylines import waypoints2waylines
from drone_flightplan.waypoints import add_return_home_waypoint, route_round_trip
from fastapi import HTTPException
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import transform

TASK = box(85.3, 27.71, 85.304, 27.712)
NORTH_ZONE = shape(
    {
        "type": "Polygon",
        "coordinates": [
            [
                [85.299, 27.7115],
                [85.305, 27.7118],
                [85.305, 27.715],
                [85.299, 27.715],
                [85.299, 27.7115],
            ]
        ],
    }
)
MIDDLE_ZONE = box(85.3015, 27.7105, 85.3025, 27.7115)
SOUTH_TAKEOFF = [85.302, 27.7095]
V_AREA = box(85.30, 27.71, 85.304, 27.7132)
V_TAKEOFF = [85.295, 27.7115]
PARAMS = {
    "agl": 115,
    "gsd": 3.5,
    "forward_overlap": 75,
    "side_overlap": 75,
}


def feature(geometry) -> dict:
    return {"type": "Feature", "properties": {}, "geometry": mapping(geometry)}


def featcol(*geometries) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [feature(geometry) for geometry in geometries],
    }


def plan(zone=None, mode=FlightMode.WAYPOINTS, area=TASK, **kwargs) -> dict:
    kwargs.setdefault("take_off_point", SOUTH_TAKEOFF)
    return create_waypoint(
        project_area=featcol(area), no_fly_zones=zone, mode=mode, **PARAMS, **kwargs
    )


def points_of(result: dict) -> list:
    return [shape(f["geometry"]) for f in json.loads(result["geojson"])["features"]]


def waypoints(zone=None, mode=FlightMode.WAYPOINTS, **kwargs) -> list:
    return points_of(plan(zone, mode, **kwargs))


def zone_on_return_line(mode, area=V_AREA):
    """A zone crossing only the flight home, as the path starts and ends in a V."""
    route = waypoints(area=area, take_off_point=V_TAKEOFF, mode=mode)
    home = LineString([route[-1], route[0]]).interpolate(0.2, normalized=True)
    return box(home.x - 0.00015, home.y - 0.00015, home.x + 0.00015, home.y + 0.00015)


def ground_metres(geometry):
    def scale(x, y):
        return (x * 111_320 * cos(radians(27.71)), y * 111_320)

    return transform(scale, geometry)


@pytest.mark.parametrize("mode", [FlightMode.WAYPOINTS, FlightMode.WAYLINES])
@pytest.mark.parametrize(
    "zone",
    [featcol(NORTH_ZONE), feature(NORTH_ZONE), mapping(NORTH_ZONE)],
    ids=["feature_collection", "feature", "geometry"],
)
def test_flight_keeps_clear_of_zone(zone, mode):
    points = waypoints(zone, mode)

    assert 0 < len(points) < len(waypoints(mode=mode))
    path = ground_metres(LineString(points))
    assert path.distance(ground_metres(NORTH_ZONE)) >= 19.9


def test_leg_crossing_zone_is_blocked_even_with_no_waypoint_inside():
    with pytest.raises(NoFlyZoneConflictError):
        waypoints(featcol(MIDDLE_ZONE))


def test_takeoff_inside_zone_is_blocked():
    with pytest.raises(NoFlyZoneConflictError):
        waypoints(featcol(NORTH_ZONE), take_off_point=[85.302, 27.714])


def test_task_inside_zone_is_blocked():
    with pytest.raises(NoFlyZoneConflictError):
        waypoints(featcol(box(85.29, 27.7, 85.31, 27.72)))


# Line spacing differs by mode, so each needs its own area to end on the west side
@pytest.mark.parametrize(
    ("mode", "area"),
    [
        (FlightMode.WAYPOINTS, V_AREA),
        (FlightMode.WAYLINES, box(85.30, 27.71, 85.304, 27.713)),
    ],
)
def test_blocked_return_home_is_routed_around_zone(mode, area):
    zone = zone_on_return_line(mode, area)
    direct = waypoints(area=area, take_off_point=V_TAKEOFF, mode=mode)

    result = plan(featcol(zone), mode, area=area, take_off_point=V_TAKEOFF)

    route = points_of(result)
    assert len(route) == len(direct) + 1
    assert route[-1] in route[:-1]
    last = json.loads(result["geojson"])["features"][-1]["properties"]
    assert last["take_photo"] is False
    round_trip = LineString([*route, route[0]])
    assert ground_metres(round_trip).distance(ground_metres(zone)) >= 19.9


def test_blocked_return_home_survives_terrain_simplification():
    zone = zone_on_return_line(FlightMode.WAYPOINTS)
    direct = waypoints(area=V_AREA, take_off_point=V_TAKEOFF)
    result = plan(featcol(zone), area=V_AREA, take_off_point=V_TAKEOFF)
    collection = json.loads(result["geojson"])
    assert len(collection["features"]) == len(direct) + 1
    detour = collection["features"][-1]["geometry"]["coordinates"]
    for index, feature in enumerate(collection["features"]):
        feature["geometry"]["coordinates"] = [
            *feature["geometry"]["coordinates"][:2],
            1000 + index % 40,
        ]
    parameters = calculate_parameters(75, 75, 115, 3.5, 2)

    placemarks = waypoints2waylines(create_placemarks(collection, parameters), 5)

    final = placemarks["features"][-1]["geometry"]["coordinates"]
    assert final[:2] == pytest.approx(detour[:2])


def test_unroutable_return_home_is_left_for_the_final_check_to_block():
    def waypoint(x, y):
        return {"coordinates": Point(x, y), "angle": 90, "take_photo": False}

    route = [waypoint(0, 0), waypoint(100, 0), waypoint(100, 100)]
    zones = [box(40, 40, 60, 60), box(90, 40, 110, 60)]

    assert add_return_home_waypoint(route, zones, 1) == route
    with pytest.raises(NoFlyZoneConflictError):
        route_round_trip(route, zones, 1)


def test_missing_takeoff_point_is_blocked_when_project_has_zones():
    with pytest.raises(NoFlyZoneConflictError, match="takeoff point"):
        waypoints(featcol(NORTH_ZONE), take_off_point=None)


def test_warns_only_when_returning_home_early_would_cross_a_zone():
    assert plan(featcol(NORTH_ZONE))["no_fly_return_warning"] is False

    zone = zone_on_return_line(FlightMode.WAYPOINTS)
    result = plan(featcol(zone), area=V_AREA, take_off_point=V_TAKEOFF)
    assert result["no_fly_return_warning"] is True


@pytest.mark.parametrize(
    ("take_off_point", "plan_expected"),
    [
        (None, False),
        ([85.302, 27.7145], False),
        (SOUTH_TAKEOFF, True),
    ],
    ids=["no_stored_takeoff", "takeoff_across_zone", "clear_takeoff"],
)
def test_reflight_is_checked_from_the_real_takeoff_point(take_off_point, plan_expected):
    """The gap's own centre says nothing about where the pilot launches."""
    gap = box(85.301, 27.7102, 85.303, 27.7108)

    result = _generate_flightplan_for_geometry(
        gap,
        drone_type=DroneType.DJI_MINI_4_PRO,
        average_altitude=115,
        no_fly_zones=feature(box(85.2, 27.711, 85.4, 27.714)),
        take_off_point=take_off_point,
    )

    assert (result is not None) is plan_expected


def test_no_zones_leaves_flight_unchanged():
    assert waypoints(None) == waypoints({"type": "FeatureCollection", "features": []})


def test_clip_tasks_cuts_zone_out_and_drops_covered_tasks():
    kept = box(85.3, 27.71, 85.302, 27.711)
    covered = box(85.301, 27.713, 85.303, 27.714)
    tasks = featcol(TASK, kept, covered)

    clipped = project_logic.clip_tasks_to_no_fly_zones(tasks, feature(NORTH_ZONE))

    geometries = [shape(f["geometry"]) for f in clipped["features"]]
    assert len(geometries) == 2
    assert all(g.intersection(NORTH_ZONE).area < 1e-12 for g in geometries)


def test_clip_tasks_splits_a_task_cut_in_two():
    strip = box(85.3015, 27.7, 85.3025, 27.72)

    clipped = project_logic.clip_tasks_to_no_fly_zones(featcol(TASK), feature(strip))

    assert [f["geometry"]["type"] for f in clipped["features"]] == ["Polygon"] * 2


def test_no_fly_zone_rings_lists_each_polygon_exterior():
    far_zone = box(86, 28, 86.01, 28.01)
    zones = {
        "type": "MultiPolygon",
        "coordinates": [
            mapping(NORTH_ZONE)["coordinates"],
            mapping(far_zone)["coordinates"],
        ],
    }

    rings = project_logic.no_fly_zone_rings(zones)

    assert len(rings) == 2
    assert rings[0][0] == rings[0][-1]
    assert project_logic.no_fly_zone_rings(None) == []


@pytest.mark.asyncio
async def test_project_zones_reach_flight_clients(client, db, auth_user, project_info):
    """The stored project zones must be readable by each generator's caller."""
    project = project_schemas.ProjectIn.model_validate(
        {**project_info.model_dump(), "no_fly_zones": featcol(NORTH_ZONE)}
    )
    project_id = await project_schemas.DbProject.create(db, project, auth_user.id)

    stored = await project_schemas.DbProject.one(db, project_id)
    assert len(project_logic.no_fly_zone_rings(stored.no_fly_zones)) == 1

    response = await client.get(f"/api/projects/{project_id}/flightplanner-params")
    assert response.status_code == 200
    assert len(response.json()["noFlyZones"]) == 1

    project_response = await client.get(f"/api/projects/{project_id}")
    assert project_response.json()["no_fly_zones"]["type"] == "Feature"


@pytest.mark.asyncio
async def test_task_flightplan_conflict_returns_409(db, auth_user, project_info):
    """A task whose flight can't avoid a zone gets no flight plan at all."""
    project = project_schemas.ProjectIn.model_validate(
        {**project_info.model_dump(), "no_fly_zones": featcol(MIDDLE_ZONE)}
    )
    project_id = await project_schemas.DbProject.create(db, project, auth_user.id)
    task_id = uuid.uuid4()
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, outline, project_task_index)
            VALUES (%s, %s, ST_GeomFromGeoJSON(%s), 1)
            """,
            (task_id, project_id, json.dumps(mapping(TASK))),
        )

    with pytest.raises(HTTPException) as error:
        await waypoint_routes.get_task_flightplan(
            db=db, project_id=project_id, task_id=task_id, download=False
        )

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "NO_FLY_ZONE_CONFLICT"
