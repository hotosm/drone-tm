"""Migrate ``tasks.assets_url`` away from the legacy ``assets.zip``.

Historically ``tasks.assets_url`` referenced the per-task ``assets.zip``
that bundled all task imagery. The current pipeline writes the fast
orthophoto for the task under the ``odm/`` layout and the column now
references that orthophoto directly so the processing UI can serve a
single-file download.

For every task whose ``assets_url`` still mentions ``assets.zip`` this
script:

1. Deletes the redundant ``projects/{pid}/{tid}/assets.zip`` from S3
   (skipped, with a warning, when the new ``odm/`` layout for the task
   is empty - that would mean ``migrate-extract-odm-assets.py`` has not
   yet been run and dropping the zip would lose data).
2. If ``projects/{pid}/{tid}/odm/odm_orthophoto/odm_orthophoto.tif``
   exists, rewrites ``tasks.assets_url`` to that S3 key so the
   ``TaskDetailsOut`` validator presigns it as a downloadable URL.

Usage::

    # Inside the backend container (or any env with backend deps installed):
    python scripts/migrate-task-assets-url.py

    # Dry run - show what would happen, change nothing:
    python scripts/migrate-task-assets-url.py --dry-run

    # Limit to one project:
    python scripts/migrate-task-assets-url.py --project-id <uuid>

The script reads bucket / endpoint / database config from the same env
vars the backend uses (via ``app.config.settings``).
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from dataclasses import dataclass, field

from loguru import logger as log
from minio.error import S3Error
from psycopg.rows import dict_row

from app.config import settings
from app.db.database import get_db_connection_pool
from app.s3 import s3_client


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

ASSETS_ZIP_SUFFIX = "assets.zip"
NEW_ORTHO_SUFFIX = "odm/odm_orthophoto/odm_orthophoto.tif"


@dataclass
class TaskMigrationResult:
    project_id: str
    task_id: str
    actions: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def changed(self) -> bool:
        return any(not a.startswith("skip") for a in self.actions)


def _object_exists(client, bucket: str, key: str) -> bool:
    try:
        client.stat_object(bucket, key)
        return True
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchObject", "NotFound"):
            return False
        raise


def _odm_prefix_has_files(client, bucket: str, project_id: str, task_id: str) -> bool:
    prefix = f"projects/{project_id}/{task_id}/odm/"
    for _ in client.list_objects(bucket, prefix=prefix, recursive=True):
        return True
    return False


async def _fetch_legacy_tasks(conn, project_id: str | None) -> list[dict]:
    """Return tasks whose ``assets_url`` still references ``assets.zip``."""
    sql = "SELECT id, project_id, assets_url FROM tasks WHERE assets_url ILIKE %(pat)s"
    params: dict = {"pat": "%assets.zip%"}
    if project_id:
        sql += " AND project_id = %(pid)s"
        params["pid"] = project_id
    sql += " ORDER BY project_id, id"

    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()
    return rows


async def _set_assets_url(
    conn,
    project_id: str,
    task_id: str,
    new_value: str,
    dry_run: bool,
) -> None:
    if dry_run:
        return
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE tasks SET assets_url = %(url)s"
            " WHERE id = %(tid)s AND project_id = %(pid)s",
            {"url": new_value, "tid": task_id, "pid": project_id},
        )


def _delete_legacy_zip(
    client,
    bucket: str,
    project_id: str,
    task_id: str,
    dry_run: bool,
) -> list[str]:
    actions: list[str] = []
    zip_key = f"projects/{project_id}/{task_id}/{ASSETS_ZIP_SUFFIX}"

    if not _object_exists(client, bucket, zip_key):
        actions.append("skip-zip-absent")
        return actions

    if not _odm_prefix_has_files(client, bucket, project_id, task_id):
        # Refuse to delete the zip when the new odm/ layout is empty -
        # that would discard the only copy of the task imagery. The
        # operator should run migrate-extract-odm-assets.py first.
        actions.append("skip-zip-no-extracted-data")
        return actions

    if dry_run:
        actions.append(f"would-delete {zip_key}")
        return actions

    client.remove_object(bucket, zip_key)
    actions.append("deleted-legacy-zip")
    return actions


async def migrate_task(
    conn,
    client,
    bucket: str,
    project_id: str,
    task_id: str,
    dry_run: bool,
) -> TaskMigrationResult:
    result = TaskMigrationResult(project_id=project_id, task_id=task_id)
    try:
        result.actions += _delete_legacy_zip(
            client, bucket, project_id, task_id, dry_run
        )

        ortho_key = f"projects/{project_id}/{task_id}/{NEW_ORTHO_SUFFIX}"
        if _object_exists(client, bucket, ortho_key):
            if dry_run:
                result.actions.append(f"would-set-assets-url {ortho_key}")
            else:
                await _set_assets_url(conn, project_id, task_id, ortho_key, dry_run)
                result.actions.append("updated-assets-url")
        else:
            result.actions.append("skip-no-ortho")
    except Exception as e:
        result.errors.append(str(e))
        log.exception(f"Failed to migrate task {project_id}/{task_id}")
    return result


async def run(project_id: str | None, dry_run: bool) -> int:
    bucket = settings.S3_BUCKET_NAME
    client = s3_client()
    pool = await get_db_connection_pool()

    log.info(
        f"Starting tasks.assets_url migration"
        f" (bucket={bucket}, dry_run={dry_run}, project_id={project_id or 'ALL'})"
    )

    results: list[TaskMigrationResult] = []
    try:
        async with pool.connection() as conn:
            tasks = await _fetch_legacy_tasks(conn, project_id)
            log.info(f"Found {len(tasks)} task(s) with legacy assets.zip URL")

            for row in tasks:
                pid = str(row["project_id"])
                tid = str(row["id"])
                log.info(f"Task {pid}/{tid}: assets_url={row['assets_url']!r}")
                result = await migrate_task(conn, client, bucket, pid, tid, dry_run)
                results.append(result)
                status = "OK" if result.ok else "ERR"
                log.info(f"  [{status}] {', '.join(result.actions) or '-'}")
                for err in result.errors:
                    log.error(f"     {err}")

            if not dry_run:
                await conn.commit()
                log.info("DB changes committed.")
            else:
                log.info("Dry run - no DB changes made.")
    finally:
        await pool.close()

    total = len(results)
    ok = sum(1 for r in results if r.ok)
    failed = total - ok
    changed = sum(1 for r in results if r.ok and r.changed)
    skipped = sum(1 for r in results if r.ok and not r.changed)
    log.info(f"Done: total={total} changed={changed} skipped={skipped} failed={failed}")

    if failed:
        log.error("Some tasks failed - re-run after investigating the errors above.")
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect and report what would change, without modifying S3 or the DB.",
    )
    parser.add_argument(
        "--project-id",
        type=str,
        default=None,
        help="Limit migration to a single project UUID.",
    )
    args = parser.parse_args()

    if args.project_id and not UUID_RE.match(args.project_id):
        log.error(f"Invalid project UUID: {args.project_id!r}")
        return 2

    return asyncio.run(run(args.project_id, args.dry_run))


if __name__ == "__main__":
    sys.exit(main())
