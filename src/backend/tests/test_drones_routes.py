from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from app import main
from app.db.enums import HTTPStatus
from pg_nearest_city import Location

ALTITUDE_URL = "/api/drones/drone-altitude/by-location/"
KATHMANDU = {"lon": 85.3, "lat": 27.7}


def _location(country_alpha3="NPL"):
    return Location(
        city="Kathmandu",
        country="NP",
        lat=27.7,
        lon=85.3,
        country_alpha3=country_alpha3,
        country_name="Nepal",
    )


def _geocoder_returning(location):
    geocoder = MagicMock()
    geocoder.__aenter__.return_value.query.return_value = location
    return patch("app.drones.drone_routes.AsyncNearestCity", return_value=geocoder)


@pytest_asyncio.fixture
async def nepal_altitude(db):
    """A flight height row whose name differs from the geocoder's spelling."""
    async with db.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO drone_flight_height
                (country, country_code, max_altitude_ft, max_altitude_m, created_at)
            VALUES ('Federal Republic of Nepal', 'NPL', 400, 120, now())
            """
        )


@pytest.mark.asyncio
async def test_startup_initialises_geocoder(client):
    main.AsyncNearestCity.assert_called_once()


@pytest.mark.asyncio
async def test_drone_altitude_by_location_matches_country_code(client, nepal_altitude):
    with _geocoder_returning(_location()):
        response = await client.get(ALTITUDE_URL, params=KATHMANDU)

    assert response.status_code == HTTPStatus.OK
    assert response.json()["max_altitude_m"] == 120


@pytest.mark.asyncio
async def test_drone_altitude_by_location_no_rule_for_country(client):
    with _geocoder_returning(_location(country_alpha3="XXX")):
        response = await client.get(ALTITUDE_URL, params=KATHMANDU)

    assert response.status_code == HTTPStatus.OK
    assert response.json() == []


@pytest.mark.asyncio
async def test_drone_altitude_by_location_outside_any_country(client):
    with _geocoder_returning(None):
        response = await client.get(ALTITUDE_URL, params={"lon": 0, "lat": 0})

    assert response.status_code == HTTPStatus.OK
    assert response.json() == []


@pytest.mark.asyncio
async def test_drone_altitude_by_location_rejects_invalid_coordinates(client):
    response = await client.get(ALTITUDE_URL, params={"lon": 85.3, "lat": 91})

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
