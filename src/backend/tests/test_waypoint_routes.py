import json
import uuid

import pytest
from app.tasks.task_logic import get_take_off_point_from_db
from app.waypoints import waypoint_routes
from shapely.geometry import shape

_TASK_OUTLINE = {
    "type": "Polygon",
    "coordinates": [
        [
            [-69.49779538720068, 18.629654277305633],
            [-69.48497355306813, 18.616997544638636],
            [-69.54053483430786, 18.608390428368665],
            [-69.5410690773959, 18.614466085056165],
            [-69.49779538720068, 18.629654277305633],
        ]
    ],
}


async def _setup_task(db, project_id: str) -> str:
    """Insert a task with the shared test outline and no take off point."""
    task_id = str(uuid.uuid4())
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, outline, project_task_index)
            VALUES (%s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s)
            """,
            (task_id, project_id, json.dumps(_TASK_OUTLINE), 1),
        )
    await db.commit()
    return task_id


async def _setup_terrain_follow_task(db, project_id: str) -> str:
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET is_terrain_follow = TRUE
            WHERE id = %s
            """,
            (project_id,),
        )
    await db.commit()
    return await _setup_task(db, project_id)


def _capturing_build_placemarks(captured: dict):
    """Stand in for build_placemarks that records the take off point it got."""

    def fake_build_placemarks(**kwargs):
        captured["take_off_point"] = kwargs.get("take_off_point")
        return {"type": "FeatureCollection", "features": []}, {
            "battery_warning": False,
            "estimated_flight_time_minutes": 0,
        }

    return fake_build_placemarks


@pytest.mark.asyncio
async def test_default_take_off_point_is_persisted(
    client, db, create_test_project, monkeypatch
):
    """Keeping the default take off point must still write it to the db.

    Regression for #826: when the user does not pick a take off point the
    task centroid is used, but it was only computed in memory and the task
    row kept a NULL take_off_point, so exports had no coordinate.
    """
    project_id = create_test_project
    task_id = await _setup_task(db, project_id)
    assert await get_take_off_point_from_db(db, task_id) is None

    captured = {}
    monkeypatch.setattr(
        waypoint_routes, "build_placemarks", _capturing_build_placemarks(captured)
    )

    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=false"
    )
    assert response.status_code == 200

    centroid = shape(_TASK_OUTLINE).centroid
    stored = await get_take_off_point_from_db(db, task_id)
    assert stored is not None
    assert stored["type"] == "Point"
    assert stored["coordinates"] == pytest.approx([centroid.x, centroid.y])
    # The flight plan was generated with the very point that got persisted
    assert captured["take_off_point"] == pytest.approx(stored["coordinates"])


@pytest.mark.asyncio
async def test_supplied_take_off_point_replaces_persisted_default(
    client, db, create_test_project, monkeypatch
):
    """A user supplied point must win over a previously persisted default."""
    project_id = create_test_project
    task_id = await _setup_task(db, project_id)

    captured = {}
    monkeypatch.setattr(
        waypoint_routes, "build_placemarks", _capturing_build_placemarks(captured)
    )

    # First call without a point persists the centroid default
    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=false"
    )
    assert response.status_code == 200
    default_point = await get_take_off_point_from_db(db, task_id)
    assert default_point is not None

    # Second call with an explicit point inside the task replaces it
    manual_point = {"longitude": -69.51, "latitude": 18.62}
    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=false",
        json=manual_point,
    )
    assert response.status_code == 200

    stored = await get_take_off_point_from_db(db, task_id)
    assert stored["coordinates"] == pytest.approx(
        [manual_point["longitude"], manual_point["latitude"]]
    )
    assert stored["coordinates"] != pytest.approx(default_point["coordinates"])
    assert captured["take_off_point"] == pytest.approx(stored["coordinates"])


@pytest.mark.asyncio
async def test_terrain_follow_missing_dem_returns_409(
    client, db, create_test_project, monkeypatch
):
    project_id = create_test_project
    task_id = await _setup_terrain_follow_task(db, project_id)

    monkeypatch.setattr(waypoint_routes, "check_file_exists", lambda *args: False)

    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=true"
    )

    assert response.status_code == 409
    payload = response.json()
    assert payload["detail"]["code"] == "MISSING_TERRAIN_DEM"


