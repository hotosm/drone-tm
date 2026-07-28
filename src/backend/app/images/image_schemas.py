"""Pydantic schemas for project images."""

from datetime import datetime
from typing import Any
from uuid import UUID

from app.models.enums import ImageStatus
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProjectImageBase(BaseModel):
    """Base schema for project images."""

    filename: str
    s3_key: str
    hash_md5: str = Field(..., max_length=32)
    location: dict[str, Any] | None = (
        None  # Supports both {"lat": float, "lon": float} and GeoJSON
    )
    exif: dict[str, Any] | None = None
    thumbnail_url: str | None = None  # S3 key for 200x200 thumbnail

    @field_validator("location", mode="before")
    @classmethod
    def convert_geojson_to_latlon(cls, value: dict | None) -> dict | None:
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
    task_id: UUID | None = None
    uploaded_by: str  # User ID is a string (Google OAuth ID), not UUID
    status: ImageStatus = ImageStatus.STAGED
    batch_id: UUID | None = None  # For grouping uploaded images together
    rejection_reason: str | None = None


class ProjectImageUpdate(BaseModel):
    """Schema for updating a project image."""

    task_id: UUID | None = None
    status: ImageStatus | None = None
    classified_at: datetime | None = None
    duplicate_of: UUID | None = None


class ProjectImageOut(ProjectImageBase):
    """Schema for project image output."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    task_id: UUID | None
    uploaded_by: str | None  # User ID is a string (Google OAuth ID), not UUID
    uploaded_at: datetime
    classified_at: datetime | None
    status: ImageStatus
    duplicate_of: UUID | None
    batch_id: UUID | None
    rejection_reason: str | None = None
