import json
import uuid
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException
from httpx import ASGITransport, AsyncClient
from loguru import logger as log

from app.arq.tasks import get_redis_pool
from app.projects import project_deps
from app.projects import project_routes
from app.projects import project_schemas
from app.projects import project_logic


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
async def test_create_project_commits_before_return(monkeypatch, project_info):
    """Create should commit before returning the id used by task-boundary upload."""
    project_id = uuid.uuid4()

    class FakeDb:
        committed = False

        async def commit(self):
            self.committed = True

    db = FakeDb()

    async def fake_create(_db, _project_info, _user_id):
        return project_id

    monkeypatch.setattr(project_schemas.DbProject, "create", fake_create)

    response = await project_routes.create_project(
        project_info=project_info,
        db=db,
        background_tasks=BackgroundTasks(),
        user_data=SimpleNamespace(
            id="101039844375937810000",
            email="admin@hotosm.org",
            name="admin",
        ),
        dem=None,
        image=None,
    )

    assert db.committed is True
    assert response["project_id"] == project_id


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


def test_project_info_serializes_project_planning_metadata(monkeypatch):
    """Project detail response model should preserve creation and planning fields."""
    monkeypatch.setattr(
        project_schemas, "maybe_presign_s3_key", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        project_schemas, "check_file_exists", lambda *_args, **_kwargs: False
    )

    project = project_schemas.ProjectInfo(
        id=uuid.uuid4(),
        name="Planning Metadata",
        description="",
        requires_approval_from_manager_for_locking=False,
        outline=None,
        author_id="101039844375937810000",
        created_at=datetime(2026, 5, 7, tzinfo=timezone.utc),
        final_output=["ORTHOPHOTO_2D", "DIGITAL_TERRAIN_MODEL"],
        gsd_cm_px=2.5,
        altitude_from_ground=74.25,
        task_split_dimension=400,
    )

    data = project.model_dump(mode="json")

    assert data["created_at"] == "2026-05-07T00:00:00Z"
    assert data["final_output"] == ["ORTHOPHOTO_2D", "DIGITAL_TERRAIN_MODEL"]
    assert data["gsd_cm_px"] == 2.5
    assert data["altitude_from_ground"] == 74.25
    assert data["task_split_dimension"] == 400


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
async def test_read_project_includes_project_planning_metadata(
    client, create_test_project
):
    project_id = create_test_project

    response = await client.get(f"/api/projects/{project_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["created_at"]
    assert data["final_output"] == ["ORTHOPHOTO_2D"]
    assert data["gsd_cm_px"] == 1
    assert data["altitude_from_ground"] is None
    assert data["task_split_dimension"] == 400


@pytest.mark.asyncio
async def test_head_project_odm_assets_returns_available(app, monkeypatch):
    project_id = uuid.uuid4()
    s3_object = SimpleNamespace(
        object_name=f"projects/{project_id}/odm/odm_orthophoto/odm_orthophoto.tif",
        is_dir=False,
        last_modified=datetime.now(timezone.utc),
    )

    class FakeS3Client:
        def list_objects(self, bucket_name, prefix, recursive=False):
            assert recursive is True
            assert prefix == f"projects/{project_id}/odm/"
            return (obj for obj in [s3_object] if obj.object_name.startswith(prefix))

    monkeypatch.setattr(project_routes, "s3_client", lambda: FakeS3Client())
    app.dependency_overrides[project_deps.get_project_by_id] = lambda: SimpleNamespace(
        id=project_id
    )

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as test_client:
            response = await test_client.head(f"/api/projects/odm/export/{project_id}/")
    finally:
        app.dependency_overrides.pop(project_deps.get_project_by_id, None)

    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["content-type"].startswith("application/zip")
    assert (
        response.headers["content-disposition"]
        == f"attachment; filename=odm_assets_{project_id}.zip"
    )


@pytest.mark.asyncio
async def test_head_project_odm_assets_returns_404_when_missing(app, monkeypatch):
    project_id = uuid.uuid4()

    class FakeS3Client:
        def list_objects(self, bucket_name, prefix, recursive=False):
            return iter(())

    monkeypatch.setattr(project_routes, "s3_client", lambda: FakeS3Client())
    app.dependency_overrides[project_deps.get_project_by_id] = lambda: SimpleNamespace(
        id=project_id
    )

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as test_client:
            response = await test_client.head(f"/api/projects/odm/export/{project_id}/")
    finally:
        app.dependency_overrides.pop(project_deps.get_project_by_id, None)

    assert response.status_code == 404


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
async def test_preview_split_by_square_returns_422_for_invalid_geometry(
    client, monkeypatch
):
    async def fake_preview_split_by_square(_boundary, _meters):
        raise HTTPException(
            status_code=422,
            detail="Invalid geometry for split preview. Please fix AOI or no-fly zone geometry and retry.",
        )

    monkeypatch.setattr(
        project_logic,
        "preview_split_by_square",
        fake_preview_split_by_square,
    )

    valid_featcol = json.dumps(
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
                }
            ],
        }
    ).encode("utf-8")

    response = await client.post(
        "/api/projects/preview-split-by-square/",
        files={
            "project_geojson": (
                "aoi.geojson",
                BytesIO(valid_featcol),
                "application/geo+json",
            )
        },
        data={"dimension": 100},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Invalid geometry for split preview. Please fix AOI or no-fly zone geometry and retry."
    )


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


