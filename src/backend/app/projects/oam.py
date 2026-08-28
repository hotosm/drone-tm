"""Build OpenAerialMap handoffs and reconcile published items."""

from datetime import UTC, datetime
from urllib.parse import quote, urlencode, urlsplit

import aiohttp
from app.config import settings
from app.images import image_logic
from app.models.enums import OAMUploadStatus
from app.projects import project_logic
from app.s3 import get_orthophoto_url_for_project
from app.users.user_logic import get_organization_name_for_user
from loguru import logger as log
from psycopg import Connection
from pydantic import BaseModel

# OAM uses provider as the CC-BY attribution.
DEFAULT_OAM_PROVIDER = "HOTOSM DroneTM"
OAM_PLATFORM = "uav"
OAM_LICENSE = "CC-BY 4.0"
EXTERNAL_ID_PREFIX = "dronetm"
# OAM rejects longer titles.
OAM_TITLE_MAX_LENGTH = 200

LOOKUP_TIMEOUT_SECONDS = 10


def status_name(value) -> str:
    """Normalize stored enum names and enum members."""
    return getattr(value, "name", None) or str(value or "")


def external_id_for_project(project_id) -> str:
    return f"{EXTERNAL_ID_PREFIX}:{project_id}"


def is_legacy_publication(project) -> bool:
    """Identify old publications that have no resolvable item ID."""
    return (
        status_name(project.oam_upload_status) == OAMUploadStatus.UPLOADED.name
        and not project.oam_item_id
    )


class OAMPrefill(BaseModel):
    title: str
    provider: str
    platform: str = OAM_PLATFORM
    license: str = OAM_LICENSE
    acquisition_start: datetime
    acquisition_end: datetime
    sensor: str | None = None


class OAMLink(BaseModel):
    item_id: str
    browser_url: str
    api_url: str


class OAMHandoff(BaseModel):
    project_id: str
    external_id: str
    status: str
    prefill: OAMPrefill
    source_host: str
    uploader_url: str
    catalogue_url: str
    link: OAMLink | None = None
    legacy_publication: bool = False
    warnings: list[str] = []


def item_links(item_id: str) -> OAMLink:
    api_url = (
        f"{settings.OAM_STAC_API_URL.rstrip('/')}"
        f"/collections/{quote(settings.OAM_STAC_COLLECTION)}/items/{quote(item_id)}"
    )
    # OAM's STAC Browser expects the scheme-stripped item URL.
    browser_url = (
        f"{settings.OAM_STAC_BROWSER_URL.rstrip('/')}"
        f"/external/{api_url.split('://', 1)[-1]}"
    )
    return OAMLink(item_id=item_id, browser_url=browser_url, api_url=api_url)


async def fetch_published_item_id(external_id: str) -> str | None:
    """Look up a published item without failing the project page."""
    url = (
        f"{settings.OAM_UPLOADER_URL.rstrip('/')}/api/v1/uploads/lookup"
        f"?{urlencode({'external_id': external_id})}"
    )
    try:
        timeout = aiohttp.ClientTimeout(total=LOOKUP_TIMEOUT_SECONDS)
        async with (
            aiohttp.ClientSession(timeout=timeout) as session,
            session.get(url) as response,
        ):
            if response.status == 404:
                return None
            if response.status != 200:
                log.warning(
                    f"OAM lookup for {external_id} returned HTTP {response.status}"
                )
                return None
            body = await response.json()
    except Exception as e:
        log.warning(f"Could not reach OAM to look up {external_id}: {e}")
        return None

    if body.get("status") != "Succeeded":
        return None
    item_id = body.get("item_id")
    return str(item_id) if item_id else None


async def sync_oam_link(db: Connection, project) -> OAMLink | None:
    if project.oam_item_id:
        return item_links(project.oam_item_id)

    item_id = await fetch_published_item_id(external_id_for_project(project.id))
    if not item_id:
        return None

    log.info(f"Project {project.id} is published on OAM as item {item_id}")
    await project_logic.set_project_oam_item(db, project.id, item_id)
    return item_links(item_id)


