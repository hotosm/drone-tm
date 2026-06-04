import uuid
from datetime import datetime, timezone

from fastapi import BackgroundTasks, HTTPException
import pytest

from app.models.enums import State, UserRole
from app.tasks import task_logic, task_schemas
from app.users.user_schemas import AuthUser


def _auth_user(user_id: str, name: str) -> AuthUser:
    return AuthUser(
        id=user_id,
        email=f"{user_id}@example.com",
        name=name,
        profile_img="",
        role=UserRole.DRONE_PILOT.name,
        is_superuser=False,
    )


async def _unlock_task(
    *,
    user: AuthUser,
    project_author_id: str,
    current_state: State,
    latest_event_user_id: str,
    prior_state: State | None = None,
    prior_user_id: str | None = None,
    monkeypatch,
):
    """Drive handle_event(UNLOCK) with the rest of the stack stubbed.

    The new behavior delegates to ``revert_task_state``, which steps the task
    back one event in history. Tests stub both the state lookup and the
    revert call to capture how each role's request is dispatched without
    needing a database.
    """
    project_id = uuid.uuid4()
    task_id = uuid.uuid4()
    revert_call = {}

    async def fake_get_task_state(_db, _project_id, _task_id):
        return {"state": current_state.name, "user_id": latest_event_user_id}

    async def fake_revert_task_state(
        *,
        db,
        project_id,
        task_id,
        current_state,
        current_user_id,
        actor_name,
        updated_at,
    ):
        revert_call.update(
            {
                "project_id": project_id,
                "task_id": task_id,
                "current_state": current_state,
                "current_user_id": current_user_id,
                "actor_name": actor_name,
                "updated_at": updated_at,
            }
        )
        # Mirror the production resolution: LOCKED always falls back to
        # UNLOCKED; other states use the prior distinct state if provided.
        if current_state == State.LOCKED.name:
            resolved_state = State.UNLOCKED
            resolved_user_id = current_user_id
        elif prior_state is not None:
            resolved_state = prior_state
            resolved_user_id = prior_user_id or current_user_id
        else:
            resolved_state = State.UNLOCKED
            resolved_user_id = current_user_id
        revert_call["resolved_state"] = resolved_state
        revert_call["resolved_user_id"] = resolved_user_id
        return {
            "project_id": project_id,
            "task_id": task_id,
            "state": resolved_state.name,
            "comment": f"Task reverted from {current_state} to {resolved_state.name} by {actor_name}.",
        }

    monkeypatch.setattr(task_logic, "get_task_state", fake_get_task_state)
    monkeypatch.setattr(task_logic, "revert_task_state", fake_revert_task_state)

    project = {"author_id": project_author_id}
    return await task_logic.handle_event(
        None,
        project_id,
        task_id,
        user.id,
        project,
        UserRole[user.role],
        task_schemas.NewEvent(event="unlock", updated_at=datetime.now(timezone.utc)),
        user,
        BackgroundTasks(),
    ), revert_call


