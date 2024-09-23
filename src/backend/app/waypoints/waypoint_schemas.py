import json
from pydantic import BaseModel, model_validator


class PointField(BaseModel):
    longitude: float
    latitude: float

    @model_validator(mode="before")
    @classmethod
    def validate_to_json(cls, value):
        if isinstance(value, str):
            return cls(**json.loads(value))
        return value
