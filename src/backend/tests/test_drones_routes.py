from http import HTTPStatus
import pytest
import pytest_asyncio

        
@pytest_asyncio.fixture(scope="function")
async def drone_info():
    """Test the create_drone endpoint."""
    drone_info = {
        "model": "DJI Mavic-1123",
        "manufacturer": "DJI",
        "camera_model": "DJI Camera",
        "sensor_width": 13.2,
        "sensor_height": 8.9,
        "max_battery_health": 0.85,
        "focal_length": 24.0,
        "image_width": 400,
        "image_height": 300,
        "max_altitude": 500.0,
        "max_speed": 72.0,
        "weight": 1.5
    }

    return drone_info

@pytest.mark.asyncio
async def test_create_drone(client, drone_info):
    """Create a new project."""
 
    response = await client.post("/api/drones/create-drone", json=drone_info)  
    assert response.status_code == HTTPStatus.OK

    return response.json()

if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
