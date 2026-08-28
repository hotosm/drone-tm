from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import pytest
from app.config import settings
from app.models.enums import OAMUploadStatus
from app.projects import oam


@pytest.fixture
def prefill():
    return oam.OAMPrefill(
        title="Kathmandu ward 5",
        provider="HOT Nepal",
        acquisition_start=datetime(2026, 4, 2, 9, 30, tzinfo=UTC),
        acquisition_end=datetime(2026, 4, 2, 11, 0, tzinfo=UTC),
        sensor="DJI FC7303",
    )


def _handoff_params(url: str) -> dict[str, str]:
    parts = urlsplit(url)
    assert not parts.query, "prefill must not be in the query string"
    return {k: v[0] for k, v in parse_qs(parts.fragment).items()}


def test_external_id_is_derived_from_the_project():
    project_id = "0d1a5c22-1111-2222-3333-444455556666"
    assert oam.external_id_for_project(project_id) == f"dronetm:{project_id}"
    assert oam.external_id_for_project(project_id) == oam.external_id_for_project(
        project_id
    )


def test_status_name_normalises_rows_and_enum_members():
    assert "UPLOADING" != OAMUploadStatus.UPLOADING
    assert oam.status_name("UPLOADING") == OAMUploadStatus.UPLOADING.name
    assert oam.status_name(OAMUploadStatus.UPLOADING) == OAMUploadStatus.UPLOADING.name
    assert oam.status_name(None) == ""


def test_uploader_url_carries_everything_oam_needs(prefill):
    url = oam.build_uploader_url(
        prefill, "dronetm:abc-123", "https://s3.example.org/o.tif?sig=x", "abc-123"
    )
    assert url.startswith(settings.OAM_UPLOADER_URL.rstrip("/") + "/#")
    params = _handoff_params(url)
    assert params["title"] == "Kathmandu ward 5"
    assert params["provider"] == "HOT Nepal"
    assert params["platform"] == "uav"
    assert params["license"] == "CC-BY 4.0"
    assert params["sensor"] == "DJI FC7303"
    assert params["source_url"] == "https://s3.example.org/o.tif?sig=x"
    assert params["external_id"] == "dronetm:abc-123"
    assert params["external_url"] == (
        f"{settings.PUBLIC_FRONTEND_URL}/projects/abc-123"
    )


def test_uploader_url_keeps_full_acquisition_timestamps(prefill):
    url = oam.build_uploader_url(prefill, "dronetm:abc", "https://s3/o.tif", "abc")
    params = _handoff_params(url)
    assert params["acquisition_start"] == "2026-04-02T09:30:00+00:00"
    assert params["acquisition_end"] == "2026-04-02T11:00:00+00:00"


def test_uploader_url_omits_an_unknown_sensor(prefill):
    prefill.sensor = None
    params = _handoff_params(
        oam.build_uploader_url(prefill, "dronetm:abc", "https://s3/o.tif", "abc")
    )
    assert "sensor" not in params


def test_item_links_point_at_the_configured_catalogue():
    links = oam.item_links("item-42")
    assert links.item_id == "item-42"
    assert links.api_url == (
        f"{settings.OAM_STAC_API_URL.rstrip('/')}"
        f"/collections/{settings.OAM_STAC_COLLECTION}/items/item-42"
    )
    assert links.browser_url == (
        f"{settings.OAM_STAC_BROWSER_URL.rstrip('/')}/external/"
        f"{links.api_url.split('://', 1)[1]}"
    )


@pytest.mark.asyncio
async def test_lookup_returns_none_when_oam_is_unreachable(monkeypatch):
    def explode(*args, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(oam.aiohttp, "ClientSession", explode)
    assert await oam.fetch_published_item_id("dronetm:abc") is None


@pytest.mark.asyncio
async def test_lookup_ignores_an_upload_still_in_progress(monkeypatch):
    class _Response:
        status = 200

        async def json(self):
            return {"status": "Processing", "item_id": "item-42"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    class _Session:
        def __init__(self, *args, **kwargs):
            pass

        def get(self, *args, **kwargs):
            return _Response()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(oam.aiohttp, "ClientSession", _Session)
    assert await oam.fetch_published_item_id("dronetm:abc") is None


def test_the_backlink_points_at_the_frontend_not_the_api(monkeypatch, prefill):
    monkeypatch.setattr(settings, "DOMAIN", "api.drone.hotosm.org")
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "FRONTEND_DOMAIN", None)

    params = _handoff_params(
        oam.build_uploader_url(prefill, "dronetm:abc", "https://s3/o.tif", "abc")
    )
    assert params["external_url"] == "https://drone.hotosm.org/projects/abc"
    assert "api.drone.hotosm.org" not in params["external_url"]


def test_a_single_domain_deployment_keeps_using_it(monkeypatch, prefill):
    monkeypatch.setattr(settings, "DOMAIN", "drone.example.org")
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "FRONTEND_DOMAIN", None)

    params = _handoff_params(
        oam.build_uploader_url(prefill, "dronetm:abc", "https://s3/o.tif", "abc")
    )
    assert params["external_url"] == "https://drone.example.org/projects/abc"


def test_an_explicit_frontend_domain_wins(monkeypatch, prefill):
    monkeypatch.setattr(settings, "DOMAIN", "api.drone.hotosm.org")
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "FRONTEND_DOMAIN", "maps.example.org")

    params = _handoff_params(
        oam.build_uploader_url(prefill, "dronetm:abc", "https://s3/o.tif", "abc")
    )
    assert params["external_url"] == "https://maps.example.org/projects/abc"
