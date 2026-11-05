import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.db.enums import DEMSource
from app.jaxa.jaxa_coordinates import get_covering_tiles
from app.projects import project_logic, project_routes
from app.projects.project_schemas import DbProject, ProjectIn
from app.utils import geojson_to_kml
from fastapi import HTTPException

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


def test_covering_tiles_includes_every_disjoint_area():
    """A split project downloads DEM tiles for each of its areas."""
    square = [[85.1, 27.1], [85.2, 27.1], [85.2, 27.2], [85.1, 27.2], [85.1, 27.1]]
    far_square = [[lon + 10, lat + 10] for lon, lat in square]

    tiles = get_covering_tiles(
        {"type": "MultiPolygon", "coordinates": [[square], [far_square]]}
    )

    assert tiles == sorted(
        get_covering_tiles({"type": "Polygon", "coordinates": [square]})
        + get_covering_tiles({"type": "Polygon", "coordinates": [far_square]})
    )


def _disjoint_project(dem_source: DEMSource, offset_degrees: float) -> ProjectIn:
    square = AOI["features"][0]["geometry"]["coordinates"]
    far_square = [[[lon + offset_degrees, lat] for lon, lat in square[0]]]
    outline = {
        "type": "MultiPolygon",
        "coordinates": [square, far_square],
    }
    feature = {"type": "Feature", "properties": {}, "geometry": outline}
    return project(
        dem_source,
        outline={"type": "FeatureCollection", "features": [feature]},
    )


def test_glo30_rejects_areas_too_far_apart_for_one_crop():
    with pytest.raises(HTTPException) as error:
        project_routes._validate_glo30_coverage(
            _disjoint_project(DEMSource.GLO30, offset_degrees=5)
        )

    assert error.value.status_code == 422
    assert "upload a DEM" in error.value.detail


def test_glo30_allows_nearby_disjoint_areas():
    project_routes._validate_glo30_coverage(
        _disjoint_project(DEMSource.GLO30, offset_degrees=0.5)
    )


def test_jaxa_allows_distant_areas():
    project_routes._validate_glo30_coverage(
        _disjoint_project(DEMSource.JAXA, offset_degrees=5)
    )


@pytest.mark.asyncio
async def test_failed_dem_upload_rejects_uncovered_glo30_fallback(monkeypatch):
    """The project must not commit if its GLO-30 fallback can't cover it."""
    db = SimpleNamespace(commit=AsyncMock())

    async def fake_create(_db, _project_info, _user_id):
        return uuid.uuid4()

    async def failing_upload(*_args):
        raise OSError("S3 unavailable")

    monkeypatch.setattr(DbProject, "create", fake_create)
    monkeypatch.setattr(project_logic, "upload_file_to_s3", failing_upload)

    with pytest.raises(HTTPException) as error:
        await project_routes.create_project(
            project_info=_disjoint_project(DEMSource.UPLOAD, offset_degrees=5),
            db=db,
            background_tasks=RecordingBackgroundTasks(),
            user_data=SimpleNamespace(id="1", email="a@hotosm.org", name="a"),
            dem=object(),
            image=None,
        )

    assert error.value.status_code == 422
    db.commit.assert_not_awaited()


def test_kml_export_keeps_every_disjoint_area():
    square = AOI["features"][0]["geometry"]["coordinates"]
    far_square = [[[lon + 5, lat] for lon, lat in square[0]]]
    feature = {
        "type": "Feature",
        "properties": {},
        "geometry": {"type": "MultiPolygon", "coordinates": [square, far_square]},
    }

    kml = geojson_to_kml({"type": "FeatureCollection", "features": [feature]})

    assert kml.count("<Polygon>") == 2
    assert kml.count("<Placemark>") == 1
    assert "<MultiGeometry>" in kml
