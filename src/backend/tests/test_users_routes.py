import pytest
from loguru import logger as log

from app.users.user_deps import create_reset_password_token


@pytest.mark.asyncio
async def test_my_info(client):
    """Test the /my-info/ endpoint to ensure a logged-in user can fetch their data."""
    response = await client.get("/api/users/my-info/")
    assert response.status_code == 200
    user_info = response.json()

    assert user_info["email_address"] == "admin@hotosm.org"


@pytest.mark.asyncio
async def test_refresh_token(client):
    """Test the /refresh-token endpoint to ensure a new access token can be obtained."""
    response = await client.get("/api/users/refresh-token")
    assert response.status_code == 200
    token_data = response.json()
    assert "access_token" in token_data
    assert "refresh_token" in token_data


@pytest.mark.asyncio
async def test_reset_password_success(client, auth_user):
    """Test successful password reset using a valid token."""
    token = create_reset_password_token(auth_user.email)
    new_password = "QPassword@12334"

    response = await client.post(
        f"/users/reset-password/?token={token}&new_password={new_password}"
    )

    if response.status_code != 200:
        log.debug("Response:", response.status_code, response.json())

    assert response.status_code == 200
