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
            WITH last AS (
                SELECT *
                FROM task_events
                WHERE project_id= :project_id AND task_id= :task_id
                ORDER BY created_at DESC
                LIMIT 1
            ),
            released AS (
                SELECT COUNT(*) = 0 AS no_record
                FROM task_events
                WHERE project_id= :project_id AND task_id= :task_id AND state = :unlocked_to_map_state
            )
            INSERT INTO task_events (event_id, project_id, task_id, user_id, comment, state, created_at)

            SELECT
                gen_random_uuid(),
                :project_id,
                :task_id,
                :user_id,
                :comment,
                :locked_for_mapping_state,
                now()
            FROM last
            RIGHT JOIN released ON true
            WHERE (last.state = :unlocked_to_map_state OR released.no_record = true);
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


async def update_task_state(
    db: Database,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: str,
    comment: str,
    initial_state: State,
    final_state: State,
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
                    WHERE user_id = :user_id AND state = :initial_state
                )
                INSERT INTO task_events(event_id, project_id, task_id, user_id, state, comment, created_at)
                SELECT gen_random_uuid(), project_id, task_id, user_id, :final_state, :comment, now()
                FROM last
                WHERE user_id = :user_id
                RETURNING project_id, task_id, user_id, state;
        """

    values = {
        "project_id": str(project_id),
        "task_id": str(task_id),
        "user_id": str(user_id),
        "comment": comment,
        "initial_state": initial_state.name,
        "final_state": final_state.name,
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
