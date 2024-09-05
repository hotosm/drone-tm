import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock
from app.main import get_application
from app.drones import drone_schemas
from typing import Any, Generator
from fastapi import FastAPI

@pytest.fixture(autouse=True)
def app() -> Generator[FastAPI, Any, None]:
    """Get the FastAPI test server."""
    yield get_application()

client = TestClient(app)

# Mock database connection
@pytest.fixture
def mock_db():
    mock_connection = AsyncMock()
    return mock_connection

# Mock user data (for authenticated routes)
@pytest.fixture
def mock_user():
    return {"id": 1, "username": "testuser", "role": "admin"}

### Test the GET all drones endpoint
@pytest.mark.asyncio
async def test_read_drones(mock_db):
    # Mock the response of DbDrone.all
    drone_schemas.DbDrone.all = AsyncMock(return_value=[{"id": 1, "name": "Test Drone"}])
    
    response = client.get("/drones/")
    assert response.status_code == 200
    assert response.json() == [{"id": 1, "name": "Test Drone"}]
    drone_schemas.DbDrone.all.assert_awaited_once_with(mock_db)

### Test the POST create_drone endpoint
@pytest.mark.asyncio
async def test_create_drone(mock_db, mock_user):
    # Mock the response of DbDrone.create
    drone_schemas.DbDrone.create = AsyncMock(return_value=1)
    
    payload = {"name": "New Drone", "type": "Quadcopter"}
    
    response = client.post("/drones/create_drone", json=payload)
    assert response.status_code == 200
    assert response.json() == {"message": "Drone created successfully", "drone_id": 1}
    drone_schemas.DbDrone.create.assert_awaited_once_with(mock_db, payload)

### Test the DELETE drone endpoint
@pytest.mark.asyncio
async def test_delete_drone(mock_db, mock_user):
    # Mock the response of DbDrone.delete
    drone_schemas.DbDrone.delete = AsyncMock(return_value=1)
    
    response = client.delete("/drones/1")
    assert response.status_code == 200
    assert response.json() == {"message": "Drone successfully deleted 1"}
    drone_schemas.DbDrone.delete.assert_awaited_once_with(mock_db, 1)

### Test the GET drone by ID endpoint
@pytest.mark.asyncio
async def test_read_drone(mock_db, mock_user):
    # Mock the response of get_drone_by_id and DbDrone retrieval
    drone_schemas.DbDrone.get = AsyncMock(return_value={"id": 1, "name": "Test Drone"})
    
    response = client.get("/drones/1")
    assert response.status_code == 200
    assert response.json() == {"id": 1, "name": "Test Drone"}

if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
