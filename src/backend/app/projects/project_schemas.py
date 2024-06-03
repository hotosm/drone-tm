from pydantic import BaseModel, computed_field
from typing import Any, Optional, Union
from geojson_pydantic import Feature, FeatureCollection, Polygon
from app.models.enums import TaskSplitType

from app.utils import (
    geojson_to_geometry,
    read_wkb,
    merge_multipolygon,
    write_wkb,
)


class ProjectInfo(BaseModel):
    """Basic project info."""

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
    outline_geojson: Union[FeatureCollection, Feature, Polygon]

    # @computed_field
    # @property
    # def outline(self) -> Optional[Any]:
    #     """Compute WKBElement geom from geojson."""
    #     if not self.outline_geojson:
    #         return None
    #     outline = merge_multipolygon(self.outline_geojson)

    #     return geojson_to_geometry(outline)

    @computed_field
    @property
    def outline(self) -> Optional[Any]:
        """Compute WKBElement geom from geojson."""
        if not self.outline_geojson:
            return None
        print(self.outline_geojson)
        outline = merge_multipolygon(self.outline_geojson)
        print(outline)

        return geojson_to_geometry(outline)

    @computed_field
    @property
    def centroid(self) -> Optional[Any]:
        """Compute centroid for project outline."""
        return None
        if not self.outline:
            return None
        return write_wkb(read_wkb(self.outline).centroid)

    # @computed_field
    # @property
    # def location_str(self) -> Optional[str]:
    #     """Compute geocoded location string from centroid."""
    #     if not self.centroid:
    #         return None
    #     geom = read_wkb(self.centroid)
    #     latitude, longitude = geom.y, geom.x
    #     address = get_address_from_lat_lon(latitude, longitude)
    #     return address if address is not None else ""

    # @computed_field
    # @property
    # def project_name_prefix(self) -> str:
    #     """Compute project name prefix with underscores."""
    #     return self.name.replace(" ", "_").lower()


class ProjectOut(BaseModel):
    """Base project model."""

    # outline_geojson: Any = Field(exclude=True)
    name: str
    short_description: str
    description: str
    per_task_instructions: Optional[str] = None

    # @computed_field
    # @property
    # def outline(self) -> Optional[Feature]:
    #     """Compute the geojson outline from WKBElement outline."""
    #     if not self.outline:
    #         return None
    #     geometry = wkb.loads(bytes(self.outline.data))
    #     bbox = geometry.bounds  # Calculate bounding box
    #     return geometry_to_geojson(self.outline, {"id": self.id, "bbox": bbox}, self.id)
