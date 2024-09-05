from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from app.main import get_application
from app.db.database import get_db
from typing import AsyncGenerator, Any
from fastapi import FastAPI
from app.drones import drone_schemas

@pytest.fixture(autouse=True)
async def app() -> AsyncGenerator[FastAPI, Any]:
    """Get the FastAPI test server."""
    application = await get_application()
    yield application

@pytest.fixture(scope="function")
def client(app: FastAPI, db):
    """The FastAPI test server."""
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c

# Mock user data (for authenticated routes)
@pytest.fixture
def mock_user():
    return {"id": 1, "username": "testuser", "role": "admin"}

### Test the GET all drones endpoint
@pytest.mark.asyncio
async def test_read_drones(client: TestClient):
    # Mock the response of DbDrone.all
    drone_schemas.DbDrone.all = AsyncMock(return_value=[{"id": 1, "name": "Test Drone"}])
    
    response = client.get("/drones/")
    assert response.status_code == 200
    assert response.json() == [{"id": 1, "name": "Test Drone"}]
    drone_schemas.DbDrone.all.assert_awaited_once()

### Test the POST create_drone endpoint
@pytest.mark.asyncio
async def test_create_drone(client: TestClient, mock_user):
    # Mock the response of DbDrone.create
    drone_schemas.DbDrone.create = AsyncMock(return_value=1)
    
    payload = {"name": "New Drone", "type": "Quadcopter"}
    
    response = client.post("/drones/create_drone", json=payload)
    assert response.status_code == 200
    assert response.json() == {"message": "Drone created successfully", "drone_id": 1}
    drone_schemas.DbDrone.create.assert_awaited_once_with(payload)

### Test the DELETE drone endpoint
@pytest.mark.asyncio
async def test_delete_drone(client: TestClient, mock_user):
    # Mock the response of DbDrone.delete
    drone_schemas.DbDrone.delete = AsyncMock(return_value=1)
    
    response = client.delete("/drones/1")
    assert response.status_code == 200
    assert response.json() == {"message": "Drone successfully deleted 1"}
    drone_schemas.DbDrone.delete.assert_awaited_once_with(1)

### Test the GET drone by ID endpoint
@pytest.mark.asyncio
async def test_read_drone(client: TestClient, mock_user):
    # Mock the response of DbDrone.get
    drone_schemas.DbDrone.get = AsyncMock(return_value={"id": 1, "name": "Test Drone"})
    
    response = client.get("/drones/1")
    assert response.status_code == 200
    assert response.json() == {"id": 1, "name": "Test Drone"}

if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
