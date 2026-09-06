import uuid

import pytest
from app.models.enums import DEMSource
from app.projects import project_logic, project_routes
from app.projects.project_schemas import ProjectIn

AOI = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [85.28, 27.68],
                        [85.32, 27.68],
                        [85.32, 27.72],
                        [85.28, 27.72],
                        [85.28, 27.68],
                    ]
                ],
            },
        }
    ],
}


class RecordingBackgroundTasks:
    def __init__(self):
        self.queued = []

    def add_task(self, func, *args, **kwargs):
        self.queued.append((func, args, kwargs))

    @property
    def queued_names(self):
        return [func.__name__ for func, _, _ in self.queued]


def project(dem_source=None, **overrides) -> ProjectIn:
    fields = {
        "name": f"TEST_{uuid.uuid4()}",
        "outline": AOI,
        "is_terrain_follow": True,
        "final_output": ["ORTHOPHOTO_2D"],
        **overrides,
    }
    if dem_source is not None:
        fields["dem_source"] = dem_source
    return ProjectIn(**fields)


@pytest.fixture(autouse=True)
def _fake_redis(monkeypatch):
    async def _pool():
        return object()

    monkeypatch.setattr(project_routes, "get_redis_pool", _pool)


async def enqueue(project_info, dem_stored=False):
    tasks = RecordingBackgroundTasks()
    dem_source = project_logic.resolve_dem_source(
        project_info.dem_source, project_info.is_terrain_follow, dem_stored
    )
    await project_routes._enqueue_terrain_dem(
        dem_source, project_info, uuid.uuid4(), tasks
    )
    return tasks


def test_default_dem_source_is_glo30():
    assert project().dem_source == DEMSource.GLO30


@pytest.mark.asyncio
async def test_glo30_project_queues_a_glo30_crop():
    tasks = await enqueue(project(DEMSource.GLO30))

    assert tasks.queued_names == ["enqueue_glo30_dem_download"]
    _, args, _ = tasks.queued[0]
    assert args[0] == pytest.approx((85.28, 27.68, 85.32, 27.72))


@pytest.mark.asyncio
async def test_jaxa_stays_available_as_an_explicit_choice():
    tasks = await enqueue(project(DEMSource.JAXA))

    assert tasks.queued_names == ["enqueue_dem_download"]
    _, args, _ = tasks.queued[0]
    assert args[0]["type"] == "Polygon"


@pytest.mark.asyncio
async def test_upload_queues_nothing():
    tasks = await enqueue(project(DEMSource.UPLOAD), dem_stored=True)

    assert tasks.queued == []


@pytest.mark.asyncio
async def test_upload_without_a_file_falls_back_to_glo30():
    tasks = await enqueue(project(DEMSource.UPLOAD))

    assert tasks.queued_names == ["enqueue_glo30_dem_download"]


@pytest.mark.asyncio
async def test_an_uploaded_file_beats_the_default():
    tasks = await enqueue(project(), dem_stored=True)

    assert tasks.queued == []


@pytest.mark.asyncio
async def test_creation_survives_an_unavailable_queue(monkeypatch):
    from fastapi import HTTPException

    async def _unavailable():
        raise HTTPException(status_code=503, detail="Redis unavailable")

    monkeypatch.setattr(project_routes, "get_redis_pool", _unavailable)

    tasks = await enqueue(project(DEMSource.GLO30))

    assert tasks.queued == []


@pytest.mark.asyncio
async def test_a_null_dem_source_still_fetches_something():
    project_info = project()
    project_info.dem_source = None

    tasks = await enqueue(project_info)

    assert tasks.queued_names == ["enqueue_glo30_dem_download"]


def test_an_unknown_dem_source_is_rejected_before_it_reaches_postgres():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        project("NOT_A_SOURCE")
