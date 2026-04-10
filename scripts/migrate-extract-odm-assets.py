"""Migrate legacy ODM task assets into the new ``odm/`` layout.

What this script does, per task directory in the bucket
(``projects/{project_id}/{task_id}/``):

1. If the legacy monolithic ``assets.zip`` exists AND no ``odm/`` files
   are present yet, the zip is downloaded, extracted, and each member
   is uploaded under ``projects/{pid}/{tid}/odm/{member}``.
2. If a legacy reprojected COG exists at
   ``projects/{pid}/{tid}/orthophoto/odm_orthophoto.tif``, it is copied
   (server-side) to
   ``projects/{pid}/{tid}/odm/odm_orthophoto/odm_orthophoto.tif``,
   overwriting the raw orthophoto extracted from the zip.

The script does NOT touch the database (``images.json`` is not stored
there). It is idempotent and safe to re-run: each task is inspected
fresh, and tasks that are already migrated are reported as "ok".

Usage::

    # Inside the backend container (or any env with backend deps installed):
    python -m scripts.migrate_legacy_odm_assets

    # Dry run - show what would happen, change nothing:
    python -m scripts.migrate_legacy_odm_assets --dry-run

    # Limit to one project:
    python -m scripts.migrate_legacy_odm_assets --project-id <uuid>

The script reads bucket / endpoint config from the same env vars the
backend uses (via ``app.config.settings``).
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from typing import Iterable

from loguru import logger as log
from minio.commonconfig import CopySource
from minio.error import S3Error

from app.config import settings
from app.s3 import s3_client


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

LEGACY_ORTHO_SUFFIX = "orthophoto/odm_orthophoto.tif"
NEW_ORTHO_SUFFIX = "odm/odm_orthophoto/odm_orthophoto.tif"
LEGACY_ASSETS_ZIP_SUFFIX = "assets.zip"
LEGACY_IMAGES_JSON_SUFFIX = "images.json"


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
    """Return True if at least one object exists under the new odm/ prefix."""
    prefix = f"projects/{project_id}/{task_id}/odm/"
    for _ in client.list_objects(bucket, prefix=prefix, recursive=True):
        return True
    return False


def _list_project_ids(client, bucket: str) -> Iterable[str]:
    """List immediate UUID-shaped subdirectories under projects/."""
    seen: set[str] = set()
    for obj in client.list_objects(bucket, prefix="projects/", recursive=False):
        # CommonPrefixes come back as objects whose name ends in '/'
        name = obj.object_name
        if not name.endswith("/"):
            continue
        candidate = name[len("projects/") :].rstrip("/")
        if UUID_RE.match(candidate) and candidate not in seen:
            seen.add(candidate)
            yield candidate


def _list_task_ids(client, bucket: str, project_id: str) -> Iterable[str]:
    """List immediate UUID-shaped subdirectories under projects/{pid}/."""
    seen: set[str] = set()
    prefix = f"projects/{project_id}/"
    for obj in client.list_objects(bucket, prefix=prefix, recursive=False):
        name = obj.object_name
        if not name.endswith("/"):
            continue
        candidate = name[len(prefix) :].rstrip("/")
        # Skip non-task subdirs like odm/, orthophoto/, images/, etc.
        if UUID_RE.match(candidate) and candidate not in seen:
            seen.add(candidate)
            yield candidate


def _unpack_legacy_assets_zip(
    client,
    bucket: str,
    project_id: str,
    task_id: str,
    dry_run: bool,
) -> list[str]:
    """Download legacy assets.zip and upload its members under odm/ prefix.

    Returns a list of action strings describing what was done.
    """
    actions: list[str] = []
    zip_key = f"projects/{project_id}/{task_id}/{LEGACY_ASSETS_ZIP_SUFFIX}"
    odm_prefix = f"projects/{project_id}/{task_id}/odm/"

    if not _object_exists(client, bucket, zip_key):
        return actions

    if _odm_prefix_has_files(client, bucket, project_id, task_id):
        actions.append("skip-zip-already-migrated")
        return actions

    if dry_run:
        actions.append(f"would-unpack {zip_key} -> {odm_prefix}")
        return actions

    # Download the zip to a temp file (these can be large; avoid loading
    # the whole thing into memory).
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        log.info(f"Downloading {zip_key} -> {tmp_path}")
        client.fget_object(bucket, zip_key, tmp_path)

        members_uploaded = 0
        with zipfile.ZipFile(tmp_path, "r") as zf:
            for member in zf.namelist():
                if member.endswith("/"):
                    continue
                # Path-traversal guard
                if member.startswith("/") or ".." in member.split("/"):
                    log.warning(f"Skipping unsafe zip member: {member}")
                    continue

                s3_key = f"{odm_prefix}{member}"
                with zf.open(member) as src:
                    data = src.read()
                client.put_object(
                    bucket,
                    s3_key,
                    io.BytesIO(data),
                    length=len(data),
                )
                members_uploaded += 1

        actions.append(f"unpacked-zip ({members_uploaded} members)")

        # Unpack succeeded - remove the legacy zip so re-runs are cheaper
        # and the bucket doesn't carry the duplicate payload.
        client.remove_object(bucket, zip_key)
        actions.append("deleted-legacy-zip")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    return actions


def _copy_legacy_ortho_to_odm(
    client,
    bucket: str,
    project_id: str,
    task_id: str,
    dry_run: bool,
) -> list[str]:
    """Server-side copy legacy task-root ortho COG over the new odm/ ortho.

    The legacy file at ``orthophoto/odm_orthophoto.tif`` is the reprojected
    EPSG:3857 COG from a previous processing run. It overwrites the raw
    ``odm/odm_orthophoto/odm_orthophoto.tif`` extracted from the zip.
    """
    actions: list[str] = []
    legacy_key = f"projects/{project_id}/{task_id}/{LEGACY_ORTHO_SUFFIX}"
    new_key = f"projects/{project_id}/{task_id}/{NEW_ORTHO_SUFFIX}"

    if not _object_exists(client, bucket, legacy_key):
        return actions

    if dry_run:
        actions.append(f"would-copy {legacy_key} -> {new_key}")
        return actions

    log.info(f"Copying {legacy_key} -> {new_key}")
    client.copy_object(
        bucket,
        new_key,
        CopySource(bucket, legacy_key),
    )
    # Copy succeeded - delete the legacy source.
    client.remove_object(bucket, legacy_key)
    actions.append("copied-ortho")
    actions.append("deleted-legacy-ortho")
    return actions


def migrate_task(
    client,
    bucket: str,
    project_id: str,
    task_id: str,
    dry_run: bool,
) -> TaskMigrationResult:
    result = TaskMigrationResult(project_id=project_id, task_id=task_id)
    try:
        result.actions += _unpack_legacy_assets_zip(
            client, bucket, project_id, task_id, dry_run
        )
        result.actions += _copy_legacy_ortho_to_odm(
            client, bucket, project_id, task_id, dry_run
        )
        if not result.actions:
            # Nothing to do means already migrated (or never had legacy data)
            if _odm_prefix_has_files(client, bucket, project_id, task_id):
                result.actions.append("skip-already-migrated")
            else:
                result.actions.append("skip-no-legacy-data")
    except Exception as e:
        result.errors.append(str(e))
        log.exception(f"Failed to migrate task {project_id}/{task_id}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect and report what would change, without modifying S3.",
    )
    parser.add_argument(
        "--project-id",
        type=str,
        default=None,
        help="Limit migration to a single project UUID.",
    )
    args = parser.parse_args()

    bucket = settings.S3_BUCKET_NAME
    client = s3_client()

    log.info(
        f"Starting legacy ODM asset migration (bucket={bucket}, dry_run={args.dry_run})"
    )

    if args.project_id:
        if not UUID_RE.match(args.project_id):
            log.error(f"Invalid project UUID: {args.project_id}")
            return 2
        project_ids: Iterable[str] = [args.project_id]
    else:
        project_ids = _list_project_ids(client, bucket)

    results: list[TaskMigrationResult] = []
    for pid in project_ids:
        log.info(f"Project {pid}")
        try:
            for tid in _list_task_ids(client, bucket, pid):
                result = migrate_task(client, bucket, pid, tid, args.dry_run)
                results.append(result)
                status = "OK" if result.ok else "ERR"
                log.info(f"  [{status}] task {tid}: {', '.join(result.actions) or '-'}")
                for err in result.errors:
                    log.error(f"     {err}")
        except Exception as e:
            log.exception(f"Failed to enumerate tasks for project {pid}: {e}")

    # Summary
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


if __name__ == "__main__":
    sys.exit(main())
