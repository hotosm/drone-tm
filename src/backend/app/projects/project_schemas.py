import uuid
import json
from pydantic import BaseModel, computed_field, Field, validator, model_validator
from typing import Any, Optional, Union, List
from geojson_pydantic import Feature, FeatureCollection, Polygon
from app.models.enums import FinalOutput, ProjectVisibility, State
from shapely import wkb
from datetime import date
from app.utils import (
    geojson_to_geometry,
    multipolygon_to_polygon,
    read_wkb,
    merge_multipolygon,
    str_to_geojson,
    write_wkb,
)


class ProjectInfo(BaseModel):
    """Basic project info."""

    id: int
    name: str
    description: str
    per_task_instructions: Optional[str] = None


class ProjectIn(BaseModel):
    """Upload new project."""

    name: str
    description: str
    per_task_instructions: Optional[str] = None
    task_split_dimension: Optional[int] = None
    gsd_cm_px: Optional[float] = None
    altitude_from_ground: Optional[float] = None
    forward_overlap_percent: Optional[float] = None
    side_overlap_percent: Optional[float] = None
    is_terrain_follow: bool = False
    outline_no_fly_zones: Optional[Union[FeatureCollection, Feature, Polygon]] = None
    outline_geojson: Union[FeatureCollection, Feature, Polygon]
    output_orthophoto_url: Optional[str] = None
    output_pointcloud_url: Optional[str] = None
    output_raw_url: Optional[str] = None
    deadline_at: Optional[date] = None
    visibility: Optional[ProjectVisibility] = ProjectVisibility.PUBLIC
    final_output: List[FinalOutput] = Field(
        ...,
        example=[
            "ORTHOPHOTO_2D",
            "ORTHOPHOTO_3D",
            "DIGITAL_TERRAIN_MODEL",
            "DIGITAL_SURFACE_MODEL",
        ],
    )
    requires_approval_from_manager_for_locking: Optional[bool] = False
    front_overlap: Optional[float] = None
    side_overlap: Optional[float] = None

    @computed_field
    @property
    def no_fly_zones(self) -> Optional[Any]:
        """Compute WKBElement geom from geojson."""
        if not self.outline_no_fly_zones:
            return None

        outline = multipolygon_to_polygon(self.outline_no_fly_zones)
        return geojson_to_geometry(outline)

    @computed_field
    @property
    def outline(self) -> Optional[Any]:
        """Compute WKBElement geom from geojson."""
        if not self.outline_geojson:
            return None

        outline = merge_multipolygon(self.outline_geojson)
        return geojson_to_geometry(outline)

    @computed_field
    @property
    def centroid(self) -> Optional[Any]:
        """Compute centroid for project outline."""
        if not self.outline:
            return None
        return write_wkb(read_wkb(self.outline).centroid)

    @model_validator(mode="before")
    @classmethod
    def validate_to_json(cls, value):
        if isinstance(value, str):
            return cls(**json.loads(value))
        return value


class TaskOut(BaseModel):
    """Base project model."""

    id: uuid.UUID
    project_task_index: int
    outline: Any = Field(exclude=True)
    state: Optional[State] = None
    contributor: Optional[str] = None

    @validator("state", pre=True, always=True)
    def validate_state(cls, v):
        if isinstance(v, str):
            try:
                v = State[v]
            except KeyError:
                raise ValueError(f"Invalid state: {v}")
        return v

    @computed_field
    @property
    def outline_geojson(self) -> Optional[Feature]:
        """Compute the geojson outline from WKBElement outline."""
        if not self.outline:
            return None
        wkb_data = bytes.fromhex(self.outline)
        geom = wkb.loads(wkb_data)
        bbox = geom.bounds  # Calculate bounding box
        return str_to_geojson(self.outline, {"id": self.id, "bbox": bbox}, str(self.id))


class ProjectOut(BaseModel):
    """Base project model."""

    id: uuid.UUID
    slug: Optional[str] = None
    name: str
    description: str
    per_task_instructions: Optional[str] = None
    outline: Any = Field(exclude=True)
    task_count: int = None
    tasks: list[TaskOut] = []

    @computed_field
    @property
    def outline_geojson(self) -> Optional[Feature]:
        """Compute the geojson outline from WKBElement outline."""
        if not self.outline:
            return None
        wkb_data = bytes.fromhex(self.outline)
        geom = wkb.loads(wkb_data)
        bbox = geom.bounds  # Calculate bounding box
        return str_to_geojson(self.outline, {"id": self.id, "bbox": bbox}, str(self.id))


class PresignedUrlRequest(BaseModel):
    project_id: uuid.UUID
    task_id: uuid.UUID
    image_name: List[str]
    expiry: int  # Expiry time in hours
