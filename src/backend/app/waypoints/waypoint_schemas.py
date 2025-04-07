import json
from typing import List, Optional

from geojson_pydantic import Feature, FeatureCollection, Point
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


class Properties(BaseModel):
    altitude: float
    gimbal_angle: str
    heading: float
    index: int
    speed: float
    take_photo: bool
    elevation: Optional[float] = None


class Geometry(Point):
    pass


class Feature(Feature):
    geometry: Geometry
    properties: Properties


class CRS(BaseModel):
    properties: dict
    type: str


class PlacemarksFeature(FeatureCollection):
    type: str = "FeatureCollection"
    crs: Optional[CRS] = None
    features: List[Feature]
