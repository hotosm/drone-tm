from pydantic import BaseModel


class DroneIn(BaseModel):
    model: str
    manufacturer: str
    camera_model: str
    sensor_width: float
    sensor_height: float
    max_battery_health: float
    focal_length: float
    image_width: int
    image_height: int
    max_altitude: float
    max_speed: float
    weight: float


class DroneOut(BaseModel):
    id: int
    model: str
