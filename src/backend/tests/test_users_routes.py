import pytest
from app.config import settings
import jwt
import pytest_asyncio
from datetime import datetime, timedelta
from loguru import logger as log


@pytest_asyncio.fixture(scope="function")
def token(user):
    """
    Create a reset password token for a given user.
    """
    payload = {
        "sub": user.email_address,
        "exp": datetime.utcnow() + timedelta(minutes=settings.RESET_PASSWORD_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


@pytest.mark.asyncio
async def test_reset_password_success(client, token):
    """
    Test successful password reset using a valid token.
    """
    new_password = "QPassword@12334"
    
    response = await client.post(
        f"/api/users/reset-password?token={token}&new_password={new_password}"
    )

    if response.status_code != 200:
        log.debug("Response:", response.status_code, response.json())

    assert response.status_code == 200
    

