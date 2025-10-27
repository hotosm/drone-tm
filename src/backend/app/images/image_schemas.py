"""Pydantic schemas for project images."""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import ImageStatus


class ProjectImageBase(BaseModel):
    """Base schema for project images."""

    filename: str
    s3_key: str
    hash_md5: str = Field(..., max_length=32)
    location: Optional[dict[str, float]] = None  # {"lat": float, "lon": float}
    exif: Optional[dict[str, Any]] = None


class ProjectImageCreate(ProjectImageBase):
    """Schema for creating a project image record."""

    project_id: UUID
    task_id: Optional[UUID] = None
    uploaded_by: UUID
    status: ImageStatus = ImageStatus.STAGED


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
    uploaded_by: Optional[UUID]
    uploaded_at: datetime
    classified_at: Optional[datetime]
    status: ImageStatus
    duplicate_of: Optional[UUID]

    class Config:
        """Pydantic config."""

        from_attributes = True
