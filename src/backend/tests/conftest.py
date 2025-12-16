from typing import Any, AsyncGenerator

import pytest
import pytest_asyncio
import uuid
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from psycopg import AsyncConnection

from app.config import settings
from app.db.database import get_db
from app.main import get_application
from app.models.enums import UserRole
from app.projects.project_schemas import DbProject, ProjectIn
from app.users.user_deps import login_required, login_dependency
from app.users.user_schemas import AuthUser, DbUser


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
async def auth_user(db) -> AuthUser:
    """Create a test user."""
    db_user = await DbUser.get_or_create_user(
        db,
        AuthUser(
            id="101039844375937810000",
            email="admin@hotosm.org",
            name="admin",
            profile_img="",
            role=UserRole.PROJECT_CREATOR,
            is_superuser = True
        ),
    )
    db_user.is_superuser = True
    return db_user


@pytest_asyncio.fixture(scope="function")
async def project_info():
    """Fixture to create project metadata for testing."""
    unique_name = f"TEST_PROJECT_{uuid.uuid4()}"
    project_metadata = ProjectIn(
        name=unique_name,
        description="",
        outline={
            "type": "FeatureCollection",
            "features": [
                {
                    "id": "d10fbd780ecd3ff7851cb222467616a0",
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "coordinates": [
                            [
                                [-69.49779538720068, 18.629654277305633],
                                [-69.48497355306813, 18.616997544638636],
                                [-69.54053483430786, 18.608390428368665],
                                [-69.5410690773959, 18.614466085056165],
                                [-69.49779538720068, 18.629654277305633],
                            ]
                        ],
                        "type": "Polygon",
                    },
                }
            ],
        },
        no_fly_zones=None,
        gsd_cm_px=1,
        task_split_dimension=400,
        is_terrain_follow=False,
        per_task_instructions="",
        deadline_at=None,
        visibility=0,
        requires_approval_from_manager_for_locking=False,
        requires_approval_from_regulator=False,
        front_overlap=1,
        side_overlap=1,
        final_output=["ORTHOPHOTO_2D"],
    )

    try:
        return project_metadata
    except Exception as e:
        pytest.fail(f"Fixture setup failed with exception: {str(e)}")


@pytest_asyncio.fixture(scope="function")
async def create_test_project(db, auth_user, project_info):
    """Fixture to create a test project and return its project_id."""
    project_id = await DbProject.create(db, project_info, auth_user.id)
    try:
        await db.commit()
    except AttributeError:
        pass
    return str(project_id)


@pytest_asyncio.fixture(scope="function")
async def test_get_project(db, create_test_project):
    """Fixture to create a test project and return its project_id."""
    project_id = create_test_project
    project_info = await DbProject.one(db, project_id)
    return project_info


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
async def client(app: FastAPI, db: AsyncConnection, auth_user: AuthUser):
    """The FastAPI test server."""
    # Override server db connection
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[login_required] = lambda: auth_user
    app.dependency_overrides[login_dependency] = lambda: auth_user
    async with LifespanManager(app) as manager:
        async with AsyncClient(
            transport=ASGITransport(app=manager.app),
            base_url="http://test",
            follow_redirects=True,
        ) as ac:
            yield ac
