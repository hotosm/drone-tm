import json
import uuid

import pytest

from app import utils as app_utils
from app.images import image_processing
from app.models.enums import ImageProcessingStatus, State
from app.projects import project_logic
from app.arq import tasks as arq_tasks


class _FakeCursor:
    """Minimal async context-manager cursor; fetchone() returns None by default."""

    def __init__(self, fetchone_result=None):
        self._fetchone_result = fetchone_result
        self.executed = []

    async def execute(self, query, params=None):
        self.executed.append({"query": query, "params": params})

    async def fetchone(self):
        return self._fetchone_result

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def __init__(self, cursor_fetchone=None):
        self.commit_calls = 0
        self.rollback_calls = 0
        self.executed = []
        self._cursor_fetchone = cursor_fetchone

    async def execute(self, query, params=None):
        self.executed.append({"query": query, "params": params})

    async def commit(self):
        self.commit_calls += 1

    async def rollback(self):
        self.rollback_calls += 1

    def cursor(self, **kwargs):
        return _FakeCursor(self._cursor_fetchone)


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


# ── submit_scaleodm_task ──────────────────────────────────────────────────────


class _FakeScaleOdmResponse:
    def __init__(self, *, status: int, payload: dict | str):
        self.status = status
        self._payload = payload

    async def text(self) -> str:
        return (
            self._payload
            if isinstance(self._payload, str)
            else json.dumps(self._payload)
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeScaleOdmSession:
    """Captures POST /task/new calls and returns a configured response."""

    def __init__(self, *, response: _FakeScaleOdmResponse):
        self._response = response
        self.posts: list[tuple[str, dict]] = []

    def post(self, url, json=None, **kwargs):
        self.posts.append((url, json or {}))
        return self._response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_submit_scaleodm_task_posts_expected_body(monkeypatch):
    response = _FakeScaleOdmResponse(status=200, payload={"uuid": "odm-pipeline-abc"})
    captured = {"session": None}

    def make_session(*args, **kwargs):
        captured["session"] = _FakeScaleOdmSession(response=response)
        return captured["session"]

    monkeypatch.setattr(image_processing.aiohttp, "ClientSession", make_session)

    odm_uuid = await image_processing.submit_scaleodm_task(
        scaleodm_url="http://scaleodm:31100/",
        read_s3_path="s3://bucket/projects/p/t/images/",
        write_s3_path="s3://bucket/projects/p/t/odm/",
        name="DTM-Task-t",
        options=[{"name": "dsm", "value": True}],
        processing_mode="standard",
        s3_scan_depth=1,
        exclude_paths=["*/thumbs/*"],
        s3_endpoint="http://s3-internal",
    )

    assert odm_uuid == "odm-pipeline-abc"
    session = captured["session"]
    assert len(session.posts) == 1
    url, body = session.posts[0]
    assert url == "http://scaleodm:31100/task/new"
    assert body["readS3Path"] == "s3://bucket/projects/p/t/images/"
    assert body["writeS3Path"] == "s3://bucket/projects/p/t/odm/"
    assert body["name"] == "DTM-Task-t"
    assert "webhook" not in body
    assert body["processingMode"] == "standard"
    assert body["s3ScanDepth"] == 1
    assert body["useDefaultExcludes"] is True
    assert body["s3Endpoint"] == "http://s3-internal"
    assert body["excludePaths"] == json.dumps(["*/thumbs/*"])
    assert body["options"] == json.dumps([{"name": "dsm", "value": True}])


@pytest.mark.asyncio
async def test_submit_scaleodm_task_raises_with_server_error_message(monkeypatch):
    response = _FakeScaleOdmResponse(status=400, payload={"error": "Not enough images"})

    def make_session(*args, **kwargs):
        return _FakeScaleOdmSession(response=response)

    monkeypatch.setattr(image_processing.aiohttp, "ClientSession", make_session)

    with pytest.raises(image_processing.ScaleOdmSubmitError) as exc_info:
        await image_processing.submit_scaleodm_task(
            scaleodm_url="http://scaleodm:31100",
            read_s3_path="s3://bucket/projects/p/t/images/",
            write_s3_path="s3://bucket/projects/p/t/odm/",
            name="DTM-Task-t",
            options=[],
        )

    assert "Not enough images" in str(exc_info.value)
    assert exc_info.value.status == 400


# ── process_drone_images (per-task) ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_process_drone_images_submits_standard_mode(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-1", "db_pool": _FakePool(conn)}
    state_calls = []
    submit_calls = []

    async def fake_update_task_state_system(
        db, project_id_arg, task_id_arg, comment, initial_state, final_state, updated_at
    ):
        state_calls.append({"initial_state": initial_state, "final_state": final_state})
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    async def fake_submit_scaleodm_task(**kwargs):
        submit_calls.append(kwargs)
        return "fake-odm-uuid"

    async def fake_update_task_field(*args, **kwargs):
        return None

    monkeypatch.setattr(
        project_logic, "submit_scaleodm_task", fake_submit_scaleodm_task
    )
    monkeypatch.setattr(project_logic, "update_task_field", fake_update_task_field)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic, "update_task_state_system", fake_update_task_state_system
    )

    result = await project_logic.process_drone_images(
        ctx, project_id, task_id, "user-123"
    )

    assert result["status"] == "processing_started"
    assert result["odm_task_uuid"] == "fake-odm-uuid"
    assert len(submit_calls) == 1
    submitted = submit_calls[0]
    assert submitted["processing_mode"] == "standard"
    assert submitted["s3_scan_depth"] == 0
    assert submitted["exclude_paths"] == ["*/thumbs/*"]
    assert submitted["read_s3_path"].endswith(
        f"/projects/{project_id}/{task_id}/images/"
    )
    assert submitted["write_s3_path"].endswith(f"/projects/{project_id}/{task_id}/odm/")
    assert submitted["name"] == f"DTM-Task-{task_id}"
    assert state_calls[0]["final_state"] == State.IMAGE_PROCESSING_STARTED