@pytest.mark.asyncio
async def test_list_tasks(client):
    """Test listing tasks for the authenticated user."""
    response = await client.get("/api/tasks/")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_task_states(client, create_test_project):
    project_id = create_test_project

    response = await client.get(f"/api/tasks/states/{project_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_project_author_revert_steps_back_from_has_imagery(monkeypatch):
    """Admin reverting HAS_IMAGERY should step back to the prior LOCKED state,
    not jump straight to UNLOCKED. This is the core of the sequential revert
    behavior - a stuck task can be recovered without wiping all progress."""
    author = _auth_user("project-author", "project author")
    pilot_id = "drone-pilot"

    result, revert_call = await _unlock_task(
        user=author,
        project_author_id=author.id,
        current_state=State.HAS_IMAGERY,
        latest_event_user_id=pilot_id,
        prior_state=State.LOCKED,
        prior_user_id=pilot_id,
        monkeypatch=monkeypatch,
    )

    assert result["state"] == State.LOCKED.name
    assert revert_call["actor_name"] == author.name
    assert revert_call["resolved_state"] == State.LOCKED
    # The new event should be attributed to the original pilot so the task
    # is shown as still held by them on the map.
    assert revert_call["resolved_user_id"] == pilot_id


@pytest.mark.asyncio
async def test_locked_task_user_can_unlock_their_task(monkeypatch):
    """A drone pilot releasing their own LOCKED task transitions to UNLOCKED
    (the LOCKED-special-case path in revert_task_state)."""
    drone_pilot = _auth_user("drone-pilot", "drone pilot")

    result, revert_call = await _unlock_task(
        user=drone_pilot,
        project_author_id="project-author",
        current_state=State.LOCKED,
        latest_event_user_id=drone_pilot.id,
        monkeypatch=monkeypatch,
    )

    assert result["state"] == State.UNLOCKED.name
    assert revert_call["resolved_state"] == State.UNLOCKED


@pytest.mark.asyncio
async def test_non_admin_cannot_unlock_task_after_imagery_is_matched(monkeypatch):
    """Once a task has progressed beyond LOCKED, only the project admin may
    revert it - even the original pilot who locked it is blocked."""
    pilot = _auth_user("drone-pilot", "drone pilot")

    with pytest.raises(HTTPException) as exc_info:
        await _unlock_task(
            user=pilot,
            project_author_id="project-author",
            current_state=State.HAS_IMAGERY,
            latest_event_user_id=pilot.id,
            monkeypatch=monkeypatch,
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_non_admin_cannot_unlock_task_locked_by_another_user(monkeypatch):
    """A drone pilot cannot release a LOCKED task that belongs to a different
    pilot - only the locker or the admin can act on it."""
    other_pilot = _auth_user("other-pilot", "other pilot")

    with pytest.raises(HTTPException) as exc_info:
        await _unlock_task(
            user=other_pilot,
            project_author_id="project-author",
            current_state=State.LOCKED,
            latest_event_user_id="original-pilot",
            monkeypatch=monkeypatch,
        )

    assert exc_info.value.status_code == 403


def _evt(state: State, user_id: str = "pilot", comment: str | None = None) -> dict:
    return {"state": state.name, "user_id": user_id, "comment": comment}


def _revert_evt(from_state: State, to_state: State, user_id: str = "pilot") -> dict:
    return {
        "state": to_state.name,
        "user_id": user_id,
        "comment": f"Task reverted from {from_state.name} to {to_state.name} by admin.",
    }


def test_resolve_revert_target_basic_step_back():
    """No prior reverts: step back to the most recent distinct state."""
    events = [
        _evt(State.HAS_IMAGERY),
        _evt(State.FULLY_FLOWN),
        _evt(State.LOCKED),
    ]
    assert task_logic._resolve_revert_target(events, State.HAS_IMAGERY.name) == (
        State.FULLY_FLOWN.name,
        "pilot",
    )


def test_resolve_revert_target_after_one_revert_steps_further_back():
    """The core bug: after a revert HAS_IMAGERY -> FULLY_FLOWN, a second revert
    must land on LOCKED, not bounce back to HAS_IMAGERY."""
    events = [
        _revert_evt(State.HAS_IMAGERY, State.FULLY_FLOWN),
        _evt(State.HAS_IMAGERY),
        _evt(State.FULLY_FLOWN),
        _evt(State.LOCKED),
    ]
    assert task_logic._resolve_revert_target(events, State.FULLY_FLOWN.name) == (
        State.LOCKED.name,
        "pilot",
    )


def test_resolve_revert_target_cycles_back_to_unlocked():
    """After enough reverts the helper returns None so the caller falls back
    to UNLOCKED - a stuck task can be walked the whole way back."""
    events = [
        _revert_evt(State.FULLY_FLOWN, State.LOCKED),
        _revert_evt(State.HAS_IMAGERY, State.FULLY_FLOWN),
        _evt(State.HAS_IMAGERY),
        _evt(State.FULLY_FLOWN),
        _evt(State.LOCKED),
    ]
    # current state is LOCKED here, but _resolve_revert_target itself is
    # called only from the non-LOCKED branch in production; we exercise it
    # directly with a hypothetical multi-step backbone to confirm the skip
    # accounting bottoms out cleanly.
    assert task_logic._resolve_revert_target(events, State.LOCKED.name) is None


def test_resolve_revert_target_ignores_intermediate_comments():
    """Comment events preserve the current state; they must not be picked as
    the revert target nor counted as transitions."""
    events = [
        _evt(State.FULLY_FLOWN, comment="looks good"),
        _evt(State.FULLY_FLOWN, comment="checking"),
        _evt(State.LOCKED),
    ]
    assert task_logic._resolve_revert_target(events, State.FULLY_FLOWN.name) == (
        State.LOCKED.name,
        "pilot",
    )


def test_resolve_revert_target_does_not_treat_manual_override_as_revert():
    """A manual override writes a comment that begins with 'Task state
    manually overridden ...'. The revert detector must not match it,
    otherwise an override would silently shift the cycle-back skip count."""
    override_comment = (
        "Task state manually overridden from HAS_IMAGERY to LOCKED by admin."
    )
    events = [
        _evt(State.LOCKED, comment=override_comment),
        _evt(State.HAS_IMAGERY),
        _evt(State.FULLY_FLOWN),
    ]
    # Current state LOCKED would normally hit the LOCKED special case in
    # production; here we drive the helper directly to confirm the override
    # comment is treated as a normal transition (most recent prior distinct
    # state is HAS_IMAGERY).
    assert task_logic._resolve_revert_target(events, State.LOCKED.name) == (
        State.HAS_IMAGERY.name,
        "pilot",
    )


def test_resolve_revert_target_treats_legacy_unmark_flown_comment_as_transition():
    """Historical UNMARK_FLOWN events wrote a prose comment ('Task reverted
    from fully flown back to locked') that does not match the machine-
    formatted revert regex. They must continue to be treated as normal
    transitions so prior step-back chains over old data still resolve
    sensibly. Newer UNMARK_FLOWN events use revert_task_state and write the
    machine-formatted comment, which IS treated as a revert."""
    events = [
        _evt(
            State.LOCKED,
            comment="Task reverted from fully flown back to locked",
        ),
        _evt(State.FULLY_FLOWN),
    ]
    assert task_logic._resolve_revert_target(events, State.LOCKED.name) == (
        State.FULLY_FLOWN.name,
        "pilot",
    )


def test_resolve_revert_target_preserves_user_id_of_prior_event():
    """The revert should attribute the new event to the user who held the
    task at the prior state, not the actor performing the revert."""
    events = [
        _evt(State.HAS_IMAGERY, user_id="pilot-2"),
        _evt(State.FULLY_FLOWN, user_id="pilot-1"),
        _evt(State.LOCKED, user_id="pilot-1"),
    ]
    assert task_logic._resolve_revert_target(events, State.HAS_IMAGERY.name) == (
        State.FULLY_FLOWN.name,
        "pilot-1",
    )


@pytest.mark.asyncio
async def test_unlock_already_unlocked_task_raises(monkeypatch):
    """Unlocking a task that is already in UNLOCKED state should be a clean
    400 rather than a silently-successful no-op."""
    author = _auth_user("project-author", "project author")

    with pytest.raises(HTTPException) as exc_info:
        await _unlock_task(
            user=author,
            project_author_id=author.id,
            current_state=State.UNLOCKED,
            latest_event_user_id=author.id,
            monkeypatch=monkeypatch,
        )

    assert exc_info.value.status_code == 400
