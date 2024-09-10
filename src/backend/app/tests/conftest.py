from psycopg import AsyncConnection
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI
from typing import AsyncGenerator, Generator
from app.main import get_application, get_db_connection_pool
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from psycopg_pool import AsyncConnectionPool


def mock_login_required(request, access_token=None):
    return AuthUser(
        id="6da91a51-5efd-40c9-a9c4-b66465a75fbe",
        email="admin@hotosm.org",
        name="admin",
        profile_img="",
    )


@pytest.fixture(scope="session")
async def db_pool() -> AsyncGenerator[AsyncConnectionPool, None]:
    """Fixture for the database connection pool."""
    pool = await get_db_connection_pool()
    yield pool
    await pool.close()


@pytest.fixture(scope="function")
async def db(db_pool: AsyncConnectionPool) -> AsyncGenerator[AsyncConnection, None]:
    """Fixture for a database connection."""
    async with db_pool.connection() as conn:
        yield conn


@pytest.fixture(scope="session")
def app() -> FastAPI:
    """Fixture for the FastAPI application."""
    application = get_application()
    return application


@pytest.fixture(scope="function")
def client(app: FastAPI, db: AsyncConnection) -> Generator[TestClient, None, None]:
    """Fixture for the FastAPI test client."""
    # Override the `get_db` dependency with the test connection
    # app.dependency_overrides[database.get_db] = lambda: db

    # Override the authentication dependency if needed
    app.dependency_overrides[login_required] = mock_login_required

    with TestClient(app) as c:
        yield c
