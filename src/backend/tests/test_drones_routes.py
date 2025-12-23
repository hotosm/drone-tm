import pytest

from app.models.enums import HTTPStatus


@pytest.mark.asyncio
async def test_get_drone_altitude_by_country(client):
    """Test getting drone altitude by country."""
    country = "canada"
    response = await client.get(f"/api/drones/drone-altitude/{country}/")
    assert response.status_code == HTTPStatus.OK

    return response.json()


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
