from typing import AsyncGenerator, Any
from app.db.database import get_db
from app.users.user_deps import login_required
from fastapi import FastAPI
from app.main import get_application
from app.users.user_schemas import AuthUser
import pytest_asyncio
from app.config import settings
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from psycopg import AsyncConnection

@pytest_asyncio.fixture(scope="function")
def get_current_user_override():
    return AuthUser(
        id="6da91a51-5efd-40c9-a9c4-b66465a75fbe",
        email="admin@hotosm.org",
        name="admin",
        profile_img="",
        role=None
    )

@pytest_asyncio.fixture(autouse=True)
async def app() -> AsyncGenerator[FastAPI, Any]:
    """Get the FastAPI test server."""
    yield get_application()


@pytest_asyncio.fixture(scope="function")
def drone_info():
    """Test drone information."""
    return {
        "model": "DJI Mavic-12344",
        "manufacturer": "DJI",
        "camera_model": "DJI Camera 1",
        "sensor_width": 13.2,
        "sensor_height": 8.9,
        "max_battery_health": 0.85,
        "focal_length": 24.0,
        "image_width": 400,
        "image_height": 300,
        "max_altitude": 500.0,
        "max_speed": 72.0,
        "weight": 1.5,
    }


@pytest_asyncio.fixture(scope="function")
async def db() -> AsyncConnection:
    """The psycopg async database connection using psycopg3."""
    db_conn = await AsyncConnection.connect(
        conninfo=settings.DTM_DB_URL.unicode_string(),
    )
    try:
        yield db_conn
    finally:
        await db_conn.close()


@pytest_asyncio.fixture(scope="function")
async def client(app: FastAPI, db: AsyncConnection):
    """The FastAPI test server."""
    # Override server db connection
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[login_required] = lambda: get_current_user_override

    async with LifespanManager(app) as manager:
        async with AsyncClient(
            transport=ASGITransport(app=manager.app),
            base_url="http://test",
            follow_redirects=True,
        ) as ac:
            yield ac
