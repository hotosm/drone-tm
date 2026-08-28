from datetime import UTC, datetime
from http import HTTPStatus

import pytest
import pytest_asyncio
from app.models.enums import (
    ImageProcessingStatus,
    OAMUploadStatus,
    RegulatorApprovalStatus,
)
from app.projects import oam, project_logic, project_routes, project_schemas
from app.users.user_schemas import AuthUser
from fastapi import HTTPException

ORTHO_URL = "https://s3.example.org/o.tif?X-Amz-Signature=abc"


async def reload_project(db, project_id):
    return await project_schemas.DbProject.one(db, project_id)


async def _set_columns(db, project_id, **columns):
    assignments = ", ".join(f"{name} = %s" for name in columns)
    async with db.cursor() as cur:
        await cur.execute(
            f"UPDATE projects SET {assignments} WHERE id = %s",
            (*columns.values(), project_id),
        )
    await db.commit()
    return await reload_project(db, project_id)


@pytest_asyncio.fixture
async def processed_project(db, test_get_project):
    return await _set_columns(
        db,
        test_get_project.id,
        image_processing_status=ImageProcessingStatus.SUCCESS.name,
    )


@pytest.fixture
def stub_orthophoto(monkeypatch):
    monkeypatch.setattr(
        oam, "get_orthophoto_url_for_project", lambda project_id, **kwargs: ORTHO_URL
    )


@pytest.fixture
def oam_knows_nothing(monkeypatch):
    calls = []

    async def _lookup(external_id):
        calls.append(external_id)

    monkeypatch.setattr(oam, "fetch_published_item_id", _lookup)
    return calls


def published_as(monkeypatch, item_id):
    calls = []

    async def _lookup(external_id):
        calls.append(external_id)
        return item_id

    monkeypatch.setattr(oam, "fetch_published_item_id", _lookup)
    return calls


@pytest.mark.asyncio
async def test_only_the_author_may_read_the_handoff(
    db, processed_project, stub_orthophoto, oam_knows_nothing
):
    stranger = AuthUser(
        id="999999999999999999999",
        email="stranger@hotosm.org",
        name="stranger",
        profile_img="",
    )
    with pytest.raises(HTTPException) as err:
        await project_routes.get_oam_upload_details(
            user_data=stranger, db=db, project=processed_project
        )
    assert err.value.status_code == HTTPStatus.FORBIDDEN


@pytest.mark.asyncio
async def test_only_the_author_may_start_the_handoff(
    db, processed_project, stub_orthophoto, oam_knows_nothing
):
    stranger = AuthUser(
        id="999999999999999999999",
        email="stranger@hotosm.org",
        name="stranger",
        profile_img="",
    )
    with pytest.raises(HTTPException) as err:
        await project_routes.start_oam_upload(
            user_data=stranger, db=db, project=processed_project
        )
    assert err.value.status_code == HTTPStatus.FORBIDDEN
    reloaded = await reload_project(db, processed_project.id)
    assert oam.status_name(reloaded.oam_upload_status) == (
        OAMUploadStatus.NOT_STARTED.name
    )


@pytest.mark.asyncio
async def test_unapproved_imagery_cannot_be_published(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    project = await _set_columns(
        db,
        processed_project.id,
        requires_approval_from_regulator=True,
        regulator_approval_status=RegulatorApprovalStatus.PENDING.name,
    )
    for call in (
        project_routes.get_oam_upload_details,
        project_routes.start_oam_upload,
    ):
        with pytest.raises(HTTPException) as err:
            await call(user_data=auth_user, db=db, project=project)
        assert err.value.status_code == HTTPStatus.CONFLICT
        assert "regulator approval" in err.value.detail

    approved = await _set_columns(
        db,
        processed_project.id,
        regulator_approval_status=RegulatorApprovalStatus.APPROVED.name,
    )
    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=approved
    )
    assert handoff.uploader_url


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [
        ImageProcessingStatus.NOT_STARTED.name,
        ImageProcessingStatus.PROCESSING.name,
        ImageProcessingStatus.FAILED.name,
    ],
)
async def test_only_successfully_processed_imagery_can_be_published(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing, status
):
    project = await _set_columns(
        db, processed_project.id, image_processing_status=status
    )
    for call in (
        project_routes.get_oam_upload_details,
        project_routes.start_oam_upload,
    ):
        with pytest.raises(HTTPException) as err:
            await call(user_data=auth_user, db=db, project=project)
        assert err.value.status_code == HTTPStatus.CONFLICT
        assert "processing" in err.value.detail

    reloaded = await reload_project(db, processed_project.id)
    assert oam.status_name(reloaded.oam_upload_status) == (
        OAMUploadStatus.NOT_STARTED.name
    )


