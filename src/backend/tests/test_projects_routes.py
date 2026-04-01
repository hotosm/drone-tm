import json
import uuid
from io import BytesIO

import pytest
from fastapi import HTTPException
from loguru import logger as log

from app.projects import project_routes
from app.projects import project_schemas


@pytest.mark.asyncio
async def test_create_project_with_files(
    client,
    project_info,
):
    """Test to verify the project creation API with file upload (image as binary data)."""
    project_info_json = json.dumps(project_info.model_dump())
    files = {
        "project_info": (None, project_info_json, "application/json"),
        "dem": None,
        "image": None,
    }

    files = {k: v for k, v in files.items() if v is not None}
    response = await client.post("/api/projects/", files=files)
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_upload_project_task_boundaries(client, create_test_project):
    """Test to verify the upload of task boundaries."""
    project_id = create_test_project
    log.debug(f"Testing project ID: {project_id}")
    task_geojson = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "coordinates": [
                            [
                                [85.32002733312942, 27.706336826417214],
                                [85.31945017091391, 27.705465823954995],
                                [85.32117509889912, 27.704809664174988],
                                [85.32135218276034, 27.70612197978899],
                                [85.32002733312942, 27.706336826417214],
                            ]
                        ],
                        "type": "Polygon",
                    },
                }
            ],
        }
    ).encode("utf-8")

    geojson_files = {
        "geojson": ("file.geojson", BytesIO(task_geojson), "application/geo+json")
    }
    response = await client.post(
        f"/api/projects/{project_id}/upload-task-boundaries", files=geojson_files
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_read_projects(client):
    """Test reading all projects."""
    response = await client.get("/api/projects/")
    assert response.status_code == 200
    assert "results" in response.json()


@pytest.mark.asyncio
async def test_read_project(client, create_test_project):
    """Test reading a single project."""
    project_id = create_test_project
    response = await client.get(f"/api/projects/{project_id}")
    assert response.status_code == 200
    assert response.json()["id"] == project_id


@pytest.mark.asyncio
async def test_read_project_by_slug(client, db, create_test_project):
    """Project detail endpoint should accept the stored slug."""
    project = await project_schemas.DbProject.one(db, create_test_project)

    response = await client.get(f"/api/projects/{project.slug}")

    assert response.status_code == 200
    assert response.json()["id"] == create_test_project


@pytest.mark.asyncio
async def test_project_slug_uses_name_without_timestamp():
    """New project slugs should be clean slugified names."""
    project = project_schemas.ProjectIn(
        name="My Project",
        description="",
        outline={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
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
                    },
                }
            ],
        },
        final_output=["ORTHOPHOTO_2D"],
    )

    assert project.slug == "my-project"


@pytest.mark.asyncio
async def test_read_project_includes_has_gcp_flag(
    client, create_test_project, monkeypatch
):
    project_id = create_test_project
    monkeypatch.setattr(project_schemas, "check_file_exists", lambda *_args: True)

    response = await client.get(f"/api/projects/{project_id}")

    assert response.status_code == 200
    assert response.json()["has_gcp"] is True


@pytest.mark.asyncio
async def test_read_project_centroids(client):
    """Test reading project centroids."""
    response = await client.get("/api/projects/centroids")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_create_terrain_follow_project_succeeds_when_redis_unavailable(
    client, project_info, monkeypatch
):
    project_info.is_terrain_follow = True
    project_info_json = json.dumps(project_info.model_dump())

    async def fake_get_redis_pool():
        raise HTTPException(status_code=500, detail="Background worker unavailable")

    monkeypatch.setattr(project_routes, "get_redis_pool", fake_get_redis_pool)

    response = await client.post(
        "/api/projects/",
        files={"project_info": (None, project_info_json, "application/json")},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_preview_split_multi_feature(client):
    """Uploading a multi-feature FeatureCollection should not error.

    Regression test for #735 - FeatureCollections exported by QGIS
    contain multiple features and previously only the first was used.
    """
    multi_featcol = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [85.319, 27.705],
                                [85.320, 27.705],
                                [85.320, 27.706],
                                [85.319, 27.706],
                                [85.319, 27.705],
                            ]
                        ],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [85.320, 27.705],
                                [85.321, 27.705],
                                [85.321, 27.706],
                                [85.320, 27.706],
                                [85.320, 27.705],
                            ]
                        ],
                    },
                },
            ],
        }
    ).encode("utf-8")

    files = {
        "project_geojson": (
            "aoi.geojson",
            BytesIO(multi_featcol),
            "application/geo+json",
        ),
    }
    response = await client.post(
        "/api/projects/preview-split-by-square/",
        files=files,
        data={"dimension": 100},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) > 0


