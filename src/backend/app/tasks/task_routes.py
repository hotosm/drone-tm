import uuid
from fastapi import APIRouter, Depends
from app.config import settings
from app.models.enums import EventType
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
            return await task_crud.finish(
                db,
                detail.project_id,
                detail.task_id,
                user_id,
                "Done: unlocked to validate",
            )
        case EventType.VALIDATE:
            pass
        case EventType.GOOD:
            pass
        case EventType.BAD:
            pass

    return True
