"""Critical-path tests for the cloudnative conversion workflow.

Covers the contract that the trigger endpoints + ARQ workers maintain:

* Worker ``_set_ready_flag`` SQL must include the SUCCESS gate so a stale
  conversion finishing mid-reprocess can't lie to the UI.
* Worker happy path sets ready + clears generating; both flags clear on
  every exit path (including exceptions and "skipped" returns).
* 3D worker clears ``cloud_mesh_ready`` *before* the destructive
  delete-then-upload so a failed regen lands the UI on "Convert", not on
  "View" pointing at an empty prefix.
* Trigger endpoints reject the bad preconditions (status, missing 3D
  request) before any state mutation.
* Trigger endpoints check ``enqueue_job``'s return value: if ARQ refuses
  (None, e.g. cached result key) the generating flag is *not* set, so the
  UI doesn't get stuck on "Converting" with no worker behind it.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.arq import cloudnative
from app.projects import project_routes

from tests.test_project_processing import _FakeConn, _FakePool


# ── helpers ──────────────────────────────────────────────────────────────────


class _RecordingConn(_FakeConn):
    """_FakeConn + a helper to find executed UPDATEs by substring."""

    def updates_matching(self, *substrings: str) -> list[dict]:
        return [
            entry
            for entry in self.executed
            if all(s in entry["query"] for s in substrings)
        ]


class _FakeRedis:
    """Minimal stand-in for ArqRedis.enqueue_job."""

    def __init__(self, *, enqueue_returns: object = SimpleNamespace(job_id="fake")):
        self.calls: list[dict] = []
        self._returns = enqueue_returns

    async def enqueue_job(self, function, **kwargs):
        self.calls.append({"function": function, "kwargs": kwargs})
        return self._returns


def _fake_project(
    *,
    image_processing_status: str = "SUCCESS",
    cloud_ortho_ready: bool = False,
    cloud_ortho_generating: bool = False,
    cloud_mesh_ready: bool = False,
    cloud_mesh_generating: bool = False,
    final_output: list | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        image_processing_status=image_processing_status,
        cloud_ortho_ready=cloud_ortho_ready,
        cloud_ortho_generating=cloud_ortho_generating,
        cloud_mesh_ready=cloud_mesh_ready,
        cloud_mesh_generating=cloud_mesh_generating,
        final_output=final_output if final_output is not None else [],
    )


def _stub_ready_flag(monkeypatch, *, value: bool) -> None:
    async def _fake(_pool, _pid, _col):
        return value

    monkeypatch.setattr(cloudnative, "_get_ready_flag", _fake)


# ── worker: SUCCESS-gated set_ready ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_ready_flag_sql_requires_status_success():
    """The set_ready UPDATE must AND on status=SUCCESS so a stale conversion
    job finishing during a reprocess can't flip the UI to "View" while ODM
    is still PROCESSING."""
    conn = _RecordingConn()
    pool = _FakePool(conn)

    await cloudnative._set_ready_flag(pool, uuid.uuid4(), "cloud_ortho_ready")

    matches = conn.updates_matching(
        "UPDATE projects",
        "cloud_ortho_ready",
        "image_processing_status = 'SUCCESS'",
    )
    assert matches, (
        "set_ready UPDATE must gate on image_processing_status='SUCCESS' "
        f"but the executed queries were: {conn.executed!r}"
    )


# ── worker: happy path + finally semantics ───────────────────────────────────


@pytest.mark.asyncio
async def test_generate_orthophoto_cog_happy_path(monkeypatch):
    """Successful conversion sets cloud_ortho_ready and clears
    cloud_ortho_generating in the finally block."""
    conn = _RecordingConn()
    ctx = {"db_pool": _FakePool(conn)}

    _stub_ready_flag(monkeypatch, value=False)
    monkeypatch.setattr(cloudnative, "s3_object_exists", lambda *a, **k: True)
    monkeypatch.setattr(cloudnative, "get_file_from_bucket", lambda *a, **k: None)
    monkeypatch.setattr(cloudnative, "_generate_cog", lambda *a, **k: None)
    monkeypatch.setattr(cloudnative, "add_file_to_bucket", lambda *a, **k: None)

    result = await cloudnative.generate_orthophoto_cog(
        ctx, project_id=str(uuid.uuid4())
    )

    assert result["status"] == "completed"
    assert conn.updates_matching("UPDATE projects", "cloud_ortho_ready"), (
        "happy path should set cloud_ortho_ready"
    )
    assert conn.updates_matching("UPDATE projects", "cloud_ortho_generating"), (
        "happy path should clear cloud_ortho_generating in finally"
    )


@pytest.mark.asyncio
async def test_generate_orthophoto_cog_clears_generating_on_exception(monkeypatch):
    """Even when the conversion raises, the finally clears the generating
    flag so the UI doesn't get stuck on "Converting"."""
    conn = _RecordingConn()
    ctx = {"db_pool": _FakePool(conn)}

    _stub_ready_flag(monkeypatch, value=False)
    monkeypatch.setattr(cloudnative, "s3_object_exists", lambda *a, **k: True)
    monkeypatch.setattr(cloudnative, "get_file_from_bucket", lambda *a, **k: None)

    def boom(*_a, **_k):
        raise RuntimeError("rio_cogeo blew up")

    monkeypatch.setattr(cloudnative, "_generate_cog", boom)

    with pytest.raises(RuntimeError):
        await cloudnative.generate_orthophoto_cog(ctx, project_id=str(uuid.uuid4()))

    assert conn.updates_matching("UPDATE projects", "cloud_ortho_generating"), (
        "generating must be cleared in finally even on exception"
    )
    assert not conn.updates_matching("UPDATE projects", "cloud_ortho_ready"), (
        "ready must NOT be set when the job raised"
    )