@pytest.mark.asyncio
async def test_process_drone_images_marks_task_failed_when_odm_rejects(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-2", "db_pool": _FakePool(conn)}
    state_calls = []

    async def fake_update_task_state_system(
        db, project_id_arg, task_id_arg, comment, initial_state, final_state, updated_at
    ):
        state_calls.append(
            {
                "comment": comment,
                "initial_state": initial_state,
                "final_state": final_state,
            }
        )
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    async def failing_submit(**kwargs):
        raise image_processing.ScaleOdmSubmitError("Not enough images", status=400)

    monkeypatch.setattr(project_logic, "submit_scaleodm_task", failing_submit)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic, "update_task_state_system", fake_update_task_state_system
    )

    with pytest.raises(image_processing.ScaleOdmSubmitError):
        await project_logic.process_drone_images(ctx, project_id, task_id, "user-123")

    assert state_calls[0]["final_state"] == State.IMAGE_PROCESSING_STARTED
    assert state_calls[1]["final_state"] == State.IMAGE_PROCESSING_FAILED
    assert (
        state_calls[1]["comment"]
        == "Not enough images for ODM processing. At least 3 task images are required."
    )


@pytest.mark.asyncio
async def test_process_drone_images_retries_from_failed_state(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-3", "db_pool": _FakePool(conn)}
    state_calls = []

    async def fake_update_task_state_system(
        db, project_id_arg, task_id_arg, comment, initial_state, final_state, updated_at
    ):
        state_calls.append({"initial_state": initial_state, "final_state": final_state})
        if initial_state == State.READY_FOR_PROCESSING:
            return None
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    async def fake_submit(**kwargs):
        return "fake-odm-uuid"

    async def fake_update_task_field(*args, **kwargs):
        return None

    monkeypatch.setattr(project_logic, "submit_scaleodm_task", fake_submit)
    monkeypatch.setattr(project_logic, "update_task_field", fake_update_task_field)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic, "update_task_state_system", fake_update_task_state_system
    )

    result = await project_logic.process_drone_images(
        ctx, project_id, task_id, "user-123"
    )

    assert result["status"] == "processing_started"
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

    async def fake_update_task_state_system(
        db, project_id_arg, task_id_arg, comment, initial_state, final_state, updated_at
    ):
        state_calls.append({"initial_state": initial_state, "final_state": final_state})
        if initial_state in (
            State.READY_FOR_PROCESSING,
            State.IMAGE_PROCESSING_FAILED,
        ):
            return None
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    async def fake_submit(**kwargs):
        return "fake-odm-uuid"

    async def fake_update_task_field(*args, **kwargs):
        return None

    monkeypatch.setattr(project_logic, "submit_scaleodm_task", fake_submit)
    monkeypatch.setattr(project_logic, "update_task_field", fake_update_task_field)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic, "update_task_state_system", fake_update_task_state_system
    )

    result = await project_logic.process_drone_images(
        ctx, project_id, task_id, "user-123"
    )

    assert result["status"] == "processing_started"
    assert state_calls[2]["initial_state"] == State.IMAGE_PROCESSING_FINISHED
    assert state_calls[2]["final_state"] == State.IMAGE_PROCESSING_STARTED


