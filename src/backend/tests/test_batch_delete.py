import asyncio
from io import BytesIO
import uuid

import pytest
from shapely.geometry import box
from shapely import wkb as wkblib

from app.config import settings
from app.images.image_classification import ImageClassifier
from app.s3 import add_obj_to_bucket, check_file_exists


def _upload_test_object(object_name: str, content: bytes) -> None:
    add_obj_to_bucket(
        settings.S3_BUCKET_NAME,
        BytesIO(content),
        object_name,
        content_type="image/jpeg",
    )


async def _insert_batch_image(
    db,
    *,
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    uploaded_by: str,
    filename: str,
    s3_key: str,
    thumbnail_url: str,
    status: str = "staged",
    task_id: uuid.UUID | None = None,
    image_id: uuid.UUID | None = None,
) -> uuid.UUID:
    image_id = image_id or uuid.uuid4()
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO project_images
            (id, project_id, filename, s3_key, thumbnail_url, hash_md5, batch_id, status, uploaded_by, task_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(image_id),
                str(project_id),
                filename,
                s3_key,
                thumbnail_url,
                uuid.uuid4().hex,
                str(batch_id),
                status,
                uploaded_by,
                str(task_id) if task_id else None,
            ),
        )
    return image_id


async def _count_batch_images(db, *, project_id: uuid.UUID, batch_id: uuid.UUID) -> int:
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*)
            FROM project_images
            WHERE batch_id = %s AND project_id = %s
            """,
            (str(batch_id), str(project_id)),
        )
        row = await cur.fetchone()
    return int(row[0])


async def _create_batch_with_objects(
    db,
    *,
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    uploaded_by: str,
    image_prefix: str,
    image_count: int,
) -> list[str]:
    object_names: list[str] = []

    for index in range(image_count):
        s3_key = (
            f"projects/{project_id}/user-uploads/{batch_id}/{image_prefix}_{index}.jpg"
        )
        thumbnail_key = f"projects/{project_id}/user-uploads/{batch_id}/thumbs/{image_prefix}_{index}.jpg"
        _upload_test_object(s3_key, f"{image_prefix}-image-{index}".encode())
        _upload_test_object(thumbnail_key, f"{image_prefix}-thumb-{index}".encode())
        object_names.extend([s3_key, thumbnail_key])
        await _insert_batch_image(
            db,
            project_id=project_id,
            batch_id=batch_id,
            uploaded_by=uploaded_by,
            filename=f"{image_prefix}_{index}.jpg",
            s3_key=s3_key,
            thumbnail_url=thumbnail_key,
        )

    await db.commit()
    return object_names


async def _wait_for_batch_cleanup(
    db,
    *,
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    object_names: list[str],
    attempts: int = 40,
    delay_seconds: float = 0.25,
) -> None:
    for _ in range(attempts):
        remaining_images = await _count_batch_images(
            db, project_id=project_id, batch_id=batch_id
        )
        remaining_objects = [
            name
            for name in object_names
            if check_file_exists(settings.S3_BUCKET_NAME, name)
        ]
        if remaining_images == 0 and not remaining_objects:
            return
        await asyncio.sleep(delay_seconds)

    remaining_images = await _count_batch_images(
        db, project_id=project_id, batch_id=batch_id
    )
    remaining_objects = [
        name
        for name in object_names
        if check_file_exists(settings.S3_BUCKET_NAME, name)
    ]
    pytest.fail(
        "Batch cleanup did not complete in time: "
        f"remaining_images={remaining_images}, remaining_objects={remaining_objects}"
    )


@pytest.mark.asyncio
async def test_delete_batch_removes_db_rows_and_s3_objects(
    db, create_test_project, auth_user
):
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    object_names = await _create_batch_with_objects(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        image_prefix="image",
        image_count=2,
    )

    result = await ImageClassifier.delete_batch(db, batch_id, project_id)

    assert result["message"] == "Batch deleted successfully"
    assert result["batch_id"] == str(batch_id)
    assert result["deleted_count"] == 2
    assert result["deleted_s3_count"] == 4
    assert await _count_batch_images(db, project_id=project_id, batch_id=batch_id) == 0
    assert all(
        not check_file_exists(settings.S3_BUCKET_NAME, name) for name in object_names
    )


@pytest.mark.asyncio
async def test_move_task_images_to_folder_removes_staging_objects(
    db, create_test_project, auth_user
):
    project_id = uuid.UUID(create_test_project)
    task_id = uuid.uuid4()
    batch_id = uuid.uuid4()
    image_id = uuid.uuid4()
    filename = "moved-image.jpg"
    source_key = f"projects/{project_id}/user-uploads/{batch_id}/{filename}"

    outline_wkb = wkblib.dumps(box(0, 0, 1, 1), hex=True)

    _upload_test_object(source_key, b"image-bytes")

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, project_id, 1, outline_wkb),
        )
        await cur.execute(
            """
            INSERT INTO project_images (
                id,
                project_id,
                filename,
                s3_key,
                hash_md5,
                batch_id,
                task_id,
                uploaded_by,
                status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'assigned')
            """,
            (
                image_id,
                project_id,
                filename,
                source_key,
                uuid.uuid4().hex,
                batch_id,
                task_id,
                auth_user.id,
            ),
        )
    await db.commit()

    result = await ImageClassifier.move_task_images_to_folder(db, project_id, task_id)

    assert result["moved_count"] == 1
    assert result["failed_count"] == 0

    async with db.cursor() as cur:
        await cur.execute(
            "SELECT s3_key FROM project_images WHERE id = %s",
            (image_id,),
        )
        row = await cur.fetchone()

    dest_key = row[0]
    assert dest_key.startswith(f"projects/{project_id}/{task_id}/images/")
    assert check_file_exists(settings.S3_BUCKET_NAME, dest_key)
    assert not check_file_exists(settings.S3_BUCKET_NAME, source_key)


@pytest.mark.asyncio
async def test_move_task_images_to_folder_reconciles_when_destination_exists(
    db, create_test_project, auth_user, monkeypatch
):
    project_id = uuid.UUID(create_test_project)
    task_id = uuid.uuid4()
    batch_id = uuid.uuid4()
    image_id = uuid.uuid4()
    filename = "reconcile.jpg"
    source_key = f"projects/{project_id}/user-uploads/{batch_id}/{filename}"
    image_id_prefix = str(image_id)[:8]
    dest_key = f"projects/{project_id}/{task_id}/images/{image_id_prefix}_{filename}"

    outline_wkb = wkblib.dumps(box(0, 0, 1, 1), hex=True)

    _upload_test_object(dest_key, b"already-copied")

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, project_id, 1, outline_wkb),
        )
        await cur.execute(
            """
            INSERT INTO project_images (
                id,
                project_id,
                filename,
                s3_key,
                hash_md5,
                batch_id,
                task_id,
                uploaded_by,
                status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'assigned')
            """,
            (
                image_id,
                project_id,
                filename,
                source_key,
                uuid.uuid4().hex,
                batch_id,
                task_id,
                auth_user.id,
            ),
        )
    await db.commit()

    monkeypatch.setattr(
        "app.images.image_classification.move_file_within_bucket",
        lambda *_args, **_kwargs: False,
    )

    result = await ImageClassifier.move_task_images_to_folder(db, project_id, task_id)

    assert result["moved_count"] == 1
    assert result["failed_count"] == 0

    async with db.cursor() as cur:
        await cur.execute(
            "SELECT s3_key FROM project_images WHERE id = %s",
            (image_id,),
        )
        row = await cur.fetchone()

    assert row[0] == dest_key

    pending_count = await ImageClassifier.get_task_pending_transfer_count(
        db, project_id, task_id
    )
    assert pending_count == 0


@pytest.mark.asyncio
async def test_delete_batch_route_waits_for_cleanup(
    client, db, create_test_project, auth_user
):
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    object_names = await _create_batch_with_objects(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        image_prefix="sync",
        image_count=2,
    )

    response = await client.delete(
        f"/api/projects/{project_id}/batch/{batch_id}/",
        params={"wait_for_cleanup": "true"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": "Batch deleted successfully",
        "batch_id": str(batch_id),
        "deleted_count": 2,
        "deleted_s3_count": 4,
    }
    assert await _count_batch_images(db, project_id=project_id, batch_id=batch_id) == 0
    assert all(
        not check_file_exists(settings.S3_BUCKET_NAME, name) for name in object_names
    )


@pytest.mark.asyncio
@pytest.mark.integration
async def test_delete_batch_route_enqueues_cleanup_job(
    client, db, create_test_project, auth_user
):
    """Integration test: requires a running ARQ worker to process the background job.

    Skipped by default in unit test runs. Run with: pytest -m integration
    """
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    object_names = await _create_batch_with_objects(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        image_prefix="queued",
        image_count=1,
    )

    response = await client.delete(f"/api/projects/{project_id}/batch/{batch_id}/")

    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Batch deletion started"
    assert body["batch_id"] == str(batch_id)
    assert body["job_id"]

    await _wait_for_batch_cleanup(
        db,
        project_id=project_id,
        batch_id=batch_id,
        object_names=object_names,
    )


# ─── delete_invalid_images tests ─────────────────────────────────────────────


async def _count_project_images(db, *, project_id: uuid.UUID) -> int:
    async with db.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) FROM project_images WHERE project_id = %s",
            (str(project_id),),
        )
        row = await cur.fetchone()
    return int(row[0])


@pytest.mark.asyncio
async def test_delete_invalid_images_removes_unassigned_only(
    db, create_test_project, auth_user
):
    """Only unassigned (task_id IS NULL) invalid images should be deleted.

    Task-linked rejected images (e.g. from flight-tail detection) must be preserved.
    """
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

    outline_wkb = wkblib.dumps(box(0, 0, 1, 1), hex=True)
    async with db.cursor() as cur:
        await cur.execute(
            "INSERT INTO tasks (id, project_id, project_task_index, outline) VALUES (%s, %s, %s, %s)",
            (task_id, project_id, 1, outline_wkb),
        )
    await db.commit()

    # Unassigned rejected image (should be deleted)
    unassigned_key = f"projects/{project_id}/user-uploads/{batch_id}/unassigned.jpg"
    unassigned_thumb = (
        f"projects/{project_id}/user-uploads/{batch_id}/thumbs/unassigned.jpg"
    )
    _upload_test_object(unassigned_key, b"unassigned-image")
    _upload_test_object(unassigned_thumb, b"unassigned-thumb")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="unassigned.jpg",
        s3_key=unassigned_key,
        thumbnail_url=unassigned_thumb,
        status="rejected",
        task_id=None,
    )

    # Unassigned invalid_exif image (should be deleted)
    invalid_exif_key = f"projects/{project_id}/user-uploads/{batch_id}/bad_exif.jpg"
    invalid_exif_thumb = (
        f"projects/{project_id}/user-uploads/{batch_id}/thumbs/bad_exif.jpg"
    )
    _upload_test_object(invalid_exif_key, b"bad-exif-image")
    _upload_test_object(invalid_exif_thumb, b"bad-exif-thumb")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="bad_exif.jpg",
        s3_key=invalid_exif_key,
        thumbnail_url=invalid_exif_thumb,
        status="invalid_exif",
        task_id=None,
    )

    # Task-linked rejected image (flight-tail - must NOT be deleted)
    task_rejected_key = f"projects/{project_id}/{task_id}/images/tail.jpg"
    task_rejected_thumb = f"projects/{project_id}/{task_id}/images/thumbs/tail.jpg"
    _upload_test_object(task_rejected_key, b"tail-image")
    _upload_test_object(task_rejected_thumb, b"tail-thumb")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="tail.jpg",
        s3_key=task_rejected_key,
        thumbnail_url=task_rejected_thumb,
        status="rejected",
        task_id=task_id,
    )

    # Task-linked assigned image (must NOT be deleted)
    assigned_key = f"projects/{project_id}/{task_id}/images/good.jpg"
    _upload_test_object(assigned_key, b"good-image")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="good.jpg",
        s3_key=assigned_key,
        thumbnail_url="",
        status="assigned",
        task_id=task_id,
    )

    await db.commit()

    result = await ImageClassifier.delete_invalid_images(db, project_id)

    assert result["deleted_count"] == 2
    assert result["deleted_s3_count"] == 4  # 2 images + 2 thumbnails

    # Unassigned invalid images removed from S3
    assert not check_file_exists(settings.S3_BUCKET_NAME, unassigned_key)
    assert not check_file_exists(settings.S3_BUCKET_NAME, unassigned_thumb)
    assert not check_file_exists(settings.S3_BUCKET_NAME, invalid_exif_key)
    assert not check_file_exists(settings.S3_BUCKET_NAME, invalid_exif_thumb)

    # Task-linked images preserved in S3
    assert check_file_exists(settings.S3_BUCKET_NAME, task_rejected_key)
    assert check_file_exists(settings.S3_BUCKET_NAME, task_rejected_thumb)
    assert check_file_exists(settings.S3_BUCKET_NAME, assigned_key)

    # Only the 2 task-linked images remain in DB
    assert await _count_project_images(db, project_id=project_id) == 2


@pytest.mark.asyncio
async def test_delete_invalid_images_noop_when_none(db, create_test_project, auth_user):
    """Should return zero counts when no invalid images exist."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()

    # Only assigned images
    key = f"projects/{project_id}/user-uploads/{batch_id}/ok.jpg"
    _upload_test_object(key, b"ok")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="ok.jpg",
        s3_key=key,
        thumbnail_url="",
        status="assigned",
        task_id=None,
    )
    await db.commit()

    result = await ImageClassifier.delete_invalid_images(db, project_id)

    assert result["deleted_count"] == 0
    assert result["deleted_s3_count"] == 0
    assert await _count_project_images(db, project_id=project_id) == 1


@pytest.mark.asyncio
async def test_delete_invalid_images_route(client, db, create_test_project, auth_user):
    """Test the DELETE /projects/{project_id}/imagery/invalid/ route."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()

    key = f"projects/{project_id}/user-uploads/{batch_id}/unmatched.jpg"
    _upload_test_object(key, b"unmatched")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="unmatched.jpg",
        s3_key=key,
        thumbnail_url="",
        status="unmatched",
        task_id=None,
    )
    await db.commit()

    response = await client.delete(
        f"/api/projects/{project_id}/imagery/invalid/",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["deleted_count"] == 1
    assert body["project_id"] == str(project_id)
    assert not check_file_exists(settings.S3_BUCKET_NAME, key)
    assert await _count_project_images(db, project_id=project_id) == 0
