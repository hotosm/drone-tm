import asyncio
import uuid
from io import BytesIO

import pytest
from app.arq.tasks import get_redis_pool
from app.config import settings
from app.images.image_classification import ImageClassifier
from app.models.enums import UserRole
from app.s3 import add_obj_to_bucket, check_file_exists
from app.users.user_deps import login_dependency
from app.users.user_schemas import AuthUser
from arq.constants import job_key_prefix, result_key_prefix
from psycopg import AsyncConnection
from shapely import wkb as wkblib
from shapely.geometry import box


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
async def test_delete_image_removes_db_row_and_s3_objects(
    db, create_test_project, auth_user
):
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    image_id = uuid.uuid4()
    s3_key = f"projects/{project_id}/user-uploads/{batch_id}/single.jpg"
    thumbnail_key = f"projects/{project_id}/user-uploads/{batch_id}/thumbs/single.jpg"

    _upload_test_object(s3_key, b"image-bytes")
    _upload_test_object(thumbnail_key, b"thumb-bytes")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="single.jpg",
        s3_key=s3_key,
        thumbnail_url=thumbnail_key,
        status="assigned",
        image_id=image_id,
    )
    await db.commit()

    result = await ImageClassifier.delete_image(db, image_id, project_id)

    assert result["message"] == "Image deleted successfully"
    assert result["image_id"] == str(image_id)
    assert result["deleted_s3_count"] == 2

    async with db.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) FROM project_images WHERE id = %s", (image_id,)
        )
        row = await cur.fetchone()

    assert int(row[0]) == 0
    assert not check_file_exists(settings.S3_BUCKET_NAME, s3_key)
    assert not check_file_exists(settings.S3_BUCKET_NAME, thumbnail_key)


@pytest.mark.asyncio
async def test_delete_duplicate_image_keeps_shared_s3_object(
    db, create_test_project, auth_user
):
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    image_id = uuid.uuid4()
    s3_key = f"projects/{project_id}/user-uploads/{batch_id}/duplicate-source.jpg"

    _upload_test_object(s3_key, b"shared-image-bytes")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="duplicate-source.jpg",
        s3_key=s3_key,
        thumbnail_url="",
        status="duplicate",
        image_id=image_id,
    )
    await db.commit()

    result = await ImageClassifier.delete_image(db, image_id, project_id)

    assert result["deleted_s3_count"] == 0

    async with db.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) FROM project_images WHERE id = %s", (image_id,)
        )
        row = await cur.fetchone()

    assert int(row[0]) == 0
    assert check_file_exists(settings.S3_BUCKET_NAME, s3_key)


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
async def test_prune_deassigned_task_images_moves_rejected_out_of_folder(
    db, create_test_project, auth_user
):
    """A rejected image left in the task folder is moved back to staging."""
    project_id = uuid.UUID(create_test_project)
    task_id = uuid.uuid4()
    batch_id = uuid.uuid4()
    image_id = uuid.uuid4()
    filename = "rejected-after-ready.jpg"
    image_id_prefix = str(image_id)[:8]
    # Simulate an image that was assigned+moved into the folder, then rejected
    # in the UI (status flipped, but the file was never relocated).
    task_key = f"projects/{project_id}/{task_id}/images/{image_id_prefix}_{filename}"

    outline_wkb = wkblib.dumps(box(0, 0, 1, 1), hex=True)
    _upload_test_object(task_key, b"rejected-image-bytes")

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, project_id, 1, outline_wkb),
        )
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename=filename,
        s3_key=task_key,
        thumbnail_url="",
        status="rejected",
        task_id=task_id,
        image_id=image_id,
    )
    await db.commit()

    result = await ImageClassifier.prune_deassigned_task_images(db, project_id, task_id)

    assert result["pruned_count"] == 1
    assert result["failed_count"] == 0

    async with db.cursor() as cur:
        await cur.execute(
            "SELECT s3_key FROM project_images WHERE id = %s",
            (image_id,),
        )
        new_key = (await cur.fetchone())[0]

    # File relocated out of the ODM input folder, back into staging.
    assert "user-uploads" in new_key
    assert not new_key.startswith(f"projects/{project_id}/{task_id}/images/")
    assert check_file_exists(settings.S3_BUCKET_NAME, new_key)
    assert not check_file_exists(settings.S3_BUCKET_NAME, task_key)