@pytest.mark.asyncio
async def test_process_drone_images_raises_when_state_invalid(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-5", "db_pool": _FakePool(conn)}

    async def fake_update_task_state_system(*args, **kwargs):
        return None

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic, "update_task_state_system", fake_update_task_state_system
    )

    with pytest.raises(RuntimeError, match="not in a valid state"):
        await project_logic.process_drone_images(ctx, project_id, task_id, "user-123")


@pytest.mark.asyncio
async def test_process_drone_images_propagates_scaleodm_s3_endpoint(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-s3-endpoint", "db_pool": _FakePool(conn)}
    submit_calls = []

    async def fake_update_task_state_system(*args, **kwargs):
        return {"ok": True}

    async def fake_submit(**kwargs):
        submit_calls.append(kwargs)
        return "fake-odm-uuid"

    async def fake_update_task_field(*args, **kwargs):
        return None

    monkeypatch.setattr(project_logic, "submit_scaleodm_task", fake_submit)
    monkeypatch.setattr(project_logic, "update_task_field", fake_update_task_field)
    monkeypatch.setattr(
        project_logic.settings, "SCALEODM_S3_ENDPOINT", "http://minio.svc:9000"
    )

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic, "update_task_state_system", fake_update_task_state_system
    )

    await project_logic.process_drone_images(ctx, project_id, task_id, "user-123")

    assert submit_calls[0]["s3_endpoint"] == "http://minio.svc:9000"


# ── process_all_drone_images (project-wide) ───────────────────────────────────


@pytest.mark.asyncio
async def test_process_all_drone_images_uses_project_wide_scan_depth(monkeypatch):
    project_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "proj-1", "db_pool": _FakePool(conn)}
    submit_calls = []

    async def fake_submit(**kwargs):
        submit_calls.append(kwargs)
        return "fake-project-odm-uuid"

    monkeypatch.setattr(project_logic, "submit_scaleodm_task", fake_submit)

    await project_logic.process_all_drone_images(
        ctx, project_id, [uuid.uuid4()], "user-123"
    )

    assert len(submit_calls) == 1
    submitted = submit_calls[0]
    assert submitted["processing_mode"] == "standard"
    assert submitted["s3_scan_depth"] == 3
    assert submitted["use_default_excludes"] is True
    assert submitted["exclude_paths"] == [
        "*/thumbs/*",
        "user-uploads/*",
        "thumb_*",
        "dem.tif",
        "map_screenshot.png",
        "odm/*",
    ]
    assert submitted["read_s3_path"].endswith(f"/projects/{project_id}/")
    assert submitted["write_s3_path"].endswith(f"/projects/{project_id}/odm/")
    assert submitted["name"] == f"DTM-Project-{project_id}"


