from pydantic import BaseModel
from app.models.enums import EventType
import uuid
from datetime import datetime


class NewEvent(BaseModel):
    event: EventType


class UserTasksStatsOut(BaseModel):
    task_id: uuid.UUID
    task_area: float
    created_at: datetime
    state: str
