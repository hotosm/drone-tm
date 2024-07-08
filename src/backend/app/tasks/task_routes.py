import uuid
from fastapi import APIRouter, Depends
from app.config import settings
from app.models.enums import EventType, State
from app.tasks import task_schemas, task_crud
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from databases import Database
from app.db import database


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/tasks",
    tags=["tasks"],
    responses={404: {"description": "Not found"}},
)


@router.get("/states/{project_id}")
async def task_states(
    project_id: uuid.UUID, db: Database = Depends(database.encode_db)
):
    """Get all tasks states for a project."""

    return await task_crud.all_tasks_states(db, project_id)


@router.post("/update-event/")
async def new_event(
    detail: task_schemas.NewEvent,
    user_data: AuthUser = Depends(login_required),
    db: Database = Depends(database.encode_db),
):
    user_id = user_data.id

    match detail.event:
        case EventType.MAP:
            return await task_crud.map_task(
                db,
                detail.project_id,
                detail.task_id,
                user_id,
                "Done: locked for mapping",
            )
        case EventType.FINISH:
            return await task_crud.update_task_state(
                db,
                detail.project_id,
                detail.task_id,
                user_id,
                "Done: unlocked to validate",
                State.LOCKED_FOR_MAPPING,
                State.UNLOCKED_TO_VALIDATE,
            )
        case EventType.VALIDATE:
            return await task_crud.update_task_state(
                db,
                detail.project_id,
                detail.task_id,
                user_id,
                "Done: locked for validation",
                State.UNLOCKED_TO_VALIDATE,
                State.LOCKED_FOR_VALIDATION,
            )
        case EventType.GOOD:
            return await task_crud.update_task_state(
                db,
                detail.project_id,
                detail.task_id,
                user_id,
                "Done: Task is Good",
                State.LOCKED_FOR_VALIDATION,
                State.UNLOCKED_DONE,
            )

        case EventType.BAD:
            return await task_crud.update_task_state(
                db,
                detail.project_id,
                detail.task_id,
                user_id,
                "Done: needs to redo",
                State.LOCKED_FOR_VALIDATION,
                State.UNLOCKED_TO_MAP,
            )

    return True
