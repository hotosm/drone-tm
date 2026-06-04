"""Backfill cloudnative derivatives (COG + 3D tiles) for existing projects.

Useful for projects that finished processing before the cloudnative pipeline
existed, or to re-run a conversion after an upstream fix. The script enqueues
the same arq jobs that fire automatically when a new project finalizes, so it
inherits the worker's timeout, retry, and observability behaviour. A running
arq worker is required to actually do the work.

Usage:
    python -m app.scripts.generate_cloudnative --project-id <uuid>
    python -m app.scripts.generate_cloudnative --project-id <uuid> --force
    python -m app.scripts.generate_cloudnative --project-id <uuid> --cog
    python -m app.scripts.generate_cloudnative --project-id <uuid> --tiles
"""

import argparse
import asyncio
import sys
import uuid

from arq import create_pool
from arq.connections import RedisSettings

from app.config import settings


async def _enqueue(project_id: str, *, cog: bool, tiles: bool, force: bool) -> None:
    redis = await create_pool(RedisSettings.from_dsn(settings.DRAGONFLY_DSN))
    try:
        if cog:
            job = await redis.enqueue_job(
                "generate_orthophoto_cog",
                project_id=project_id,
                force=force,
                _queue_name="default_queue",
            )
            print(f"Enqueued generate_orthophoto_cog: job_id={job.job_id}")
        if tiles:
            job = await redis.enqueue_job(
                "generate_3d_tiles",
                project_id=project_id,
                force=force,
                _queue_name="default_queue",
            )
            print(f"Enqueued generate_3d_tiles: job_id={job.job_id}")
    finally:
        await redis.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill cloudnative derivatives for an existing project.",
    )
    parser.add_argument(
        "--project-id",
        required=True,
        type=str,
        help="Project UUID to backfill.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-run conversion even if the ready flag is already set.",
    )
    parser.add_argument(
        "--cog",
        action="store_true",
        help="Only enqueue the COG conversion (default: both).",
    )
    parser.add_argument(
        "--tiles",
        action="store_true",
        help="Only enqueue the 3D tiles conversion (default: both).",
    )
    args = parser.parse_args()

    try:
        uuid.UUID(args.project_id)
    except ValueError:
        print(f"Invalid project UUID: {args.project_id}", file=sys.stderr)
        return 2

    # No selector flags -> run both. With selectors, honour exactly what's set.
    if not args.cog and not args.tiles:
        cog = tiles = True
    else:
        cog = args.cog
        tiles = args.tiles

    asyncio.run(_enqueue(args.project_id, cog=cog, tiles=tiles, force=args.force))
    return 0


if __name__ == "__main__":
    sys.exit(main())