@pytest.mark.asyncio
async def test_prune_deassigned_task_images_keeps_assigned_images(
    db, create_test_project, auth_user
):
    """An assigned image in the task folder must NOT be pruned."""
    project_id = uuid.UUID(create_test_project)
    task_id = uuid.uuid4()
    batch_id = uuid.uuid4()
    image_id = uuid.uuid4()
    filename = "keep-me.jpg"
    image_id_prefix = str(image_id)[:8]
    task_key = f"projects/{project_id}/{task_id}/images/{image_id_prefix}_{filename}"

    outline_wkb = wkblib.dumps(box(0, 0, 1, 1), hex=True)
    _upload_test_object(task_key, b"assigned-image-bytes")

    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO tasks (id, project_id, project_task_index, outline)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, project_id, 1, outline_wkb),
        )
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename=filename,
        s3_key=task_key,
        thumbnail_url="",
        status="assigned",
        task_id=task_id,
        image_id=image_id,
    )
    await db.commit()

    result = await ImageClassifier.prune_deassigned_task_images(db, project_id, task_id)

    assert result["pruned_count"] == 0
    async with db.cursor() as cur:
        await cur.execute(
            "SELECT s3_key FROM project_images WHERE id = %s",
            (image_id,),
        )
        assert (await cur.fetchone())[0] == task_key
    assert check_file_exists(settings.S3_BUCKET_NAME, task_key)


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
        "failed_count": 0,
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
async def test_delete_invalid_images_skips_image_with_pending_assignment(
    db, create_test_project, auth_user
):
    """Assignment holds the row lock first: cleanup must wait, then skip the image."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

    outline_wkb = wkblib.dumps(box(0, 0, 1, 1), hex=True)
    async with db.cursor() as cur:
        await cur.execute(
            "INSERT INTO tasks (id, project_id, project_task_index, outline) VALUES (%s, %s, %s, %s)",
            (task_id, project_id, 1, outline_wkb),
        )

    key = f"projects/{project_id}/user-uploads/{batch_id}/late-assign.jpg"
    _upload_test_object(key, b"late-assign")
    image_id = await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="late-assign.jpg",
        s3_key=key,
        thumbnail_url="",
        status="unmatched",
        task_id=None,
    )
    await db.commit()

    # Assign the image on a second connection, uncommitted, so cleanup has to
    # block on the row lock rather than acting on its own stale snapshot.
    other_conn = await AsyncConnection.connect(
        conninfo=settings.DTM_DB_URL.unicode_string()
    )
    try:
        async with other_conn.cursor() as cur:
            await cur.execute(
                "UPDATE project_images SET task_id = %s, status = 'assigned' WHERE id = %s",
                (str(task_id), str(image_id)),
            )

        cleanup = asyncio.create_task(
            ImageClassifier.delete_invalid_images(db, project_id)
        )
        await asyncio.sleep(0.5)
        assert not cleanup.done(), "cleanup did not wait for the assignment lock"

        await other_conn.commit()
        result = await asyncio.wait_for(cleanup, timeout=10)
    finally:
        await other_conn.close()

    assert result["deleted_count"] == 0
    assert check_file_exists(settings.S3_BUCKET_NAME, key)
    assert await _count_project_images(db, project_id=project_id) == 1


@pytest.mark.asyncio
async def test_manual_assign_fails_when_cleanup_deletes_image_first(
    db, create_test_project, auth_user
):
    """Cleanup holds the row lock first: the waiting assignment must not report success."""
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()
    task_id = uuid.uuid4()

    outline_wkb = wkblib.dumps(box(0, 0, 1, 1), hex=True)
    async with db.cursor() as cur:
        await cur.execute(
            "INSERT INTO tasks (id, project_id, project_task_index, outline) VALUES (%s, %s, %s, %s)",
            (task_id, project_id, 1, outline_wkb),
        )

    image_id = await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="doomed.jpg",
        s3_key=f"projects/{project_id}/user-uploads/{batch_id}/doomed.jpg",
        thumbnail_url="",
        status="unmatched",
        task_id=None,
    )
    await db.commit()

    # Stand in for cleanup: lock the row, then delete it while the assign waits.
    cleanup_conn = await AsyncConnection.connect(
        conninfo=settings.DTM_DB_URL.unicode_string()
    )
    try:
        async with cleanup_conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM project_images WHERE id = %s FOR UPDATE",
                (str(image_id),),
            )

        assign = asyncio.create_task(
            ImageClassifier.manual_assign_to_task(db, image_id, task_id, project_id)
        )
        await asyncio.sleep(0.5)
        assert not assign.done(), "assignment did not wait for the cleanup lock"

        async with cleanup_conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM project_images WHERE id = %s", (str(image_id),)
            )
        await cleanup_conn.commit()

        with pytest.raises(ValueError, match="no longer exists"):
            await asyncio.wait_for(assign, timeout=10)
    finally:
        await cleanup_conn.close()

    assert await _count_project_images(db, project_id=project_id) == 0


@pytest.mark.asyncio
async def test_delete_invalid_images_route_forbidden_for_other_user(
    app, client, create_test_project
):
    """Only the project creator or a superuser may trigger cleanup."""
    other_user = AuthUser(
        id="999000111222333444",
        email="someone.else@hotosm.org",
        name="someone else",
        profile_img="",
        role=UserRole.DRONE_PILOT.name,
        is_superuser=False,
    )
    app.dependency_overrides[login_dependency] = lambda: other_user

    response = await client.delete(
        f"/api/projects/{create_test_project}/imagery/invalid/"
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_delete_invalid_images_route_dedupes_queued_job(
    app, client, arq_test_redis, create_test_project
):
    """A stable job id blocks a second run, but not one after the job finished."""
    app.dependency_overrides[get_redis_pool] = lambda: arq_test_redis
    url = f"/api/projects/{create_test_project}/imagery/invalid/"
    job_id = f"cleanup-invalid:{create_test_project}"

    assert (await client.delete(url)).status_code == 202
    assert (await client.delete(url)).status_code == 409

    # Simulate the worker finishing: job key gone, only the result key remains.
    await arq_test_redis.delete(job_key_prefix + job_id)
    await arq_test_redis.set(result_key_prefix + job_id, "done")

    assert (await client.delete(url)).status_code == 202


@pytest.mark.asyncio
@pytest.mark.integration
async def test_delete_invalid_images_route_enqueues_cleanup_job(
    client, db, create_test_project, auth_user
):
    """Integration test: requires a running ARQ worker to process the background job.

    Skipped by default in unit test runs. Run with: pytest -m integration
    """
    project_id = uuid.UUID(create_test_project)
    batch_id = uuid.uuid4()

    key = f"projects/{project_id}/user-uploads/{batch_id}/queued-unmatched.jpg"
    _upload_test_object(key, b"unmatched")
    await _insert_batch_image(
        db,
        project_id=project_id,
        batch_id=batch_id,
        uploaded_by=auth_user.id,
        filename="queued-unmatched.jpg",
        s3_key=key,
        thumbnail_url="",
        status="unmatched",
        task_id=None,
    )
    await db.commit()

    response = await client.delete(f"/api/projects/{project_id}/imagery/invalid/")

    assert response.status_code == 202
    body = response.json()
    assert body["message"] == "Invalid imagery cleanup started"
    assert body["project_id"] == str(project_id)
    assert body["job_id"]

    await _wait_for_batch_cleanup(
        db,
        project_id=project_id,
        batch_id=batch_id,
        object_names=[key],
    )