@pytest.mark.asyncio
async def test_an_already_published_item_stays_viewable(
    db, auth_user, processed_project, stub_orthophoto, monkeypatch
):
    published_as(monkeypatch, "item-42")
    project = await _set_columns(
        db,
        processed_project.id,
        image_processing_status=ImageProcessingStatus.PROCESSING.name,
        requires_approval_from_regulator=True,
        regulator_approval_status=RegulatorApprovalStatus.PENDING.name,
    )

    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=project
    )
    assert handoff.link.item_id == "item-42"

    with pytest.raises(HTTPException) as err:
        await project_routes.start_oam_upload(
            user_data=auth_user, db=db, project=project
        )
    assert err.value.status_code == HTTPStatus.CONFLICT
    assert "already published" in err.value.detail


@pytest.mark.asyncio
async def test_no_orthophoto_is_a_404_not_a_500(
    db, auth_user, processed_project, monkeypatch, oam_knows_nothing
):
    monkeypatch.setattr(
        oam, "get_orthophoto_url_for_project", lambda project_id, **kwargs: None
    )
    with pytest.raises(HTTPException) as err:
        await project_routes.get_oam_upload_details(
            user_data=auth_user, db=db, project=processed_project
        )
    assert err.value.status_code == HTTPStatus.NOT_FOUND

    with pytest.raises(HTTPException) as err:
        await project_routes.start_oam_upload(
            user_data=auth_user, db=db, project=processed_project
        )
    assert err.value.status_code == HTTPStatus.NOT_FOUND


@pytest.mark.asyncio
async def test_the_handoff_describes_what_will_be_published(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=processed_project
    )
    assert handoff.external_id == f"dronetm:{processed_project.id}"
    assert handoff.link is None
    assert handoff.legacy_publication is False
    assert handoff.source_host == "s3.example.org"
    assert ORTHO_URL not in handoff.source_host
    assert handoff.prefill.title == processed_project.name
    assert handoff.status == OAMUploadStatus.NOT_STARTED.name


@pytest.mark.asyncio
async def test_starting_the_handoff_records_it(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    handoff = await project_routes.start_oam_upload(
        user_data=auth_user, db=db, project=processed_project
    )
    assert handoff.status == OAMUploadStatus.UPLOADING.name
    reloaded = await reload_project(db, processed_project.id)
    assert oam.status_name(reloaded.oam_upload_status) == (
        OAMUploadStatus.UPLOADING.name
    )
    assert reloaded.oam_item_id is None


@pytest.mark.asyncio
async def test_repeating_the_handoff_is_allowed_while_nothing_is_published(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    first = await project_routes.start_oam_upload(
        user_data=auth_user, db=db, project=processed_project
    )
    reloaded = await reload_project(db, processed_project.id)
    second = await project_routes.start_oam_upload(
        user_data=auth_user, db=db, project=reloaded
    )
    assert first.uploader_url == second.uploader_url
    assert second.status == OAMUploadStatus.UPLOADING.name


@pytest.mark.asyncio
async def test_a_published_item_is_discovered_and_stored(
    db, auth_user, processed_project, stub_orthophoto, monkeypatch
):
    calls = published_as(monkeypatch, "item-42")
    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=processed_project
    )
    assert calls == [f"dronetm:{processed_project.id}"]
    assert handoff.link is not None
    assert handoff.link.item_id == "item-42"
    assert "/items/item-42" in handoff.link.browser_url

    reloaded = await reload_project(db, processed_project.id)
    assert reloaded.oam_item_id == "item-42"
    assert oam.status_name(reloaded.oam_upload_status) == (
        OAMUploadStatus.UPLOADED.name
    )

    calls.clear()
    again = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=reloaded
    )
    assert calls == []
    assert again.link.item_id == "item-42"


