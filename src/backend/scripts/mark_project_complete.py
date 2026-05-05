"""Manually mark a project as fully complete.

What this script does:

1. Looks up all tasks for the given project.
2. Inserts a ``task_events`` row for every task, setting state to
   ``IMAGE_PROCESSING_FINISHED`` and adding the comment
   "Marked complete manually".
3. Updates the project's ``output_orthophoto_url`` to the supplied URL and
   sets ``image_processing_status = SUCCESS``.

After running this script the project appears fully complete in DroneTM and
the final orthophoto URL is available for download.

Usage::

    # Inside the backend container (or any env with backend deps installed):
    python -m scripts.mark_project_complete \\
        --project-id <uuid> \\
        --ortho-url  <https://...>

    # Dry run - show what would happen, change nothing:
    python -m scripts.mark_project_complete \\
        --project-id <uuid> \\
        --ortho-url  <https://...> \\
        --dry-run

The script reads database config from the same env vars the backend uses
(via ``app.config.settings``).
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import uuid
from datetime import datetime, timezone

from loguru import logger as log
from psycopg.rows import dict_row

from app.db.database import get_db_connection_pool
from app.models.enums import ImageProcessingStatus, State

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

MANUAL_COMMENT = "Marked complete manually"


async def _fetch_project(conn, project_id: str) -> dict | None:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT id, author_id, image_processing_status FROM projects WHERE id = %(id)s",
            {"id": project_id},
        )
        return await cur.fetchone()


async def _fetch_task_ids(conn, project_id: str) -> list[str]:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id FROM tasks WHERE project_id = %(project_id)s ORDER BY id",
            {"project_id": project_id},
        )
        rows = await cur.fetchall()
    return [str(row[0]) for row in rows]


async def _insert_task_event(
    conn,
    project_id: str,
    task_id: str,
    user_id: str,
    now: datetime,
    dry_run: bool,
) -> None:
    if dry_run:
        log.info(
            f"  [dry-run] would insert task_event for task {task_id}: "
            f"state={State.IMAGE_PROCESSING_FINISHED.name!r}"
        )
        return

    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO task_events
                (event_id, project_id, task_id, user_id, state, comment, created_at, updated_at)
            VALUES
                (%(event_id)s, %(project_id)s, %(task_id)s, %(user_id)s,
                 %(state)s, %(comment)s, %(now)s, %(now)s)
            """,
            {
                "event_id": str(uuid.uuid4()),
                "project_id": project_id,
                "task_id": task_id,
                "user_id": user_id,
                "state": State.IMAGE_PROCESSING_FINISHED.name,
                "comment": MANUAL_COMMENT,
                "now": now,
            },
        )


async def _update_project(
    conn,
    project_id: str,
    ortho_url: str,
    now: datetime,
    dry_run: bool,
) -> None:
    if dry_run:
        log.info(
            f"  [dry-run] would update project {project_id}: "
            f"output_orthophoto_url={ortho_url!r}, "
            f"image_processing_status={ImageProcessingStatus.SUCCESS.name!r}"
        )
        return

    await conn.execute(
        """
        UPDATE projects
        SET output_orthophoto_url   = %(ortho_url)s,
            image_processing_status = %(status)s,
            odm_task_uuid           = NULL,
            odm_endpoint_used       = NULL,
            last_updated            = %(now)s
        WHERE id = %(project_id)s
        """,
        {
            "ortho_url": ortho_url,
            "status": ImageProcessingStatus.SUCCESS.name,
            "now": now,
            "project_id": project_id,
        },
    )


async def run(project_id: str, ortho_url: str, dry_run: bool) -> int:
    pool = await get_db_connection_pool()
    try:
        async with pool.connection() as conn:
            project = await _fetch_project(conn, project_id)
            if project is None:
                log.error(f"Project {project_id} not found.")
                return 2

            user_id: str = project["author_id"]
            log.info(f"Project found. author_id={user_id}")

            task_ids = await _fetch_task_ids(conn, project_id)
            if not task_ids:
                log.error(f"No tasks found for project {project_id}.")
                return 2

            log.info(f"Found {len(task_ids)} task(s).")
            now = datetime.now(timezone.utc)

            for task_id in task_ids:
                await _insert_task_event(
                    conn, project_id, task_id, user_id, now, dry_run
                )
                log.info(f"  task {task_id}: event inserted")

            await _update_project(conn, project_id, ortho_url, now, dry_run)
            log.info(f"Project {project_id}: output_orthophoto_url set.")

            if not dry_run:
                await conn.commit()
                log.info("Changes committed.")
            else:
                log.info("Dry run complete - no changes made.")
    finally:
        await pool.close()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-id",
        required=True,
        help="UUID of the project to mark complete.",
    )
    parser.add_argument(
        "--ortho-url",
        required=True,
        help="Public/pre-signed URL of the final orthophoto asset to store on the project.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would happen without writing any changes.",
    )
    args = parser.parse_args()

    if not UUID_RE.match(args.project_id):
        log.error(f"Invalid project UUID: {args.project_id!r}")
        return 2

    log.info(
        f"mark_project_complete: project_id={args.project_id} dry_run={args.dry_run}"
    )
    return asyncio.run(run(args.project_id, args.ortho_url, args.dry_run))


if __name__ == "__main__":
    sys.exit(main())
