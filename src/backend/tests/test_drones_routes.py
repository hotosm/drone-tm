import pytest

from app.models.enums import HTTPStatus


@pytest.mark.asyncio
async def test_get_drone_altitude_by_country(client, drone_info):
    """Create a new project."""
    country = 'canada'
    response = await client.post(f"/api/drone-altitude/${country}", json=drone_info)
    assert response.status_code == HTTPStatus.OK

    return response.json()

if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
