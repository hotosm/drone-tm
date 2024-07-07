import uuid
from app.models.enums import State
from databases import Database


async def all_tasks_states(db: Database, project_id: uuid.UUID):
    query = """
        SELECT DISTINCT ON (task_id) project_id, task_id, state
        FROM task_events
        WHERE project_id=:project_id
        """
    r = await db.fetch_all(query, {"project_id": str(project_id)})

    return [dict(r) for r in r]


async def update_task_event(
    db: Database,
    project_id: uuid.UUID,
    user_id: str,
    task_id: uuid.UUID,
    state: State,
) -> None:
    event_id = str(uuid.uuid4())
    comment = "comment"

    query = """
        WITH last AS (
            SELECT *
            FROM task_events
            WHERE project_id = :project_id AND task_id = :task_id
            ORDER BY event_id DESC
            LIMIT 1
        ),
        locked AS (
            SELECT *
            FROM last
            WHERE user_id = :user_id AND state = :state
        )
        INSERT INTO public.task_events(event_id, project_id, task_id, user_id, state, comment, created_at)
        SELECT :event_id, project_id, task_id, user_id, :state, :comment, now()
        FROM last
        WHERE user_id = :user_id
        RETURNING project_id, task_id, user_id;
    """

    values = {
        "project_id": str(project_id),
        "task_id": str(task_id),
        "user_id": str(user_id),
        "state": str(state.name),
        "event_id": event_id,
        "comment": comment,
    }

    r = await db.fetch_one(query, values)

    assert r is not None
    assert r["project_id"] == project_id
    assert r["task_id"] == task_id
    assert r["user_id"] == user_id

    return None
