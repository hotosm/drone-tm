from pydantic import BaseModel


class DroneBase(BaseModel):
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


class DroneIn(DroneBase):
    pass


class DroneOut(DroneBase):
    id: int
