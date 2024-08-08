from pydantic import BaseModel
from app.models.enums import EventType
import uuid
from datetime import datetime
from typing import Optional


class NewEvent(BaseModel):
    event: EventType
    comment: Optional[str] = None


class UserTasksStatsOut(BaseModel):
    task_id: uuid.UUID
    task_area: float
    created_at: datetime
    state: str
    project_id: uuid.UUID
