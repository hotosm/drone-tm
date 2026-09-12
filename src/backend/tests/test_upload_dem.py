"""Tests for the DEM clipping workflow introduced in Issue #790.

Covers the contract that download_and_upload_dem() maintains:

* When PostGIS returns a buffered AOI, clip_dem_to_aoi() is called and
  upload_dem_file_s3_sync() receives the clipped path.
* When clip_dem_to_aoi() raises, the worker falls back to the original
  raster and does not propagate the exception.
* When PostGIS returns no AOI (NULL outline or missing project), clipping
  is skipped and the original raster is uploaded.
"""

from __future__ import annotations

import uuid

import pytest
from app.jaxa import upload_dem

from tests.test_project_processing import _FakeConn, _FakePool

# ── helpers ──────────────────────────────────────────────────────────────────


class _RecordingCursor:
    """Async context-manager cursor that records queries on the parent conn."""

    def __init__(self, conn, fetchone_result=None, fetchall_result=None):
        self._conn = conn
        self._fetchone_result = fetchone_result
        self._fetchall_result = fetchall_result or []

    async def execute(self, query, params=None):
        self._conn.executed.append({"query": query, "params": params})

    async def fetchone(self):
        return self._fetchone_result

    async def fetchall(self):
        return self._fetchall_result

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _RecordingConn(_FakeConn):
    """_FakeConn that records executed queries (including via cursors)."""

    def cursor(self, **kwargs):
        return _RecordingCursor(self, self._cursor_fetchone, self._cursor_fetchall)

    def queries_matching(self, *substrings: str) -> list[dict]:
        return [
            entry
            for entry in self.executed
            if all(s in entry["query"] for s in substrings)
        ]


def _make_ctx(conn):
    """Build an ARQ-style ctx dict with a fake db_pool."""
    return {"db_pool": _FakePool(conn)}


# ── download_and_upload_dem: clipping on success ─────────────────────────────


@pytest.mark.asyncio
async def test_download_and_upload_dem_clips_on_success(monkeypatch, tmp_path):
    """When PostGIS returns a buffered AOI, clip_dem_to_aoi() is called and
    upload_dem_file_s3_sync() receives the clipped path."""
    project_id = str(uuid.uuid4())
    coordinates = "N050E009"

    # Fake PostGIS returning a buffered AOI geometry.
    fake_geometry = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    }
    conn = _RecordingConn(cursor_fetchone={"buffered_outline": fake_geometry})
    ctx = _make_ctx(conn)

    # Track which path upload_dem_file_s3_sync receives.
    uploaded_paths: list[str] = []

    async def _fake_upload(tif_file_path, pid):
        uploaded_paths.append(tif_file_path)

    # Track which path clip_dem_to_aoi receives and returns.
    clip_calls: list[str] = []
    clipped_path = str(tmp_path / "clipped.tif")

    def _fake_clip(dem_path, buffered_aoi_geojson):
        clip_calls.append(dem_path)
        return clipped_path

    # Stub out external dependencies.
    monkeypatch.setattr(upload_dem, "_run_scrapy_crawler_async", _noop_crawl)
    monkeypatch.setattr(upload_dem, "upload_dem_file_s3_sync", _fake_upload)
    monkeypatch.setattr(upload_dem, "clip_dem_to_aoi", _fake_clip)

    monkeypatch.setattr(upload_dem.tempfile, "gettempdir", lambda: str(tmp_path))
    merged = tmp_path / "tif_processing" / project_id / "merged.tif"
    merged.parent.mkdir(parents=True, exist_ok=True)
    merged.write_bytes(b"fake-tif")

    await upload_dem.download_and_upload_dem(ctx, coordinates, project_id)

    # clip_dem_to_aoi was called with the original path.
    assert len(clip_calls) == 1
    assert clip_calls[0].endswith("merged.tif")

    # upload_dem_file_s3_sync received the clipped path.
    assert uploaded_paths == [clipped_path]

    # PostGIS query was executed.
    assert conn.queries_matching("ST_Buffer", "outline")


# ── download_and_upload_dem: fallback on clip failure ────────────────────────


