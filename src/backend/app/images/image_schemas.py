"""Pydantic schemas for project images."""

from datetime import datetime
from typing import Any, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import ImageStatus


class ProjectImageBase(BaseModel):
    """Base schema for project images."""

    filename: str
    s3_key: str
    hash_md5: str = Field(..., max_length=32)
    location: Optional[dict[str, Any]] = None  # Supports both {"lat": float, "lon": float} and GeoJSON
    exif: Optional[dict[str, Any]] = None

    @field_validator("location", mode="before")
    @classmethod
    def convert_geojson_to_latlon(cls, value: Optional[dict]) -> Optional[dict]:
        """Convert GeoJSON Point format to {lat, lon} format if needed.

        PostGIS returns: {"type": "Point", "coordinates": [lon, lat]}
        We want: {"lat": float, "lon": float}
        """
        if value is None:
            return None

        # If it's already in {lat, lon} format, return as-is
        if "lat" in value and "lon" in value:
            return value

        # Convert from GeoJSON format
        if "type" in value and value.get("type") == "Point" and "coordinates" in value:
            coords = value["coordinates"]
            if len(coords) >= 2:
                return {"lon": coords[0], "lat": coords[1]}

        return value


class ProjectImageCreate(ProjectImageBase):
    """Schema for creating a project image record."""

    project_id: UUID
    task_id: Optional[UUID] = None
    uploaded_by: str  # User ID is a string (Google OAuth ID), not UUID
    status: ImageStatus = ImageStatus.STAGED
    batch_id: Optional[UUID] = None  # For grouping uploaded images together


class ProjectImageUpdate(BaseModel):
    """Schema for updating a project image."""

    task_id: Optional[UUID] = None
    status: Optional[ImageStatus] = None
    classified_at: Optional[datetime] = None
    duplicate_of: Optional[UUID] = None


class ProjectImageOut(ProjectImageBase):
    """Schema for project image output."""

    id: UUID
    project_id: UUID
    task_id: Optional[UUID]
    uploaded_by: Optional[str]  # User ID is a string (Google OAuth ID), not UUID
    uploaded_at: datetime
    classified_at: Optional[datetime]
    status: ImageStatus
    duplicate_of: Optional[UUID]
    batch_id: Optional[UUID]
    rejection_reason: Optional[str] = None

    class Config:
        """Pydantic config."""

        from_attributes = True
