import pytest
from fastapi.testclient import TestClient

@pytest.mark.asyncio
async def test_read_drones(client: TestClient):
    """Test the read_drones endpoint."""
    response = client.get("/api/drones/")
    assert response.status_code == 200
    

@pytest.mark.asyncio
async def test_create_drone(client: TestClient):
    """Test the create_drone endpoint."""
    drone_info = {
        "model": "DJI Mavic",
        "manufacturer": "DJI",
        "camera_model": "DJI Camera",
        "sensor_width": 13.2,
        "sensor_height": 8.9,
        "max_battery_health": 0.85,
        "focal_length": 24.0,
        "image_width": 4000,
        "image_height": 3000,
        "max_altitude": 500.0,
        "max_speed": 72.0,
        "weight": 1.5
    }

    response = client.post("/api/drones/create_drone/", json=drone_info)    
    assert response.status_code == 200  # Adjust based on expected status code

if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
