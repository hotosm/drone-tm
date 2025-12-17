from datetime import datetime, timedelta

import jwt
import pytest
import pytest_asyncio
from loguru import logger as log

from app.config import settings
from app.users.user_deps import create_reset_password_token


@pytest_asyncio.fixture(scope="function")
def token(auth_user):
    """Create a reset password token for a given user."""
    payload = {
        "sub": auth_user.email_address,
        "exp": datetime.utcnow()
        + timedelta(minutes=settings.RESET_PASSWORD_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


@pytest.mark.asyncio
async def test_reset_password_success(client, auth_user):
    """Test successful password reset using a valid token."""
    token = create_reset_password_token(auth_user.email_address)
    new_password = "QPassword@12334"

    response = await client.post(
        f"/users/reset-password/?token={token}&new_password={new_password}"
    )

    if response.status_code != 200:
        log.debug("Response:", response.status_code, response.json())

    assert response.status_code == 200
