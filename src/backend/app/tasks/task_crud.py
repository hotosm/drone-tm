import uuid
from databases import Database
from app.models.enums import State


async def all_tasks_states(db: Database, project_id: uuid.UUID):
    query = """
        SELECT DISTINCT ON (task_id) project_id, task_id, state
        FROM task_events
        WHERE project_id=:project_id
        ORDER BY task_id, created_at DESC
        """
    r = await db.fetch_all(query, {"project_id": str(project_id)})

    return [dict(r) for r in r]


async def map_task(
    db: Database, project_id: uuid.UUID, task_id: uuid.UUID, user_id: str, comment: str
):
    query = """
        WITH latest_events AS (
            SELECT DISTINCT ON (task_id)
                project_id,
                task_id,
                user_id,
                comment,
                state
            FROM task_events
            WHERE project_id = :project_id
            ORDER BY task_id, created_at DESC
        ),
        valid_tasks AS (
            SELECT *
            FROM latest_events
            WHERE state = :unlocked_to_map_state
        ),
        missing_task AS (
            SELECT
                CAST(:project_id AS UUID) AS project_id,
                CAST(:task_id AS UUID) AS task_id,
                :user_id AS user_id,
                :comment AS comment,
                CAST(:locked_for_mapping_state AS State) AS state
            WHERE NOT EXISTS (
                SELECT 1
                FROM task_events
                WHERE project_id = :project_id
                AND task_id = :task_id
            )
        )
        INSERT INTO task_events (event_id, project_id, task_id, user_id, comment, state, created_at)
        SELECT
            gen_random_uuid(),
            project_id,
            task_id,
            user_id,
            comment,
            state,
            now()
        FROM valid_tasks
        UNION ALL
        SELECT
            gen_random_uuid(),
            project_id,
            task_id,
            user_id,
            comment,
            state,
            now()
        FROM missing_task
        RETURNING project_id, task_id, user_id, comment, state;
    """

    values = {
        "project_id": str(project_id),
        "task_id": str(task_id),
        "user_id": str(user_id),
        "comment": comment,
        "unlocked_to_map_state": State.UNLOCKED_TO_MAP.name,
        "locked_for_mapping_state": State.LOCKED_FOR_MAPPING.name,
    }

    await db.fetch_one(query, values)

    return {"project_id": project_id, "task_id": task_id, "comment": comment}


async def finish(
    db: Database, project_id: uuid.UUID, task_id: uuid.UUID, user_id: str, comment: str
):
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
            WHERE user_id = :user_id AND state = :locked_for_mapping_state
        )
        INSERT INTO task_events(event_id, project_id, task_id, user_id, state, comment, created_at)
        SELECT gen_random_uuid(), project_id, task_id, user_id, :unlocked_to_validate_state, :comment, now()
        FROM last
        WHERE user_id = :user_id
        RETURNING project_id, task_id, user_id, state;
        """

    values = {
        "project_id": str(project_id),
        "task_id": str(task_id),
        "user_id": str(user_id),
        "comment": comment,
        "unlocked_to_validate_state": State.UNLOCKED_TO_VALIDATE.name,
        "locked_for_mapping_state": State.LOCKED_FOR_MAPPING.name,
    }

    r = await db.fetch_one(query, values)

    assert r is not None
    assert r["project_id"] == project_id
    assert r["task_id"] == task_id
    assert r["user_id"] == user_id

    return {"project_id": project_id, "task_id": task_id, "comment": comment}