@pytest.mark.asyncio
async def test_normalize_aoi_merges_multi_feature_upload(client):
    """Multipart AOIs should be merged before being returned to the frontend."""
    multi_featcol = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [85.319, 27.705],
                                [85.320, 27.705],
                                [85.320, 27.706],
                                [85.319, 27.706],
                                [85.319, 27.705],
                            ]
                        ],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [85.320, 27.705],
                                [85.321, 27.705],
                                [85.321, 27.706],
                                [85.320, 27.706],
                                [85.320, 27.705],
                            ]
                        ],
                    },
                },
            ],
        }
    ).encode("utf-8")

    files = {
        "project_geojson": (
            "aoi.geojson",
            BytesIO(multi_featcol),
            "application/geo+json",
        ),
    }
    response = await client.post("/api/projects/normalize-aoi/", files=files)

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 1
    assert body["features"][0]["geometry"]["type"] == "Polygon"


@pytest.mark.asyncio
async def test_normalize_aoi_converts_multipolygon_upload(client):
    """A single-feature MultiPolygon AOI should be coerced to one Polygon."""
    multipolygon = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "MultiPolygon",
                        "coordinates": [
                            [
                                [
                                    [85.319, 27.705],
                                    [85.320, 27.705],
                                    [85.320, 27.706],
                                    [85.319, 27.706],
                                    [85.319, 27.705],
                                ]
                            ],
                            [
                                [
                                    [85.321, 27.705],
                                    [85.322, 27.705],
                                    [85.322, 27.706],
                                    [85.321, 27.706],
                                    [85.321, 27.705],
                                ]
                            ],
                        ],
                    },
                }
            ],
        }
    ).encode("utf-8")

    files = {
        "project_geojson": (
            "aoi.geojson",
            BytesIO(multipolygon),
            "application/geo+json",
        ),
    }
    response = await client.post("/api/projects/normalize-aoi/", files=files)

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 1
    assert body["features"][0]["geometry"]["type"] == "Polygon"


@pytest.mark.asyncio
async def test_odm_queue_info_omits_deleted_completed_tasks(
    client, db, auth_user, create_test_project, monkeypatch
):
    project_id = create_test_project
    task_id = str(uuid.uuid4())
    odm_task_uuid = str(uuid.uuid4())
    outline = json.dumps(
        {
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
    )

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (
                id,
                project_id,
                project_task_index,
                outline,
                odm_task_uuid,
                assets_url
            )
            VALUES (
                %s,
                %s,
                %s,
                ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                %s,
                %s
            )
            """,
            (
                task_id,
                project_id,
                15,
                outline,
                odm_task_uuid,
                f"projects/{project_id}/{task_id}/assets.zip",
            ),
        )
        await cur.execute(
            """
            INSERT INTO task_events (
                event_id,
                project_id,
                task_id,
                user_id,
                state,
                comment,
                updated_at,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                %s,
                %s,
                %s,
                %s,
                %s,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            """,
            (
                project_id,
                task_id,
                auth_user.id,
                "IMAGE_PROCESSING_FINISHED",
                "Task completed.",
            ),
        )
    await db.commit()

    class FakeResponse:
        status = 200

        async def json(self):
            return {"error": f"{odm_task_uuid} not found"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeSession:
        def __init__(self, *args, **kwargs):
            pass

        def get(self, _url):
            return FakeResponse()

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(project_routes.aiohttp, "ClientSession", FakeSession)

    response = await client.get(f"/api/projects/odm/queue-info/{project_id}/")

    assert response.status_code == 200
    body = response.json()
    assert body["total_completed"] == 0
    assert body["total_canceled"] == 0
    assert body["total_tasks"] == 0
    assert body["groups"] == []


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
