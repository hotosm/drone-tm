import pytest
from fastapi import HTTPException

from app.users import user_deps


@pytest.mark.asyncio
async def test_verify_access_token_expected_failure_logs_debug(monkeypatch):
    def _raise_http_exception(_token):
        raise HTTPException(status_code=401, detail="Token has expired")

    debug_messages = []
    error_messages = []

    def _capture_debug(message):
        debug_messages.append(message)

    def _capture_error(message):
        error_messages.append(message)

    monkeypatch.setattr(user_deps, "verify_token", _raise_http_exception)
    monkeypatch.setattr(user_deps.log, "debug", _capture_debug)
    monkeypatch.setattr(user_deps.log, "error", _capture_error)

    with pytest.raises(HTTPException) as exc:
        await user_deps.verify_access_token("invalid-token")

    assert exc.value.status_code == 401
    assert exc.value.detail == "Access token not valid"
    assert any(
        "Expected access token verification failure" in msg for msg in debug_messages
    )
    assert error_messages == []


@pytest.mark.asyncio
async def test_verify_access_token_unexpected_failure_logs_error(monkeypatch):
    def _raise_runtime_error(_token):
        raise RuntimeError("verifier backend unavailable")

    error_messages = []

    def _capture_error(message):
        error_messages.append(message)

    monkeypatch.setattr(user_deps, "verify_token", _raise_runtime_error)
    monkeypatch.setattr(user_deps.log, "error", _capture_error)

    with pytest.raises(HTTPException) as exc:
        await user_deps.verify_access_token("any-token")

    assert exc.value.status_code == 401
    assert exc.value.detail == "Access token not valid"
    assert any(
        "Unexpected error while verifying access token" in msg for msg in error_messages
    )
