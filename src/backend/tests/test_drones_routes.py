from app.models.enums import HTTPStatus
import pytest


@pytest.mark.asyncio
async def test_create_drone(client, drone_info):
    """Create a new project."""

    response = await client.post("/api/drones/create-drone", json=drone_info)
    assert response.status_code == HTTPStatus.OK

    return response.json()


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