@pytest.mark.asyncio
async def test_generate_orthophoto_cog_already_ready_clears_generating(monkeypatch):
    """When ready is already true (force=False default), the job short-
    circuits but still clears generating - covers the case where a user
    triggers Convert twice and the second job runs after the first set
    ready=true."""
    conn = _RecordingConn()
    ctx = {"db_pool": _FakePool(conn)}

    _stub_ready_flag(monkeypatch, value=True)

    result = await cloudnative.generate_orthophoto_cog(
        ctx, project_id=str(uuid.uuid4())
    )

    assert result == {"status": "skipped", "reason": "already_ready"}
    assert conn.updates_matching("UPDATE projects", "cloud_ortho_generating"), (
        "early-return path must still clear generating in finally"
    )


# ── 3D worker: ready cleared before destructive delete ───────────────────────


@pytest.mark.asyncio
async def test_generate_3d_tiles_clears_ready_before_delete(monkeypatch):
    """The 3D worker must mark cloud_mesh_ready=false *before* the
    destructive delete-then-upload. Otherwise a failed regen leaves the UI
    pointing at an empty tile prefix."""
    delete_calls: list[str] = []
    operation_log: list[str] = []  # ordered record of state mutations

    _stub_ready_flag(monkeypatch, value=False)
    monkeypatch.setattr(cloudnative, "s3_object_exists", lambda *a, **k: True)

    def fake_get_file(_bucket, _key, dst):
        # Worker reads reference_lla.json from disk after this. Stub minimal JSON.
        from pathlib import Path

        Path(dst).write_text('{"latitude": 0, "longitude": 0, "altitude": 0}')

    monkeypatch.setattr(cloudnative, "get_file_from_bucket", fake_get_file)
    monkeypatch.setattr(
        cloudnative,
        "_download_prefix_to_dir",
        lambda _prefix, local_dir: _seed_texturing_dir(local_dir),
    )
    monkeypatch.setattr(cloudnative, "_run_obj2tiles", lambda *a, **k: None)

    def fake_delete(_bucket, prefix):
        delete_calls.append(prefix)
        operation_log.append("delete")

    monkeypatch.setattr(cloudnative, "delete_objects_by_prefix", fake_delete)

    # Raise on upload so we can observe ordering before set_ready runs.
    def boom(*_a, **_k):
        raise RuntimeError("upload failed")

    monkeypatch.setattr(cloudnative, "_upload_tree_to_prefix", boom)

    # Tag execute() calls with the column they affect, so we can assert order.
    original_execute = _RecordingConn.execute

    async def tagged_execute(self, query, params=None):
        if "cloud_mesh_ready = false" in query:
            operation_log.append("clear_ready")
        await original_execute(self, query, params)

    monkeypatch.setattr(_RecordingConn, "execute", tagged_execute)

    conn = _RecordingConn()
    ctx = {"db_pool": _FakePool(conn)}

    with pytest.raises(RuntimeError):
        await cloudnative.generate_3d_tiles(ctx, project_id=str(uuid.uuid4()))

    assert delete_calls, "expected delete_objects_by_prefix to run"
    assert "clear_ready" in operation_log, (
        "cloud_mesh_ready must be cleared via UPDATE before the destructive delete"
    )
    assert operation_log.index("clear_ready") < operation_log.index("delete"), (
        f"clear_ready must come before delete; observed order: {operation_log}"
    )
    assert not conn.updates_matching("UPDATE projects", "cloud_mesh_ready = true"), (
        "ready must not be set when upload raised"
    )


