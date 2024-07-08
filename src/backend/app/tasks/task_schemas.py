import uuid
from pydantic import BaseModel
from app.models.enums import EventType


class NewEvent(BaseModel):
    event: EventType
    project_id: uuid.UUID
    task_id: uuid.UUID
