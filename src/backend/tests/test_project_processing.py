import os
import uuid

import pytest
from pyodm.exceptions import NodeResponseError

from app.images import image_processing
from app.models.enums import State
from app.projects import project_logic


class _FakeConn:
    def __init__(self):
        self.commit_calls = 0
        self.rollback_calls = 0

    async def commit(self):
        self.commit_calls += 1

    async def rollback(self):
        self.rollback_calls += 1


class _FakePoolConnection:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakePool:
    def __init__(self, conn):
        self.conn = conn

    def connection(self):
        return _FakePoolConnection(self.conn)


class _FakeDbPoolContext:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return _FakePool(self.conn)

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeZipFile:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def extractall(self, path):
        """Create the expected orthophoto file so the code path completes."""
        ortho_dir = os.path.join(path, "odm_orthophoto")
        os.makedirs(ortho_dir, exist_ok=True)
        with open(os.path.join(ortho_dir, "odm_orthophoto.tif"), "wb") as f:
            f.write(b"fake-ortho")


@pytest.mark.asyncio
async def test_process_drone_images_moves_staged_task_images_before_odm(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-1", "db_pool": _FakePool(conn)}
    calls = {"move": [], "state": []}

    async def fake_move_task_images_to_folder(db, project_id_arg, task_id_arg):
        calls["move"].append((db, project_id_arg, task_id_arg))
        return {"moved_count": 13, "failed_count": 0}

    async def fake_update_task_state_system(
        db,
        project_id_arg,
        task_id_arg,
        comment,
        initial_state,
        final_state,
        updated_at,
    ):
        calls["state"].append(
            {
                "project_id": project_id_arg,
                "task_id": task_id_arg,
                "comment": comment,
                "initial_state": initial_state,
                "final_state": final_state,
            }
        )
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    class _FakeOdmResult:
        uuid = "fake-odm-uuid"

    class FakeProcessor:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def process_images_from_s3(self, bucket_name, name, options, webhook):
            return _FakeOdmResult()

    async def fake_update_task_field(*args, **kwargs):
        return None

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(project_logic, "DroneImageProcessor", FakeProcessor)
    monkeypatch.setattr(project_logic, "update_task_field", fake_update_task_field)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic,
        "update_task_state_system",
        fake_update_task_state_system,
    )

    result = await project_logic.process_drone_images(
        ctx,
        project_id,
        task_id,
        "user-123",
    )

    assert result["status"] == "processing_started"
    # State is set to STARTED before the move
    assert calls["state"][0]["final_state"] == State.IMAGE_PROCESSING_STARTED
    assert calls["move"] == [(conn, project_id, task_id)]
    assert conn.commit_calls >= 2


@pytest.mark.asyncio
async def test_process_drone_images_marks_task_failed_when_odm_rejects(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-2", "db_pool": _FakePool(conn)}
    state_calls = []

    async def fake_move_task_images_to_folder(db, project_id_arg, task_id_arg):
        return {"moved_count": 0, "failed_count": 0}

    async def fake_update_task_state_system(
        db,
        project_id_arg,
        task_id_arg,
        comment,
        initial_state,
        final_state,
        updated_at,
    ):
        state_calls.append(
            {
                "comment": comment,
                "initial_state": initial_state,
                "final_state": final_state,
            }
        )
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    class FailingProcessor:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def process_images_from_s3(self, bucket_name, name, options, webhook):
            raise NodeResponseError("Not enough images")

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(project_logic, "DroneImageProcessor", FailingProcessor)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic,
        "update_task_state_system",
        fake_update_task_state_system,
    )

    with pytest.raises(NodeResponseError):
        await project_logic.process_drone_images(
            ctx,
            project_id,
            task_id,
            "user-123",
        )

    assert state_calls[0]["final_state"] == State.IMAGE_PROCESSING_STARTED
    assert state_calls[1]["final_state"] == State.IMAGE_PROCESSING_FAILED
    assert (
        state_calls[1]["comment"]
        == "Not enough images for ODM processing. At least 3 task images are required."
    )


@pytest.mark.asyncio
async def test_process_drone_images_retries_from_failed_state(monkeypatch):
    """Retry a task whose previous processing attempt failed.

    The first transition (READY_FOR_PROCESSING -> STARTED) should return None
    because the task is in IMAGE_PROCESSING_FAILED, then the fallback
    (IMAGE_PROCESSING_FAILED -> STARTED) should succeed.
    """
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-3", "db_pool": _FakePool(conn)}
    state_calls = []

    async def fake_move_task_images_to_folder(db, project_id_arg, task_id_arg):
        return {"moved_count": 0, "failed_count": 0}

    async def fake_update_task_state_system(
        db,
        project_id_arg,
        task_id_arg,
        comment,
        initial_state,
        final_state,
        updated_at,
    ):
        state_calls.append(
            {
                "comment": comment,
                "initial_state": initial_state,
                "final_state": final_state,
            }
        )
        # Simulate: task is currently IMAGE_PROCESSING_FAILED.
        # READY_FOR_PROCESSING -> STARTED fails; IMAGE_PROCESSING_FAILED -> STARTED succeeds.
        if initial_state == State.READY_FOR_PROCESSING:
            return None
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    class _FakeOdmResult:
        uuid = "fake-odm-uuid"

    class FakeProcessor:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def process_images_from_s3(self, bucket_name, name, options, webhook):
            return _FakeOdmResult()

    async def fake_update_task_field(*args, **kwargs):
        return None

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(project_logic, "DroneImageProcessor", FakeProcessor)
    monkeypatch.setattr(project_logic, "update_task_field", fake_update_task_field)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic,
        "update_task_state_system",
        fake_update_task_state_system,
    )

    result = await project_logic.process_drone_images(
        ctx,
        project_id,
        task_id,
        "user-123",
    )

    assert result["status"] == "processing_started"
    # First attempt (READY_FOR_PROCESSING) returned None, second (IMAGE_PROCESSING_FAILED) succeeded
    assert state_calls[0]["initial_state"] == State.READY_FOR_PROCESSING
    assert state_calls[1]["initial_state"] == State.IMAGE_PROCESSING_FAILED
    assert state_calls[1]["final_state"] == State.IMAGE_PROCESSING_STARTED