@pytest.mark.asyncio
async def test_terrain_follow_missing_dem_can_override(
    client, db, create_test_project, monkeypatch
):
    project_id = create_test_project
    task_id = await _setup_terrain_follow_task(db, project_id)

    monkeypatch.setattr(waypoint_routes, "check_file_exists", lambda *args: False)

    captured = {}

    def fake_build_placemarks(**kwargs):
        captured["dem"] = kwargs.get("dem")
        return {"type": "FeatureCollection", "features": []}, {
            "rotation_angle": 0,
            "battery_warning": False,
            "estimated_flight_time_minutes": 0,
        }

    def fake_write_flightplan_file(_placemarks, _drone_type, outfile, _mode):
        output_path = f"{outfile}.kmz"
        with open(output_path, "wb") as output_file:
            output_file.write(b"dummy-kmz")
        return output_path

    monkeypatch.setattr(waypoint_routes, "build_placemarks", fake_build_placemarks)
    monkeypatch.setattr(
        waypoint_routes, "write_flightplan_file", fake_write_flightplan_file
    )

    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=true&allow_missing_dem=true"
    )

    assert response.status_code == 200
    assert response.content == b"dummy-kmz"
    # Override path skips the DEM, so build_placemarks must receive dem=None
    assert captured["dem"] is None


@pytest.mark.asyncio
async def test_terrain_follow_dem_present_in_s3_downloads_before_generation(
    client, db, create_test_project, monkeypatch
):
    project_id = create_test_project
    task_id = await _setup_terrain_follow_task(db, project_id)

    monkeypatch.setattr(waypoint_routes, "check_file_exists", lambda *args: True)

    def fake_get_file_from_bucket(_bucket, _key, file_path):
        with open(file_path, "wb") as dem_file:
            dem_file.write(b"dem-bytes")

    monkeypatch.setattr(
        waypoint_routes, "get_file_from_bucket", fake_get_file_from_bucket
    )

    captured = {}

    def fake_build_placemarks(**kwargs):
        captured["dem"] = kwargs["dem"]
        return {"type": "FeatureCollection", "features": []}, {
            "rotation_angle": 0,
            "battery_warning": False,
            "estimated_flight_time_minutes": 0,
        }

    def fake_write_flightplan_file(_placemarks, _drone_type, outfile, _mode):
        output_path = f"{outfile}.kmz"
        with open(output_path, "wb") as output_file:
            output_file.write(b"dummy-kmz")
        return output_path

    monkeypatch.setattr(waypoint_routes, "build_placemarks", fake_build_placemarks)
    monkeypatch.setattr(
        waypoint_routes, "write_flightplan_file", fake_write_flightplan_file
    )

    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=true"
    )

    assert response.status_code == 200
    assert response.content == b"dummy-kmz"
    assert captured["dem"]


@pytest.mark.asyncio
async def test_terrain_follow_preview_passes_dem_to_placemarks(
    client, db, create_test_project, monkeypatch
):
    """The preview (download=false) path must apply terrain following too.

    Regression for the bug where the JSON preview returned constant-AGL
    waypoints because the DEM was downloaded but never passed to placemark
    generation.
    """
    project_id = create_test_project
    task_id = await _setup_terrain_follow_task(db, project_id)

    monkeypatch.setattr(waypoint_routes, "check_file_exists", lambda *args: True)

    def fake_get_file_from_bucket(_bucket, _key, file_path):
        with open(file_path, "wb") as dem_file:
            dem_file.write(b"dem-bytes")

    monkeypatch.setattr(
        waypoint_routes, "get_file_from_bucket", fake_get_file_from_bucket
    )

    captured = {}

    def fake_build_placemarks(**kwargs):
        captured["dem"] = kwargs["dem"]
        return {"type": "FeatureCollection", "features": []}, {
            "rotation_angle": 0,
            "battery_warning": False,
            "estimated_flight_time_minutes": 0,
        }

    monkeypatch.setattr(waypoint_routes, "build_placemarks", fake_build_placemarks)

    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=false"
    )

    assert response.status_code == 200
    assert captured["dem"], "preview path must receive the DEM file path"
