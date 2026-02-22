import json
import uuid

from app.waypoints import waypoint_routes


async def _setup_terrain_follow_task(db, project_id: str) -> str:
    task_id = str(uuid.uuid4())
    outline = {
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

    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET is_terrain_follow = TRUE
            WHERE id = %s
            """,
            (project_id,),
        )
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, outline, project_task_index)
            VALUES (%s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s)
            """,
            (task_id, project_id, json.dumps(outline), 1),
        )
    await db.commit()
    return task_id


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


async def test_terrain_follow_missing_dem_can_override(
    client, db, create_test_project, monkeypatch
):
    project_id = create_test_project
    task_id = await _setup_terrain_follow_task(db, project_id)

    monkeypatch.setattr(waypoint_routes, "check_file_exists", lambda *args: False)

    def fake_create_flightplan(**kwargs):
        output_path = f"{kwargs['outfile']}.kmz"
        with open(output_path, "wb") as output_file:
            output_file.write(b"dummy-kmz")
        return output_path

    monkeypatch.setattr(waypoint_routes, "create_flightplan", fake_create_flightplan)

    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=true&allow_missing_dem=true"
    )

    assert response.status_code == 200
    assert response.content == b"dummy-kmz"


async def test_terrain_follow_dem_present_in_s3_downloads_before_generation(
    client, db, create_test_project, monkeypatch
):
    project_id = create_test_project
    task_id = await _setup_terrain_follow_task(db, project_id)

    monkeypatch.setattr(waypoint_routes, "check_file_exists", lambda *args: True)

    def fake_get_file_from_bucket(_bucket, _key, file_path):
        with open(file_path, "wb") as dem_file:
            dem_file.write(b"dem-bytes")
        return None

    monkeypatch.setattr(
        waypoint_routes, "get_file_from_bucket", fake_get_file_from_bucket
    )

    captured = {}

    def fake_create_flightplan(**kwargs):
        captured["dem"] = kwargs["dem"]
        output_path = f"{kwargs['outfile']}.kmz"
        with open(output_path, "wb") as output_file:
            output_file.write(b"dummy-kmz")
        return output_path

    monkeypatch.setattr(waypoint_routes, "create_flightplan", fake_create_flightplan)

    response = await client.post(
        f"/api/waypoint/task/{task_id}/?project_id={project_id}&download=true"
    )

    assert response.status_code == 200
    assert response.content == b"dummy-kmz"
    assert captured["dem"]