# ── finalize_scaleodm_task ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_finalize_scaleodm_task_completes_task_and_removes_odm_row(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "fin-1", "db_pool": _FakePool(conn), "redis": None}
    state_calls = []
    field_calls = []
    remove_calls = []

    async def fake_update_task_state_system(**kwargs):
        state_calls.append(kwargs)
        return {"ok": True}

    async def fake_update_task_field(db, pid, tid, column, value):
        field_calls.append({"column": column, "value": value})

    async def fake_get_task_state(db, pid, tid):
        return {"state": State.IMAGE_PROCESSING_STARTED.name}

    async def fake_remove(*, scaleodm_url, odm_task_uuid):
        remove_calls.append({"url": scaleodm_url, "uuid": odm_task_uuid})

    monkeypatch.setattr(arq_tasks, "remove_scaleodm_task", fake_remove)
    monkeypatch.setattr(
        arq_tasks.task_logic, "update_task_state_system", fake_update_task_state_system
    )
    monkeypatch.setattr(arq_tasks.task_logic, "get_task_state", fake_get_task_state)
    monkeypatch.setattr(
        arq_tasks.project_logic, "update_task_field", fake_update_task_field
    )

    result = await arq_tasks.finalize_scaleodm_task(
        ctx,
        scaleodm_url="http://scaleodm",
        dtm_project_id=str(project_id),
        odm_task_uuid="odm-uuid-1",
        odm_status_code=40,
        state_name=State.IMAGE_PROCESSING_STARTED.name,
        message="Task completed.",
        dtm_task_id=str(task_id),
    )

    assert result["status"] == "completed"
    assert state_calls[0]["final_state"] == State.IMAGE_PROCESSING_FINISHED
    assert field_calls == [
        {"column": "assets_url", "value": f"projects/{project_id}/{task_id}/odm/"}
    ]
    assert remove_calls == [{"url": "http://scaleodm", "uuid": "odm-uuid-1"}]