@pytest.mark.asyncio
async def test_a_lost_handoff_post_still_reconciles(
    db, auth_user, processed_project, stub_orthophoto, monkeypatch
):
    assert oam.status_name(processed_project.oam_upload_status) == (
        OAMUploadStatus.NOT_STARTED.name
    )
    published_as(monkeypatch, "item-77")

    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=processed_project
    )
    assert handoff.link is not None
    assert handoff.link.item_id == "item-77"
    reloaded = await reload_project(db, processed_project.id)
    assert reloaded.oam_item_id == "item-77"


@pytest.mark.asyncio
async def test_publishing_again_is_refused_once_an_item_exists(
    db, auth_user, processed_project, stub_orthophoto, monkeypatch
):
    published_as(monkeypatch, "item-42")
    with pytest.raises(HTTPException) as err:
        await project_routes.start_oam_upload(
            user_data=auth_user, db=db, project=processed_project
        )
    assert err.value.status_code == HTTPStatus.CONFLICT
    assert "item-42" in err.value.detail


async def _make_legacy(db, project_id):
    await project_logic.update_project_oam_status(
        db, project_id, OAMUploadStatus.UPLOADED
    )
    return await reload_project(db, project_id)


def test_legacy_detection_needs_both_halves():
    legacy = type("P", (), {"oam_upload_status": "UPLOADED", "oam_item_id": None})()
    assert oam.is_legacy_publication(legacy) is True

    current = type(
        "P", (), {"oam_upload_status": "UPLOADED", "oam_item_id": "item-1"}
    )()
    assert oam.is_legacy_publication(current) is False

    in_flight = type("P", (), {"oam_upload_status": "UPLOADING", "oam_item_id": None})()
    assert oam.is_legacy_publication(in_flight) is False

    fresh = type("P", (), {"oam_upload_status": "NOT_STARTED", "oam_item_id": None})()
    assert oam.is_legacy_publication(fresh) is False


@pytest.mark.asyncio
async def test_a_legacy_project_is_flagged_not_silently_republishable(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    project = await _make_legacy(db, processed_project.id)

    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=project
    )
    assert handoff.link is None
    assert handoff.legacy_publication is True
    assert any("old integration" in warning for warning in handoff.warnings)


@pytest.mark.asyncio
async def test_a_legacy_project_cannot_be_republished_by_accident(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    project = await _make_legacy(db, processed_project.id)
    with pytest.raises(HTTPException) as err:
        await project_routes.start_oam_upload(
            user_data=auth_user, db=db, project=project
        )
    assert err.value.status_code == HTTPStatus.CONFLICT
    assert "republish_legacy" in err.value.detail

    reloaded = await reload_project(db, processed_project.id)
    assert oam.status_name(reloaded.oam_upload_status) == OAMUploadStatus.UPLOADED.name


@pytest.mark.asyncio
async def test_a_legacy_project_can_be_republished_deliberately(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    project = await _make_legacy(db, processed_project.id)
    handoff = await project_routes.start_oam_upload(
        user_data=auth_user, db=db, project=project, republish_legacy=True
    )
    assert handoff.status == OAMUploadStatus.UPLOADING.name
    reloaded = await reload_project(db, processed_project.id)
    assert oam.status_name(reloaded.oam_upload_status) == (
        OAMUploadStatus.UPLOADING.name
    )


@pytest.mark.asyncio
async def test_a_legacy_project_found_in_oam_is_just_linked(
    db, auth_user, processed_project, stub_orthophoto, monkeypatch
):
    await _make_legacy(db, processed_project.id)
    project = await reload_project(db, processed_project.id)
    published_as(monkeypatch, "item-9")

    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=project
    )
    assert handoff.legacy_publication is False
    assert handoff.link.item_id == "item-9"


@pytest.mark.asyncio
async def test_the_acquisition_window_falls_back_and_says_so(
    db, auth_user, processed_project, stub_orthophoto, oam_knows_nothing
):
    handoff = await project_routes.get_oam_upload_details(
        user_data=auth_user, db=db, project=processed_project
    )
    assert handoff.prefill.acquisition_start <= datetime.now(UTC)
    assert any("no capture date" in warning for warning in handoff.warnings)
