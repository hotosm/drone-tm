from app.models.enums import HTTPStatus
import pytest


@pytest.mark.asyncio
async def test_create_drone(client, drone_info):
    """Create a new project."""

    response = await client.post("/api/drones/create-drone", json=drone_info)
    assert response.status_code == HTTPStatus.OK

    return response.json()


@pytest.mark.asyncio
async def test_read_drone(client, drone_info):
    """Test retrieving a drone record."""

    response = await client.post("/api/drones/create-drone", json=drone_info)
    assert response.status_code == HTTPStatus.OK
    drone_id = response.json().get("drone_id")
    response = await client.get(f"/api/drones/{drone_id}")
    assert response.status_code == HTTPStatus.OK
    drone_data = response.json()
    assert drone_data.get("model") == drone_info["model"]


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