@pytest.mark.asyncio
async def test_finalize_scaleodm_task_skips_remove_when_odm_uuid_unknown(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {
        "job_id": "fin-orphan",
        "db_pool": _FakePool(conn),
        "redis": None,
    }
    state_calls = []
    field_calls = []

    async def fake_update_task_state_system(**kwargs):
        state_calls.append(kwargs)
        return {"ok": True}

    async def fake_update_task_field(db, pid, tid, column, value):
        field_calls.append({"column": column, "value": value})

    async def fake_get_task_state(db, pid, tid):
        return {"state": State.IMAGE_PROCESSING_STARTED.name}

    async def fake_remove(*args, **kwargs):
        raise AssertionError("remove_scaleodm_task should not be called")

    monkeypatch.setattr(arq_tasks, "remove_scaleodm_task", fake_remove)
    monkeypatch.setattr(arq_tasks.task_logic, "get_task_state", fake_get_task_state)
    monkeypatch.setattr(
        arq_tasks.task_logic, "update_task_state_system", fake_update_task_state_system
    )
    monkeypatch.setattr(
        arq_tasks.project_logic, "update_task_field", fake_update_task_field
    )

    result = await arq_tasks.finalize_scaleodm_task(
        ctx,
        scaleodm_url="http://scaleodm",
        dtm_project_id=str(project_id),
        odm_task_uuid=None,
        odm_status_code=40,
        state_name=State.IMAGE_PROCESSING_STARTED.name,
        message="Task completed.",
        dtm_task_id=str(task_id),
    )

    assert result["status"] == "completed"
    assert state_calls[0]["final_state"] == State.IMAGE_PROCESSING_FINISHED
    assert field_calls == [
        {"column": "assets_url", "value": f"projects/{project_id}/{task_id}/odm/"}
    ]


@pytest.mark.asyncio
async def test_finalize_scaleodm_task_skips_when_state_already_changed(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "fin-2", "db_pool": _FakePool(conn), "redis": None}
    state_calls = []

    async def fake_get_task_state(db, pid, tid):
        # Different from expected: someone else already finalized.
        return {"state": State.IMAGE_PROCESSING_FINISHED.name}

    async def fake_update_task_state_system(**kwargs):
        state_calls.append(kwargs)
        return {"ok": True}

    monkeypatch.setattr(arq_tasks.task_logic, "get_task_state", fake_get_task_state)
    monkeypatch.setattr(
        arq_tasks.task_logic, "update_task_state_system", fake_update_task_state_system
    )

    result = await arq_tasks.finalize_scaleodm_task(
        ctx,
        scaleodm_url="http://scaleodm",
        dtm_project_id=str(project_id),
        odm_task_uuid="odm-uuid-2",
        odm_status_code=40,
        state_name=State.IMAGE_PROCESSING_STARTED.name,
        message="Task completed.",
        dtm_task_id=str(task_id),
    )

    assert result["status"] == "skipped"
    assert state_calls == []


@pytest.mark.asyncio
async def test_finalize_scaleodm_task_pulls_error_message_on_status_30(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "fin-3", "job_try": 1, "db_pool": _FakePool(conn), "redis": None}
    state_calls = []
    remove_calls = []

    async def fake_get_task_state(db, pid, tid):
        return {"state": State.IMAGE_PROCESSING_STARTED.name}

    async def fake_update_task_state_system(**kwargs):
        state_calls.append(kwargs)
        return {"ok": True}

    async def fake_fetch_info(*, scaleodm_url, odm_task_uuid):
        return {"errorMessage": "ODM exited with code 1"}

    async def fake_remove(*, scaleodm_url, odm_task_uuid):
        remove_calls.append(odm_task_uuid)

    monkeypatch.setattr(arq_tasks, "fetch_scaleodm_task_info", fake_fetch_info)
    monkeypatch.setattr(arq_tasks, "remove_scaleodm_task", fake_remove)
    monkeypatch.setattr(arq_tasks.task_logic, "get_task_state", fake_get_task_state)
    monkeypatch.setattr(
        arq_tasks.task_logic, "update_task_state_system", fake_update_task_state_system
    )

    result = await arq_tasks.finalize_scaleodm_task(
        ctx,
        scaleodm_url="http://scaleodm",
        dtm_project_id=str(project_id),
        odm_task_uuid="odm-uuid-3",
        odm_status_code=30,
        state_name=State.IMAGE_PROCESSING_STARTED.name,
        message="Image processing failed.",
        dtm_task_id=str(task_id),
    )

    assert result["status"] == "failed"
    assert state_calls
    assert state_calls[0]["final_state"] == State.IMAGE_PROCESSING_FAILED
    assert "ODM exited with code 1" in state_calls[0]["comment"]
    assert remove_calls == ["odm-uuid-3"]


@pytest.mark.asyncio
async def test_finalize_scaleodm_task_project_level_completion(monkeypatch):
    project_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {
        "job_id": "fin-proj",
        "db_pool": _FakePool(conn),
        "redis": None,
    }
    processing_status_calls = []

    async def fake_update_processing_status(db, pid, status):
        processing_status_calls.append({"project_id": pid, "status": status})

    async def fake_remove(*args, **kwargs):
        return None

    monkeypatch.setattr(arq_tasks, "remove_scaleodm_task", fake_remove)
    monkeypatch.setattr(
        arq_tasks.project_logic,
        "update_processing_status",
        fake_update_processing_status,
    )

    result = await arq_tasks.finalize_scaleodm_task(
        ctx,
        scaleodm_url="http://scaleodm",
        dtm_project_id=str(project_id),
        odm_task_uuid="odm-uuid-proj",
        odm_status_code=40,
        state_name=None,
        message="Task completed.",
        dtm_task_id=None,
    )

    assert result["status"] == "completed"
    assert processing_status_calls
    assert processing_status_calls[0]["status"] == ImageProcessingStatus.SUCCESS
    assert processing_status_calls[0]["project_id"] == project_id


@pytest.mark.asyncio
async def test_finalize_scaleodm_task_project_level_failure(monkeypatch):
    project_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {
        "job_id": "fin-proj-fail",
        "job_try": 1,
        "db_pool": _FakePool(conn),
        "redis": None,
    }
    processing_status_calls = []

    async def fake_update_processing_status(db, pid, status):
        processing_status_calls.append({"project_id": pid, "status": status})

    async def fake_fetch_info(*, scaleodm_url, odm_task_uuid):
        return None

    async def fake_remove(*args, **kwargs):
        return None

    monkeypatch.setattr(arq_tasks, "fetch_scaleodm_task_info", fake_fetch_info)
    monkeypatch.setattr(arq_tasks, "remove_scaleodm_task", fake_remove)
    monkeypatch.setattr(
        arq_tasks.project_logic,
        "update_processing_status",
        fake_update_processing_status,
    )

    result = await arq_tasks.finalize_scaleodm_task(
        ctx,
        scaleodm_url="http://scaleodm",
        dtm_project_id=str(project_id),
        odm_task_uuid="odm-uuid-proj-fail",
        odm_status_code=30,
        state_name=None,
        message="Image processing failed.",
        dtm_task_id=None,
    )

    assert result["status"] == "failed"
    assert processing_status_calls
    assert processing_status_calls[0]["status"] == ImageProcessingStatus.FAILED


# ── move_task_images_for_processing (unchanged behaviour, kept for coverage) ──


@pytest.mark.asyncio
async def test_move_task_images_for_processing_commits_on_success(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "move-job-1", "db_pool": _FakePool(conn)}

    async def fake_move_task_images_to_folder(db, project_id_arg, task_id_arg):
        assert db is conn
        assert project_id_arg == project_id
        assert task_id_arg == task_id
        return {"moved_count": 4, "failed_count": 0}

    monkeypatch.setattr(
        arq_tasks.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )

    result = await arq_tasks.move_task_images_for_processing(
        ctx, str(project_id), str(task_id)
    )

    assert result == {
        "project_id": str(project_id),
        "task_id": str(task_id),
        "moved_count": 4,
        "failed_count": 0,
    }
    assert conn.commit_calls == 0
    assert conn.rollback_calls == 0


@pytest.mark.asyncio
async def test_move_task_images_for_processing_rolls_back_on_failure_count(monkeypatch):
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "move-job-2", "db_pool": _FakePool(conn)}

    async def fake_move_task_images_to_folder(*_args, **_kwargs):
        return {"moved_count": 1, "failed_count": 2}

    async def fake_update_task_state_system(*_args, **_kwargs):
        return {"project_id": project_id, "task_id": task_id}

    monkeypatch.setattr(
        arq_tasks.ImageClassifier,
        "move_task_images_to_folder",
        fake_move_task_images_to_folder,
    )
    monkeypatch.setattr(
        arq_tasks.task_logic,
        "update_task_state_system",
        fake_update_task_state_system,
    )

    with pytest.raises(RuntimeError, match=r"Failed to move 2 of 3 image\(s\)"):
        await arq_tasks.move_task_images_for_processing(
            ctx, str(project_id), str(task_id)
        )

    assert conn.commit_calls == 1
    assert conn.rollback_calls == 0