@pytest.mark.asyncio
async def test_process_drone_images_reruns_from_finished_state(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-4", "db_pool": _FakePool(conn)}
    state_calls = []

    async def fake_move_task_images_to_folder(db, project_id_arg, task_id_arg):
        return {"moved_count": 0, "failed_count": 0}

    async def fake_update_task_state_system(
        db,
        project_id_arg,
        task_id_arg,
        comment,
        initial_state,
        final_state,
        updated_at,
    ):
        state_calls.append(
            {
                "comment": comment,
                "initial_state": initial_state,
                "final_state": final_state,
            }
        )
        if initial_state in (
            State.READY_FOR_PROCESSING,
            State.IMAGE_PROCESSING_FAILED,
        ):
            return None
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    class _FakeOdmResult:
        uuid = "fake-odm-uuid"

    class FakeProcessor:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def process_images_from_s3(self, bucket_name, name, options, webhook):
            return _FakeOdmResult()

    async def fake_update_task_field(*args, **kwargs):
        return None

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(project_logic, "DroneImageProcessor", FakeProcessor)
    monkeypatch.setattr(project_logic, "update_task_field", fake_update_task_field)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic,
        "update_task_state_system",
        fake_update_task_state_system,
    )

    result = await project_logic.process_drone_images(
        ctx,
        project_id,
        task_id,
        "user-123",
    )

    assert result["status"] == "processing_started"
    assert state_calls[0]["initial_state"] == State.READY_FOR_PROCESSING
    assert state_calls[1]["initial_state"] == State.IMAGE_PROCESSING_FAILED
    assert state_calls[2]["initial_state"] == State.IMAGE_PROCESSING_FINISHED
    assert state_calls[2]["final_state"] == State.IMAGE_PROCESSING_STARTED


@pytest.mark.asyncio
async def test_process_drone_images_raises_when_state_invalid(monkeypatch):
    """If task is in none of the allowed processing states, raise immediately."""
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-5", "db_pool": _FakePool(conn)}

    async def fake_move_task_images_to_folder(db, project_id_arg, task_id_arg):
        return {"moved_count": 0, "failed_count": 0}

    async def fake_update_task_state_system(
        db, project_id_arg, task_id_arg, comment, initial_state, final_state, updated_at
    ):
        # Both transitions fail - task is in an unexpected state
        return None

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic,
        "update_task_state_system",
        fake_update_task_state_system,
    )

    with pytest.raises(RuntimeError, match="not in a valid state"):
        await project_logic.process_drone_images(
            ctx,
            project_id,
            task_id,
            "user-123",
        )


@pytest.mark.asyncio
async def test_process_assets_from_odm_does_not_mark_single_task_project_complete(
    monkeypatch, tmp_path
):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    update_processing_calls = []

    assets_zip = tmp_path / "assets.zip"
    assets_zip.write_bytes(b"zip")
    ortho_dir = tmp_path / "odm_orthophoto"
    ortho_dir.mkdir()
    (ortho_dir / "odm_orthophoto.tif").write_bytes(b"ortho")

    class FakeTask:
        def download_zip(self, output_path):
            return str(assets_zip)

        def remove(self):
            return None

    class FakeNode:
        def get_task(self, odm_task_id):
            return FakeTask()

    async def fake_get_db_connection_pool():
        return _FakeDbPoolContext(conn)

    async def fake_update_task_state_system(**kwargs):
        return {
            "project_id": kwargs.get("project_id"),
            "task_id": kwargs.get("task_id"),
        }

    async def fake_update_task_field(*args, **kwargs):
        return None

    async def fake_update_processing_status(db, project_id_arg, status):
        update_processing_calls.append((project_id_arg, status))

    monkeypatch.setattr(image_processing.Node, "from_url", lambda _url: FakeNode())
    monkeypatch.setattr(
        image_processing.database,
        "get_db_connection_pool",
        fake_get_db_connection_pool,
    )
    monkeypatch.setattr(
        image_processing.task_logic,
        "update_task_state_system",
        fake_update_task_state_system,
    )
    monkeypatch.setattr(
        image_processing.project_logic,
        "update_task_field",
        fake_update_task_field,
    )
    monkeypatch.setattr(
        image_processing.project_logic,
        "update_processing_status",
        fake_update_processing_status,
    )
    monkeypatch.setattr(
        image_processing, "add_file_to_bucket", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        image_processing,
        "reproject_to_web_mercator",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(image_processing.zipfile, "ZipFile", _FakeZipFile)

    await image_processing.process_assets_from_odm(
        node_odm_url="http://odm",
        dtm_project_id=project_id,
        odm_task_id="odm-task-id",
        state=State.IMAGE_PROCESSING_STARTED,
        message="Task completed.",
        dtm_task_id=task_id,
        odm_status_code=40,
    )

    assert update_processing_calls == []