@pytest.mark.asyncio
async def test_download_and_upload_dem_fallback_on_clip_failure(monkeypatch, tmp_path):
    """When clip_dem_to_aoi() raises, the worker falls back to the original
    raster and does not propagate the exception."""
    project_id = str(uuid.uuid4())
    coordinates = "N050E009"

    fake_geometry = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    }
    conn = _RecordingConn(cursor_fetchone={"buffered_outline": fake_geometry})
    ctx = _make_ctx(conn)

    uploaded_paths: list[str] = []

    async def _fake_upload(tif_file_path, pid):
        uploaded_paths.append(tif_file_path)

    def _failing_clip(dem_path, buffered_aoi_geojson):
        raise RuntimeError("gdal.Warp failed")

    monkeypatch.setattr(upload_dem, "_run_scrapy_crawler_async", _noop_crawl)
    monkeypatch.setattr(upload_dem, "upload_dem_file_s3_sync", _fake_upload)
    monkeypatch.setattr(upload_dem, "clip_dem_to_aoi", _failing_clip)

    merged = tmp_path / "merged.tif"
    merged.write_bytes(b"fake-tif")
    monkeypatch.setattr(upload_dem.tempfile, "gettempdir", lambda: str(tmp_path))

    # Must not raise — clipping failure is non-fatal.
    await upload_dem.download_and_upload_dem(ctx, coordinates, project_id)

    # upload_dem_file_s3_sync received the ORIGINAL path (not clipped).
    assert len(uploaded_paths) == 1
    assert uploaded_paths[0].endswith("merged.tif")


# ── download_and_upload_dem: fallback when no AOI ────────────────────────────


@pytest.mark.asyncio
async def test_download_and_upload_dem_fallback_on_no_aoi(monkeypatch, tmp_path):
    """When PostGIS returns no AOI, clipping is skipped and the original
    raster is uploaded."""
    project_id = str(uuid.uuid4())
    coordinates = "N050E009"

    # PostGIS returns a row but buffered_outline is None.
    conn = _RecordingConn(cursor_fetchone={"buffered_outline": None})
    ctx = _make_ctx(conn)

    uploaded_paths: list[str] = []

    async def _fake_upload(tif_file_path, pid):
        uploaded_paths.append(tif_file_path)

    clip_called = False

    def _should_not_clip(dem_path, buffered_aoi_geojson):
        nonlocal clip_called
        clip_called = True
        return dem_path

    monkeypatch.setattr(upload_dem, "_run_scrapy_crawler_async", _noop_crawl)
    monkeypatch.setattr(upload_dem, "upload_dem_file_s3_sync", _fake_upload)
    monkeypatch.setattr(upload_dem, "clip_dem_to_aoi", _should_not_clip)

    merged = tmp_path / "merged.tif"
    merged.write_bytes(b"fake-tif")
    monkeypatch.setattr(upload_dem.tempfile, "gettempdir", lambda: str(tmp_path))

    await upload_dem.download_and_upload_dem(ctx, coordinates, project_id)

    # clip_dem_to_aoi was NOT called.
    assert clip_called is False

    # upload_dem_file_s3_sync received the original path.
    assert len(uploaded_paths) == 1
    assert uploaded_paths[0].endswith("merged.tif")


# ── download_and_upload_dem: fallback when no db_pool ────────────────────────


@pytest.mark.asyncio
async def test_download_and_upload_dem_fallback_on_no_db_pool(monkeypatch, tmp_path):
    """When ctx has no db_pool, clipping is skipped and the original raster
    is uploaded."""
    project_id = str(uuid.uuid4())
    coordinates = "N050E009"

    ctx = {}  # No db_pool.

    uploaded_paths: list[str] = []

    async def _fake_upload(tif_file_path, pid):
        uploaded_paths.append(tif_file_path)

    clip_called = False

    def _should_not_clip(dem_path, buffered_aoi_geojson):
        nonlocal clip_called
        clip_called = True
        return dem_path

    monkeypatch.setattr(upload_dem, "_run_scrapy_crawler_async", _noop_crawl)
    monkeypatch.setattr(upload_dem, "upload_dem_file_s3_sync", _fake_upload)
    monkeypatch.setattr(upload_dem, "clip_dem_to_aoi", _should_not_clip)

    merged = tmp_path / "merged.tif"
    merged.write_bytes(b"fake-tif")
    monkeypatch.setattr(upload_dem.tempfile, "gettempdir", lambda: str(tmp_path))

    await upload_dem.download_and_upload_dem(ctx, coordinates, project_id)

    assert clip_called is False
    assert len(uploaded_paths) == 1
    assert uploaded_paths[0].endswith("merged.tif")


# ── clip_dem_to_aoi: direct helper tests ─────────────────────────────────────


