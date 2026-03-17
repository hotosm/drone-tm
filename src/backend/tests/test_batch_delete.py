import asyncio
from io import BytesIO
import uuid

import pytest

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
) -> None:
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO project_images
            (id, project_id, filename, s3_key, thumbnail_url, hash_md5, batch_id, status, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'staged', %s)
            """,
            (
                str(uuid.uuid4()),
                str(project_id),
                filename,
                s3_key,
                thumbnail_url,
                uuid.uuid4().hex,
                str(batch_id),
                uploaded_by,
            ),
        )


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
