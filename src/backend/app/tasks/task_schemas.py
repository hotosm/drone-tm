from pydantic import BaseModel
from app.models.enums import EventType


class NewEvent(BaseModel):
    event: EventType