def _make_test_raster(path, x_min, y_min, x_max, y_max, pixel_size=0.001):
    """Create a small synthetic GeoTIFF for testing.

    Returns the path to the created raster.
    """
    from osgeo import gdal, osr

    x_size = int((x_max - x_min) / pixel_size)
    y_size = int((y_max - y_min) / pixel_size)

    ds = gdal.GetDriverByName("GTiff").Create(
        str(path), x_size, y_size, 1, gdal.GDT_Int16
    )
    ds.SetGeoTransform([x_min, pixel_size, 0, y_max, 0, -pixel_size])
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    ds.SetProjection(srs.ExportToWkt())
    band = ds.GetRasterBand(1)
    import numpy as np

    band.WriteArray(np.ones((y_size, x_size), dtype=np.int16) * 300)
    band.SetNoDataValue(-9999)
    ds.FlushCache()
    ds = None
    return str(path)


def test_clip_dem_to_aoi_success(tmp_path):
    """clip_dem_to_aoi clips the raster to the buffered AOI extent."""
    raster_path = _make_test_raster(
        tmp_path / "input.tif", x_min=9.0, y_min=50.0, x_max=10.0, y_max=51.0
    )

    # AOI covers a small part of the raster.
    aoi = {
        "type": "Polygon",
        "coordinates": [
            [
                [9.43, 50.08],
                [9.50, 50.08],
                [9.50, 50.12],
                [9.43, 50.12],
                [9.43, 50.08],
            ]
        ],
    }

    from osgeo import gdal

    result_path = upload_dem.clip_dem_to_aoi(raster_path, aoi)

    # The function returns the original path (replaced in-place).
    assert result_path == raster_path

    # Verify the clipped raster extent is smaller than the original.
    ds = gdal.Open(result_path)
    gt = ds.GetGeoTransform()
    x_min, y_max = gt[0], gt[3]
    x_max = x_min + gt[1] * ds.RasterXSize
    y_min = y_max + gt[5] * ds.RasterYSize
    ds = None

    # The clipped extent should be close to the AOI (plus pixel alignment).
    assert x_min < 9.44  # within ~1 pixel of AOI min_lon
    assert x_max > 9.49  # within ~1 pixel of AOI max_lon
    assert y_min < 50.09  # within ~1 pixel of AOI min_lat
    assert y_max > 50.11  # within ~1 pixel of AOI max_lat

    # The clipped extent should be much smaller than the original 1° tile.
    assert (x_max - x_min) < 0.2
    assert (y_max - y_min) < 0.2


def test_clip_dem_to_aoi_cleanup(tmp_path):
    """clip_dem_to_aoi removes temporary cutline file after success."""
    raster_path = _make_test_raster(
        tmp_path / "input.tif", x_min=9.0, y_min=50.0, x_max=10.0, y_max=51.0
    )

    aoi = {
        "type": "Polygon",
        "coordinates": [
            [
                [9.43, 50.08],
                [9.50, 50.08],
                [9.50, 50.12],
                [9.43, 50.12],
                [9.43, 50.08],
            ]
        ],
    }

    upload_dem.clip_dem_to_aoi(raster_path, aoi)

    # No temporary GeoJSON files should remain.
    geojson_files = list(tmp_path.glob("cutline_*.geojson"))
    assert geojson_files == []

    # No intermediate clipped file should remain.
    clipped_files = list(tmp_path.glob("*.clipped.tif"))
    assert clipped_files == []


def test_clip_dem_to_aoi_raises_on_invalid_geometry(tmp_path):
    """clip_dem_to_aoi raises when given invalid geometry."""
    raster_path = _make_test_raster(
        tmp_path / "input.tif", x_min=9.0, y_min=50.0, x_max=10.0, y_max=51.0
    )

    # A Point geometry is not a valid cutline for gdal.Warp.
    bad_geometry = {"type": "Point", "coordinates": [9.5, 50.1]}

    with pytest.raises(RuntimeError):
        upload_dem.clip_dem_to_aoi(raster_path, bad_geometry)

    # Temporary files should still be cleaned up.
    geojson_files = list(tmp_path.glob("cutline_*.geojson"))
    assert geojson_files == []


# ── shared stubs ─────────────────────────────────────────────────────────────


async def _noop_crawl(coordinates_str, tif_file_path):
    """Stub for _run_scrapy_crawler_async — does nothing."""