async def _insert_classification_test_task(
    db, *, project_id: str, task_index: int = 1
) -> str:
    task_id = str(uuid.uuid4())
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
                outline
            )
            VALUES (
                %s,
                %s,
                %s,
                ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
            )
            """,
            (task_id, project_id, task_index, outline),
        )

    await db.commit()
    return task_id


async def _insert_classification_test_image(
    db,
    *,
    project_id: str,
    uploaded_by: str,
    status: str,
    task_id: str | None = None,
    s3_key: str | None = None,
) -> str:
    image_id = str(uuid.uuid4())

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO project_images (
                id,
                project_id,
                filename,
                s3_key,
                hash_md5,
                batch_id,
                status,
                uploaded_by,
                task_id
            )
            VALUES (
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s
            )
            """,
            (
                image_id,
                project_id,
                f"{status}.jpg",
                s3_key or f"projects/{project_id}/{image_id}.jpg",
                uuid.uuid4().hex,
                str(uuid.uuid4()),
                status,
                uploaded_by,
                task_id,
            ),
        )

    await db.commit()
    return image_id


@pytest.mark.asyncio
async def test_assign_task_accepts_unmatched_image(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_classification_test_task(db, project_id=project_id)
    image_id = await _insert_classification_test_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="unmatched",
    )

    response = await client.post(
        f"/api/projects/{project_id}/images/{image_id}/assign-task/",
        json={"task_id": task_id},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "assigned"
    assert response.json()["task_id"] == task_id


@pytest.mark.asyncio
async def test_assign_task_rejects_non_unmatched_image(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_classification_test_task(db, project_id=project_id)
    image_id = await _insert_classification_test_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="rejected",
    )

    response = await client.post(
        f"/api/projects/{project_id}/images/{image_id}/assign-task/",
        json={"task_id": task_id},
    )

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "Only unmatched images can be manually assigned to a task"
    )


@pytest.mark.asyncio
async def test_process_imagery_blocks_while_task_images_transfer(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_classification_test_task(db, project_id=project_id)

    await _insert_classification_test_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
        s3_key=f"projects/{project_id}/user-uploads/{uuid.uuid4()}.jpg",
    )

    response = await client.post(
        f"/api/projects/process_imagery/{project_id}/{task_id}/"
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Imagery for this task is still being transferred. "
        "Please wait and retry processing."
    )


@pytest.mark.asyncio
async def test_process_imagery_enqueues_when_transfer_complete(
    client, app, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_classification_test_task(db, project_id=project_id)

    await _insert_classification_test_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
        s3_key=f"projects/{project_id}/{task_id}/images/{uuid.uuid4()}.jpg",
    )

    class FakeJob:
        job_id = "job-process-single"

    class FakeRedis:
        def __init__(self):
            self.jobs = []

        async def enqueue_job(self, *args, **kwargs):
            self.jobs.append((args, kwargs))
            return FakeJob()

    fake_redis = FakeRedis()
    app.dependency_overrides[get_redis_pool] = lambda: fake_redis

    response = await client.post(
        f"/api/projects/process_imagery/{project_id}/{task_id}/"
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": "Processing started",
        "job_id": "job-process-single",
    }
    assert fake_redis.jobs == [
        (
            (
                "process_drone_images",
                uuid.UUID(project_id),
                uuid.UUID(task_id),
                auth_user.id,
                None,
            ),
            {"_queue_name": "default_queue"},
        )
    ]


@pytest.mark.asyncio
async def test_process_all_imagery_blocks_when_all_ready_tasks_transferring(
    client, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_id = await _insert_classification_test_task(db, project_id=project_id)

    await _insert_classification_test_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_id,
        s3_key=f"projects/{project_id}/user-uploads/{uuid.uuid4()}.jpg",
    )

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO task_events (
                event_id, project_id, task_id, user_id, state, comment, updated_at, created_at
            )
            VALUES (
                gen_random_uuid(), %s, %s, %s, %s, %s, NOW(), NOW()
            )
            """,
            (
                project_id,
                task_id,
                auth_user.id,
                "READY_FOR_PROCESSING",
                "Ready",
            ),
        )
    await db.commit()

    response = await client.post(f"/api/projects/process_all_imagery/{project_id}/")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Imagery for some tasks is still being transferred. "
        "Please wait and retry processing."
    )


@pytest.mark.asyncio
async def test_process_all_imagery_blocks_when_ready_tasks_are_mixed_transfer_state(
    client, app, db, auth_user, create_test_project
):
    project_id = create_test_project
    task_a = await _insert_classification_test_task(
        db, project_id=project_id, task_index=1
    )
    task_b = await _insert_classification_test_task(
        db, project_id=project_id, task_index=2
    )

    await _insert_classification_test_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_a,
        s3_key=f"projects/{project_id}/{task_a}/images/{uuid.uuid4()}.jpg",
    )
    await _insert_classification_test_image(
        db,
        project_id=project_id,
        uploaded_by=auth_user.id,
        status="assigned",
        task_id=task_b,
        s3_key=f"projects/{project_id}/user-uploads/{uuid.uuid4()}.jpg",
    )

    async with db.cursor() as cur:
        for task_id in (task_a, task_b):
            await cur.execute(
                """
                INSERT INTO task_events (
                    event_id, project_id, task_id, user_id, state, comment, updated_at, created_at
                )
                VALUES (
                    gen_random_uuid(), %s, %s, %s, %s, %s, NOW(), NOW()
                )
                """,
                (
                    project_id,
                    task_id,
                    auth_user.id,
                    "READY_FOR_PROCESSING",
                    "Ready",
                ),
            )
    await db.commit()

    class FakeRedis:
        def __init__(self):
            self.jobs = []

        async def enqueue_job(self, *args, **kwargs):
            self.jobs.append((args, kwargs))
            return None

    fake_redis = FakeRedis()
    app.dependency_overrides[get_redis_pool] = lambda: fake_redis

    response = await client.post(f"/api/projects/process_all_imagery/{project_id}/")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Imagery for some tasks is still being transferred. "
        "Please wait and retry processing."
    )
    assert fake_redis.jobs == []


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
