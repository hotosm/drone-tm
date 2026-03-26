import uuid

import pytest
from pyodm.exceptions import NodeResponseError

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

    class FakeProcessor:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def process_images_from_s3(self, bucket_name, name, options, webhook):
            return {
                "bucket_name": bucket_name,
                "name": name,
                "webhook": webhook,
            }

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(project_logic, "DroneImageProcessor", FakeProcessor)

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

    The first transition (IMAGE_UPLOADED -> STARTED) should return None
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
        # IMAGE_UPLOADED -> STARTED fails; IMAGE_PROCESSING_FAILED -> STARTED succeeds.
        if initial_state == State.IMAGE_UPLOADED:
            return None
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    class FakeProcessor:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def process_images_from_s3(self, bucket_name, name, options, webhook):
            return {"bucket_name": bucket_name, "name": name, "webhook": webhook}

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(project_logic, "DroneImageProcessor", FakeProcessor)

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
    # First attempt (IMAGE_UPLOADED) returned None, second (IMAGE_PROCESSING_FAILED) succeeded
    assert state_calls[0]["initial_state"] == State.IMAGE_UPLOADED
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
            State.IMAGE_UPLOADED,
            State.IMAGE_PROCESSING_FAILED,
        ):
            return None
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    class FakeProcessor:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def process_images_from_s3(self, bucket_name, name, options, webhook):
            return {"bucket_name": bucket_name, "name": name, "webhook": webhook}

    monkeypatch.setattr(
        project_logic.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(project_logic, "DroneImageProcessor", FakeProcessor)

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
    assert state_calls[0]["initial_state"] == State.IMAGE_UPLOADED
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
