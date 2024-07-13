import uuid
from pydantic import BaseModel, computed_field, Field
from typing import Any, Optional, Union
from geojson_pydantic import Feature, FeatureCollection, Polygon
from app.models.enums import TaskSplitType
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
    short_description: str
    description: str
    per_task_instructions: Optional[str] = None


class ProjectIn(BaseModel):
    """Upload new project."""

    name: str
    short_description: str
    description: str
    per_task_instructions: Optional[str] = None
    organisation_id: Optional[int] = None
    task_split_type: Optional[TaskSplitType] = None
    task_split_dimension: Optional[int] = None
    dem_url: Optional[str] = None
    gsd_cm_px: float = None
    is_terrain_follow: bool = False
    outline_no_fly_zones: Union[FeatureCollection, Feature, Polygon]
    outline_geojson: Union[FeatureCollection, Feature, Polygon]
    output_orthophoto_url: Optional[str] = None
    output_pointcloud_url: Optional[str] = None
    output_raw_url: Optional[str] = None
    deadline: Optional[date] = None

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


class TaskOut(BaseModel):
    """Base project model."""

    id: uuid.UUID
    project_task_index: int
    outline: Any = Field(exclude=True)

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
    name: str
    short_description: str
    description: str
    per_task_instructions: Optional[str] = None
    outline: Any = Field(exclude=True)
    tasks: list[TaskOut] = []
    task_count: int = None

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
    image_name: str
    expiry: int  # Expiry time in seconds