# ── trigger endpoints ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_trigger_orthophoto_409_when_not_success():
    """Conversion is meaningless if ODM hasn't completed."""
    project = _fake_project(image_processing_status="PROCESSING")
    db = _RecordingConn()
    redis = _FakeRedis()

    with pytest.raises(HTTPException) as exc:
        await project_routes.trigger_orthophoto_conversion(
            db=db, project=project, redis_pool=redis
        )

    assert exc.value.status_code == 409
    assert redis.calls == [], "no enqueue should happen on a precondition failure"
    assert not db.executed, "no DB mutation should happen on a precondition failure"


@pytest.mark.asyncio
async def test_trigger_orthophoto_already_generating_short_circuits():
    """Second click while a worker is already running is a no-op."""
    project = _fake_project(cloud_ortho_generating=True)
    db = _RecordingConn()
    redis = _FakeRedis()

    result = await project_routes.trigger_orthophoto_conversion(
        db=db, project=project, redis_pool=redis
    )

    assert result == {"status": "already_generating"}
    assert redis.calls == []
    assert not db.executed


@pytest.mark.asyncio
async def test_trigger_orthophoto_enqueue_none_rolls_back_flag():
    """ARQ returns None when the deterministic job id has a stale result
    key or is already queued. The endpoint sets the generating flag
    *before* enqueueing (so a fast worker can't clear an unset flag); if
    enqueue fails or refuses, the endpoint must roll the flag back so the
    UI doesn't poll forever for a worker that isn't running."""
    project = _fake_project()
    db = _RecordingConn()
    redis = _FakeRedis(enqueue_returns=None)

    result = await project_routes.trigger_orthophoto_conversion(
        db=db, project=project, redis_pool=redis
    )

    assert result == {"status": "already_generating"}
    assert len(redis.calls) == 1, "enqueue was attempted"
    set_calls = [
        e for e in db.executed if "cloud_ortho_generating = true" in e["query"]
    ]
    clear_calls = [
        e for e in db.executed if "cloud_ortho_generating = false" in e["query"]
    ]
    assert len(set_calls) == 1 and len(clear_calls) == 1, (
        "every set-true on the None path must be followed by a clear-false; "
        f"observed: {db.executed!r}"
    )
    # And ordering: set must come before clear.
    set_idx = next(i for i, e in enumerate(db.executed) if "= true" in e["query"])
    clear_idx = next(i for i, e in enumerate(db.executed) if "= false" in e["query"])
    assert set_idx < clear_idx


# ── tiny async helpers ───────────────────────────────────────────────────────


def _seed_texturing_dir(local_dir):
    """Stub _download_prefix_to_dir: create the OBJ file the worker looks for
    so it doesn't bail with obj_missing before we reach the delete step."""
    local_dir.mkdir(parents=True, exist_ok=True)
    (local_dir / cloudnative._OBJ_FILE_NAME).write_text("# stub OBJ")
    return 1