def build_uploader_url(
    prefill: OAMPrefill, external_id: str, source_url: str, project_id
) -> str:
    params = {
        "title": prefill.title,
        "provider": prefill.provider,
        "platform": prefill.platform,
        "license": prefill.license,
        "acquisition_start": prefill.acquisition_start.isoformat(),
        "acquisition_end": prefill.acquisition_end.isoformat(),
        "source_url": source_url,
        "external_id": external_id,
        # Published as the item's public STAC backlink.
        "external_url": f"{settings.PUBLIC_FRONTEND_URL}/projects/{project_id}",
    }
    if prefill.sensor:
        params["sensor"] = prefill.sensor
    # Keep the presigned source URL out of server logs.
    return f"{settings.OAM_UPLOADER_URL.rstrip('/')}/#{urlencode(params)}"


async def resolve_acquisition(
    db: Connection, project, capture: image_logic.ProjectCaptureMetadata
) -> tuple[datetime, datetime, bool]:
    if capture.acquisition_start and capture.acquisition_end:
        return capture.acquisition_start, capture.acquisition_end, False

    created_at = await project_logic.get_project_created_at(db, project.id)
    fallback = created_at or datetime.now(UTC)
    if fallback.tzinfo is None:
        fallback = fallback.replace(tzinfo=UTC)
    log.warning(
        f"No EXIF capture time for {capture.image_count} images on project "
        f"{project.id}; falling back to the project creation date"
    )
    return fallback, fallback, True


async def build_handoff(db: Connection, project, user_data) -> OAMHandoff:
    source_url = get_orthophoto_url_for_project(
        project.id, expires_hours=settings.OAM_SOURCE_URL_EXPIRY_HOURS
    )
    if not source_url:
        raise FileNotFoundError(f"No orthophoto found for project {project.id}")

    warnings: list[str] = []

    capture = await image_logic.get_project_capture_metadata(db, project.id)
    start, end, guessed = await resolve_acquisition(db, project, capture)
    if guessed:
        warnings.append(
            "The imagery carried no capture date, so the acquisition date falls "
            "back to when this project was created. Please check it in OAM."
        )

    provider = await get_organization_name_for_user(db, user_data.id)
    if not provider:
        warnings.append(
            "No organisation on your profile, so the imagery will be credited to "
            f"'{DEFAULT_OAM_PROVIDER}'. This is the attribution shown to anyone "
            "reusing it under CC-BY."
        )
    if not capture.sensor:
        warnings.append(
            "No camera make or model in the imagery EXIF, so the sensor will be "
            "left blank. You can add it in OAM."
        )
    if capture.timezone_assumed_count:
        warnings.append(
            f"{capture.timezone_assumed_count} of the images record a capture "
            "time with no timezone, so it has been read as UTC. If the camera "
            "clock was set to local time, the acquisition times will be out by "
            "that offset - check them in OAM."
        )

    link = await sync_oam_link(db, project)
    legacy = link is None and is_legacy_publication(project)
    if legacy:
        warnings.append(
            "This project was published to OAM through the old integration, "
            "which recorded no catalogue link, so the existing item cannot be "
            "found automatically. Search OAM before publishing again - "
            "confirming will create a second scene."
        )

    prefill = OAMPrefill(
        title=project.name[:OAM_TITLE_MAX_LENGTH],
        provider=provider or DEFAULT_OAM_PROVIDER,
        acquisition_start=start,
        acquisition_end=end,
        sensor=capture.sensor,
    )
    external_id = external_id_for_project(project.id)

    return OAMHandoff(
        project_id=str(project.id),
        external_id=external_id,
        status=status_name(project.oam_upload_status),
        prefill=prefill,
        source_host=urlsplit(source_url).netloc,
        uploader_url=build_uploader_url(prefill, external_id, source_url, project.id),
        catalogue_url=settings.OAM_BROWSE_URL.rstrip("/"),
        link=link,
        legacy_publication=legacy,
        warnings=warnings,
    )
