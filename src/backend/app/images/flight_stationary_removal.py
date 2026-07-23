from uuid import UUID
from math import cos, radians, sqrt

from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

from app.models.enums import ImageStatus
from app.images.image_logic import reject_assigned_images


# Two photos closer than this are treated as the same location. 5m covers
# normal GPS jitter while the drone hovers on a waypoint.
TOLERANCE_METERS = 5.0

# A run of at least this many photos within TOLERANCE_METERS of where the run
# started means the drone was stationary (e.g. hovering with the interval timer
# still firing), not flying. Shorter runs are normal flight and left untouched,
# which keeps dense high-overlap grids safe.
MIN_STATIONARY_CLUSTER = 6

_EARTH_RADIUS_METERS = 6371000.0


def _distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two coordinates using an equirectangular approximation.

    At the ~5m scale we care about, the error versus a full geodesic is
    sub-millimetre, and keeping the maths in Python avoids a per-comparison
    round-trip to PostGIS.
    """
    mean_lat = radians((lat1 + lat2) / 2.0)
    x = radians(lon2 - lon1) * cos(mean_lat)
    y = radians(lat2 - lat1)
    return _EARTH_RADIUS_METERS * sqrt(x * x + y * y)


def _find_stationary_duplicates(rows: list[dict]) -> list:
    """Return the ids of photos that just repeat an earlier photo's location.

    Walk the photos in capture order, keeping an 'anchor' at the start of each
    run. While consecutive photos stay within TOLERANCE_METERS of the anchor
    they belong to the same run. A run of at least MIN_STATIONARY_CLUSTER photos
    means the drone was stationary, so we keep the first photo and mark the rest
    redundant. When a photo moves beyond the tolerance the run ends and that
    photo becomes the next anchor.
    """
    redundant: list = []

    def flush(cluster: list) -> None:
        if len(cluster) >= MIN_STATIONARY_CLUSTER:
            redundant.extend(row["id"] for row in cluster[1:])

    anchor = rows[0]
    cluster = [anchor]
    for row in rows[1:]:
        moved = _distance_meters(anchor["lat"], anchor["lon"], row["lat"], row["lon"])
        if moved <= TOLERANCE_METERS:
            cluster.append(row)
        else:
            flush(cluster)
            anchor = row
            cluster = [row]
    flush(cluster)

    return redundant


async def mark_and_remove_stationary_imagery(
    db: Connection, project_id: UUID, batch_id: UUID | None, task_id: UUID
) -> None:
    """Reject near-duplicate photos taken while the drone was stationary.

    Users sometimes forget to stop the interval timer at the end of a mission,
    so the drone keeps shooting while it hovers on the final waypoint. Those
    frames are all the same shot and add nothing to the ortho, so we keep the
    first and reject the rest.

    Args:
        db: Database connection.
        project_id: Project ID.
        batch_id: Batch ID (None to process images without a batch).
        task_id: Task ID.
    """
    params: dict = {
        "project_id": project_id,
        "task_id": task_id,
        "status": ImageStatus.ASSIGNED.value,
    }

    # Handle NULL batch_id: use IS NULL instead of = to match images that were
    # uploaded without a batch grouping.
    if batch_id is not None:
        batch_filter = "AND batch_id = %(batch_id)s"
        params["batch_id"] = batch_id
    else:
        batch_filter = "AND batch_id IS NULL"

    sql = f"""
        SELECT
            id,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lon,
            COALESCE(
                to_timestamp(exif->>'DateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')::timestamptz,
                uploaded_at
            ) AS sort_ts
        FROM project_images
        WHERE project_id = %(project_id)s
          {batch_filter}
          AND task_id = %(task_id)s
          AND status = %(status)s
          AND rejection_reason IS NULL
          AND location IS NOT NULL
        ORDER BY sort_ts ASC, uploaded_at ASC, id ASC;
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()

    if len(rows) < MIN_STATIONARY_CLUSTER:
        return

    redundant_ids = _find_stationary_duplicates(rows)
    if redundant_ids:
        log.info(
            f"Stationary detection for task {task_id}: "
            f"rejecting {len(redundant_ids)} of {len(rows)} photos"
        )
        await reject_assigned_images(
            db,
            redundant_ids,
            f"Redundant photo: drone stationary at same location "
            f"(within {TOLERANCE_METERS:.0f}m of an earlier photo in the sequence).",
        )
