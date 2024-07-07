import uuid
from fastapi import APIRouter, Depends
from app.config import settings
from app.models.enums import EventType
from app.tasks import task_schemas, task_crud
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.models.enums import State
from databases import Database
from app.db import database


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/tasks",
    tags=["tasks"],
    responses={404: {"description": "Not found"}},
)


@router.post("/project/{project_id}/event")
async def new_event(
    project_id: uuid.UUID,
    detail: task_schemas.NewEvent,
    user_data: AuthUser = Depends(login_required),
    db: Database = Depends(database.encode_db),
):
    user_id = user_data.id

    # Event state mappings
    event_state_mapping = {
        "map": State.LOCKED_FOR_MAPPING,
        "finish": State.UNLOCKED_TO_VALIDATE,
        "validate": State.LOCKED_FOR_VALIDATION,
        "good": State.UNLOCKED_DONE,
        "bad": State.UNLOCKED_TO_MAP,
        "split": State.UNLOCKED_DONE,
        "assign": State.LOCKED_FOR_MAPPING,
        "comment": None,  # Comment should keep the same state
    }

    # Get the current state based on the event
    if detail.event in event_state_mapping:
        state = event_state_mapping[detail.event]
    else:
        raise ValueError("Invalid event type")

    # If the event is a comment, we need to get the current state from the last event
    if detail.event == EventType.COMMENT:
        last_event_query = """
            SELECT state
            FROM task_events
            WHERE project_id = :project_id AND task_id = :task_id
            ORDER BY event_id DESC
            LIMIT 1;
        """
        last_event = await db.fetch_one(
            last_event_query, {"project_id": project_id, "task_id": detail.task_id}
        )
        if last_event is None:
            raise ValueError("No previous event found for this project and task.")
        state = last_event["state"]

    await task_crud.update_task_event(db, project_id, user_id, detail.task_id, state)

    return True