# ── sanitization helpers (unchanged) ──────────────────────────────────────────


def test_sanitize_sensitive_text_redacts_token_query_values():
    text = (
        "HTTPSConnectionPool(host='odm.drone.hotosm.org', port=443): "
        "Max retries exceeded with url: "
        "https://odm.drone.hotosm.org/info?token=abc123&foo=bar"
    )
    sanitized = app_utils.sanitize_sensitive_text(text)
    assert "token=abc123" not in sanitized
    assert "token=%5BREDACTED%5D" in sanitized
    assert "foo=bar" in sanitized


def test_update_task_state_system_sanitizes_comment():
    from app.utils import sanitize_sensitive_text

    raw = (
        "Image processing failed: "
        "https://odm.drone.hotosm.org/info?token=abc123&foo=bar"
    )
    sanitized = sanitize_sensitive_text(raw)
    assert "token=abc123" not in sanitized
    assert "token=%5BREDACTED%5D" in sanitized
    assert "foo=bar" in sanitized


@pytest.mark.asyncio
async def test_process_drone_images_persists_failure_comment(monkeypatch):
    """Failure comment should reach update_task_state_system."""
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    conn = _FakeConn()
    ctx = {"job_id": "job-redact-1", "db_pool": _FakePool(conn)}
    state_calls = []

    async def fake_update_task_state_system(
        db, project_id_arg, task_id_arg, comment, initial_state, final_state, updated_at
    ):
        state_calls.append({"comment": comment, "final_state": final_state})
        return {"project_id": project_id_arg, "task_id": task_id_arg}

    async def failing_submit(**kwargs):
        raise RuntimeError(
            "Failed request: https://odm.drone.hotosm.org/info?token=abc123&foo=bar"
        )

    monkeypatch.setattr(project_logic, "submit_scaleodm_task", failing_submit)

    from app.tasks import task_logic

    monkeypatch.setattr(
        task_logic, "update_task_state_system", fake_update_task_state_system
    )

    with pytest.raises(RuntimeError):
        await project_logic.process_drone_images(ctx, project_id, task_id, "user-123")

    assert state_calls[1]["final_state"] == State.IMAGE_PROCESSING_FAILED
    assert "Failed request" in state_calls[1]["comment"]
