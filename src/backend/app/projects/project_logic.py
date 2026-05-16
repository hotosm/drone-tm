import asyncio
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, Optional
from urllib.parse import urlunparse

import aiohttp
import geojson
import pyproj
import shapely.wkb as wkblib
from arq import ArqRedis
from fastapi import HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from geojson import Feature, FeatureCollection
from loguru import logger as log
from minio.error import S3Error
from psycopg import Connection
from psycopg.rows import dict_row
from shapely.errors import GEOSException
from shapely.geometry import shape
from shapely.ops import transform

from drone_flightplan import (
    add_elevation_from_dem,
    calculate_parameters,
    create_placemarks,
    terrain_following_waylines,
    create_waypoint,
)
from drone_flightplan.enums import FlightMode

from app.config import settings
from app.models.enums import FinalOutput, ImageProcessingStatus, OAMUploadStatus, State
from app.projects import project_schemas
from app.images.image_processing import (
    ScaleOdmSubmitError,
    submit_scaleodm_task,
)
from app.s3 import (
    s3_client,
    add_obj_to_bucket,
    maybe_presign_s3_key,
    get_file_from_bucket,
    get_object_metadata,
    s3_object_exists,
)
from app.tasks.task_splitter import (
    GeometryTopologyError,
    GeometryValidationError,
    split_by_square,
)
from app.tasks import task_logic
from app.utils import (
    calculate_flight_time_from_placemarks,
    merge_multipolygon,
    timestamp,
)


ODM_STATUS_LABELS = {
    10: "Queued",
    20: "Running",
    30: "Failed",
    40: "Completed",
    50: "Canceled",
}


def parse_odm_status(raw_status) -> tuple[int, str]:
    """Parse an ODM status field into (status_code, status_label).

    ScaleODM preserves the NodeODM payload shape: status is either an
    object like ``{"code": 20}`` or a plain integer. We normalise both
    forms into an ``(int, str)`` pair.
    """
    if isinstance(raw_status, dict):
        code = raw_status.get("code", 0)
    elif isinstance(raw_status, (int, float)):
        code = int(raw_status)
    else:
        code = 0
    label = ODM_STATUS_LABELS.get(code, f"Unknown ({code})")
    return code, label


def extract_valid_odm_task_info(payload: dict | None) -> dict | None:
    """Return only real ODM task info payloads.

    ScaleODM (like NodeODM) can return HTTP 200 with an error JSON for
    deleted tasks, e.g. ``{"error": "<uuid> not found"}``. Those payloads
    should be treated as missing so the DB-backed fallback logic can
    classify the task.
    """
    if not isinstance(payload, dict):
        return None

    raw_status = payload.get("status")
    if isinstance(raw_status, dict) and "code" in raw_status:
        return payload
    if isinstance(raw_status, (int, float)):
        return payload

    return None


async def get_project_odm_endpoint(db: Connection, project_id: uuid.UUID) -> str:
    """Return the ODM endpoint persisted for a project, falling back to config."""
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT odm_endpoint_used FROM projects WHERE id = %(pid)s",
            {"pid": project_id},
        )
        row = await cur.fetchone()
    if row and row.get("odm_endpoint_used"):
        return row["odm_endpoint_used"]
    return settings.ODM_ENDPOINT


async def check_s3_for_odm_orthophoto_and_enqueue(
    redis_pool: ArqRedis,
    scaleodm_url: str,
    project_id: uuid.UUID,
    odm_task_uuid: Optional[str],
    *,
    task_id=None,
) -> bool | None:
    """Check S3 for a completed ODM orthophoto and enqueue finalization if found.

    Returns:
      True  - orthophoto found in S3; finalize job enqueued.
      False - orthophoto definitively absent; caller should mark task FAILED.
      None  - S3 check timed out or errored; caller should keep task STARTED
              and retry on the next reconciliation poll.

    Pass task_id for per-task ODM runs; omit it for project-level runs.
    """
    if task_id is not None:
        s3_key = (
            f"projects/{project_id}/{task_id}/odm/odm_orthophoto/odm_orthophoto.tif"
        )
        job_id = f"odm-assets:task:{task_id}"
        extra_kwargs: dict = {
            "state_name": State.IMAGE_PROCESSING_STARTED.name,
            "dtm_task_id": str(task_id),
        }
    else:
        s3_key = f"projects/{project_id}/odm/odm_orthophoto/odm_orthophoto.tif"
        job_id = f"odm-assets:project:{project_id}"
        extra_kwargs = {}

    try:
        found = await asyncio.wait_for(
            asyncio.to_thread(s3_object_exists, settings.S3_BUCKET_NAME, s3_key),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        log.warning(
            "S3 orthophoto check timed out (project={} task={}): will retry next poll",
            project_id,
            task_id,
        )
        return None
    except Exception as err:
        log.warning(
            "S3 orthophoto check failed (project={} task={}): {}: will retry next poll",
            project_id,
            task_id,
            err,
        )
        return None

    if not found:
        return False

    await redis_pool.enqueue_job(
        "finalize_scaleodm_task",
        scaleodm_url=scaleodm_url,
        dtm_project_id=str(project_id),
        odm_task_uuid=odm_task_uuid,
        odm_status_code=40,
        message="Reconciled: orthophoto found in S3 after ScaleODM record lost",
        **extra_kwargs,
        _job_id=job_id,
        _queue_name="default_queue",
    )
    return True


async def project_level_odm_output_exists(project_id: uuid.UUID) -> bool | None:
    """Check S3 for the project-level ODM orthophoto.

    Returns True/False on definitive result, None on timeout or error.
    """
    s3_key = f"projects/{project_id}/odm/odm_orthophoto/odm_orthophoto.tif"
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(s3_object_exists, settings.S3_BUCKET_NAME, s3_key),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        log.warning("S3 project orthophoto check timed out (project={})", project_id)
        return None
    except Exception as err:
        log.warning(
            "S3 project orthophoto check failed (project={}): {}", project_id, err
        )
        return None


async def mark_project_level_odm_success_from_refresh(
    db: Connection, project_id: uuid.UUID, *, reason: str
) -> dict:
    """Mark a completed project-level ODM run successful during manual refresh.

    Project-level finalization does not need the task-level reprojection step,
    so the user-triggered reconciliation path can safely update the project
    status directly once the final output is known to be complete.
    """
    await update_processing_status(db, project_id, ImageProcessingStatus.SUCCESS)
    odm_assets_url = f"{settings.API_PREFIX}/projects/odm/export/{project_id}/"
    await db.execute(
        "UPDATE projects SET output_odm_assets_url = %(url)s WHERE id = %(pid)s",
        {"url": odm_assets_url, "pid": project_id},
    )
    await db.commit()
    log.warning(
        "Reconciled project-level ODM success on refresh: project={} reason={}",
        project_id,
        reason,
    )
    return {
        "queued": 0,
        "running": 0,
        "failed": 0,
        "completed": 1,
        "total": 1,
        "groups": [],
    }


async def reconcile_project_level_odm(
    db: Connection,
    project: "project_schemas.DbProject",
    odm_url: str,
    parsed_url,
    odm_query: str,
    redis_pool: ArqRedis,
    not_found_age_sec: int,
) -> dict:
    """Fetch and reconcile the single project-level ScaleODM task status.

    Returns a dict with keys matching OdmQueueInfo counts + groups.
    """
    empty = {
        "queued": 0,
        "running": 0,
        "failed": 0,
        "completed": 0,
        "total": 0,
        "groups": [],
    }

    project_odm_uuid = getattr(project, "odm_task_uuid", None)
    project_status = getattr(project, "image_processing_status", None)

    if project_status not in {"PROCESSING", "FAILED"}:
        return empty

    # Fetch project age once - reused across multiple paths below.
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT last_updated FROM projects WHERE id = %(pid)s",
            {"pid": project.id},
        )
        row = await cur.fetchone()

    def _age_sec() -> float | None:
        if not (row and row.get("last_updated")):
            return None
        entered = row["last_updated"]
        if entered.tzinfo is None:
            entered = entered.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - entered).total_seconds()

    def _running(label: str = "Running") -> dict:
        entry = project_schemas.OdmQueueTask(
            uuid=project_odm_uuid or str(project.id),
            name=f"Project {project.id}",
            status_code=20,
            status_label=label,
        )
        return {
            "running": 1,
            "queued": 0,
            "failed": 0,
            "completed": 0,
            "total": 1,
            "groups": [
                project_schemas.OdmStatusGroup(
                    status_code=20, status_label="Running", count=1, tasks=[entry]
                )
            ],
        }

    def _failed(label: str = "Failed (lost)") -> dict:
        entry = project_schemas.OdmQueueTask(
            uuid=project_odm_uuid or str(project.id),
            name=f"Project {project.id}",
            status_code=30,
            status_label=label,
        )
        return {
            "running": 0,
            "queued": 0,
            "failed": 1,
            "completed": 0,
            "total": 1,
            "groups": [
                project_schemas.OdmStatusGroup(
                    status_code=30, status_label="Failed", count=1, tasks=[entry]
                )
            ],
        }

    if not project_odm_uuid:
        # UUID was never written - submission likely failed between the two DB commits.
        s3_result = await project_level_odm_output_exists(project.id)
        if project_status == "PROCESSING":
            if s3_result is True:
                return await mark_project_level_odm_success_from_refresh(
                    db, project.id, reason="output found in S3 without ODM UUID"
                )
            if s3_result is None:
                return _running("Running (S3 check pending)")
            age = _age_sec()
            if age is not None and age >= not_found_age_sec:
                try:
                    await update_processing_status(
                        db, project.id, ImageProcessingStatus.FAILED
                    )
                    log.warning(
                        "project={} FAILED: no UUID, no S3 output, age={}s",
                        project.id,
                        int(age),
                    )
                except Exception as e:
                    log.error("Failed to mark project FAILED (no UUID): {}", e)
        return empty

    # Fetch live status from ScaleODM.
    path = f"{parsed_url.path.rstrip('/')}/task/{project_odm_uuid}/info"
    info_url = urlunparse(
        (parsed_url.scheme, parsed_url.netloc, path, "", odm_query, "")
    )

    odm_info = None
    fetch_failed = False
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=15)
        ) as session:
            async with session.get(info_url) as resp:
                if resp.status == 200:
                    odm_info = extract_valid_odm_task_info(await resp.json())
                elif resp.status != 404:
                    fetch_failed = True
    except Exception as e:
        log.warning(
            "ScaleODM fetch failed for project-level task {}: {}", project_odm_uuid, e
        )
        fetch_failed = True

    if fetch_failed:
        # Transient network error - keep showing as running.
        # Permanently unreachable ScaleODM requires a manual operator action;
        # auto-failing here would risk killing legitimate long-running jobs on
        # a single network blip.
        return _running("Running (status pending)")

    if odm_info:
        status_code, status_label = parse_odm_status(odm_info.get("status"))

        if status_code == 40:
            return await mark_project_level_odm_success_from_refresh(
                db, project.id, reason="ScaleODM reported completed"
            )

        if status_code in (30, 50):
            # Mark FAILED immediately - don't depend on ARQ being live.
            # Still enqueue finalize for error-detail capture and ScaleODM record cleanup.
            try:
                await update_processing_status(
                    db, project.id, ImageProcessingStatus.FAILED
                )
            except Exception as e:
                log.error(
                    "Failed to mark project FAILED on ODM {}: {}", status_label, e
                )
            scaleodm_endpoint = (
                getattr(project, "odm_endpoint_used", None) or settings.ODM_ENDPOINT
            )
            await redis_pool.enqueue_job(
                "finalize_scaleodm_task",
                scaleodm_url=scaleodm_endpoint,
                dtm_project_id=str(project.id),
                odm_task_uuid=project_odm_uuid,
                odm_status_code=30,
                _job_id=f"odm-assets:project:{project.id}",
                _queue_name="default_queue",
            )
            log.warning(
                "project={} ODM {} - marked FAILED, cleanup enqueued",
                project.id,
                status_label,
            )
            display_label = "Failed (canceled)" if status_code == 50 else status_label
            task_entry = project_schemas.OdmQueueTask(
                uuid=project_odm_uuid,
                name=f"Project {project.id}",
                status_code=30,
                status_label=display_label,
                images_count=odm_info.get("imagesCount"),
                processing_time=odm_info.get("processingTime"),
            )
            return {
                "running": 0,
                "queued": 0,
                "failed": 1,
                "completed": 0,
                "total": 1,
                "groups": [
                    project_schemas.OdmStatusGroup(
                        status_code=30,
                        status_label="Failed",
                        count=1,
                        tasks=[task_entry],
                    )
                ],
            }

        task_entry = project_schemas.OdmQueueTask(
            uuid=project_odm_uuid,
            name=odm_info.get("name") or f"Project {project.id}",
            status_code=status_code,
            status_label=status_label,
            images_count=odm_info.get("imagesCount"),
            progress=odm_info.get("progress"),
            date_created=odm_info.get("dateCreated"),
            processing_time=odm_info.get("processingTime"),
        )
        bucket = (
            "running"
            if status_code == 20
            else "queued"
            if status_code == 10
            else "failed"
        )
        result = {
            "running": 0,
            "queued": 0,
            "failed": 0,
            "completed": 0,
            "total": 1,
            "groups": [],
        }
        result[bucket] = 1
        result["groups"] = [
            project_schemas.OdmStatusGroup(
                status_code=status_code,
                status_label=ODM_STATUS_LABELS.get(status_code, status_label),
                count=1,
                tasks=[task_entry],
            )
        ]
        return result

    # ScaleODM returned 404 - age-guard before S3 check.
    age = _age_sec()
    if age is not None and age < not_found_age_sec:
        return _running("Running (awaiting ScaleODM registration)")

    scaleodm_endpoint = (
        getattr(project, "odm_endpoint_used", None) or settings.ODM_ENDPOINT
    )
    recovered = await check_s3_for_odm_orthophoto_and_enqueue(
        redis_pool, scaleodm_endpoint, project.id, project_odm_uuid
    )

    if recovered is True:
        # Output is in S3 - no reprojection needed for project-level runs.
        # Commit success directly; enqueued finalize handles ScaleODM cleanup.
        return await mark_project_level_odm_success_from_refresh(
            db, project.id, reason="output found in S3 after ScaleODM 404"
        )

    if recovered is None:
        return _running("Running (S3 check pending)")

    try:
        await update_processing_status(db, project.id, ImageProcessingStatus.FAILED)
        log.warning(
            "project={} odm_uuid={} FAILED: not on ScaleODM, no S3 output",
            project.id,
            project_odm_uuid,
        )
    except Exception as e:
        log.error("Failed to reconcile lost project-level task: {}", e)
    return _failed()


async def get_centroids(db: Connection):
    try:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                    p.id,
                    p.slug,
                    p.name,
                    ST_AsGeoJSON(p.centroid)::jsonb AS centroid,
                    COUNT(t.id) AS total_task_count,
                    COUNT(CASE WHEN te.state::text IN ('LOCKED', 'AWAITING_APPROVAL', 'READY_FOR_PROCESSING', 'HAS_ISSUES', 'IMAGE_PROCESSING_STARTED') THEN 1 END) AS ongoing_task_count,
                    COUNT(CASE WHEN te.state::text = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) AS completed_task_count
                FROM
                    projects p
                LEFT JOIN
                    tasks t ON p.id = t.project_id
                LEFT JOIN
                    task_events te ON t.id = te.task_id
                GROUP BY
                    p.id, p.slug, p.name, p.centroid;
            """
            )
            centroids = await cur.fetchall()

            if not centroids:
                return []

            return centroids

    except Exception as e:
        log.error(f"Error during reading centroids: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def upload_file_to_s3(
    project_id: uuid.UUID, file: UploadFile, file_name: str
) -> str:
    """Upload a file (image or DEM) to S3.

    Args:
        project_id (uuid.UUID): The project ID in the database.
        file (UploadFile): The file to be uploaded.
        folder (str): The folder name in the S3 bucket.
        file_extension (str): The file extension (e.g., 'png', 'tif').

    Returns:
        str: The S3 URL for the uploaded file.
    """
    # Define the S3 file path
    file_path = f"projects/{project_id}/{file_name}"

    # Read the file bytes
    file_bytes = await file.read()
    file_obj = BytesIO(file_bytes)

    # Upload the file to the S3 bucket
    add_obj_to_bucket(
        settings.S3_BUCKET_NAME,
        file_obj,
        file_path,
        file.content_type,
    )

    # Return a browser-usable URL.
    return maybe_presign_s3_key(file_path, expires_hours=2)


async def update_project_oam_status(
    db: Connection, project_id: uuid.UUID, status: OAMUploadStatus
):
    """Update the OAM status for a project."""
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET oam_upload_status = %s
            WHERE id = %s
            """,
            (status.name, project_id),
        )
    await db.commit()
    return True


async def update_url(db: Connection, project_id: uuid.UUID, url: str):
    """Update the URL (DEM or image) for a project in the database.

    Args:
        db (Connection): The database connection.
        project_id (uuid.UUID): The project ID in the database.
        url (str): The URL to be updated.
        url_type (str): The column name for the URL (e.g., 'dem_url', 'image_url').

    Returns:
        bool: True if the update was successful.
    """
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET dem_url = %(url)s
            WHERE id = %(project_id)s""",
            {"url": url, "project_id": project_id},
        )

    return True


async def update_task_metrics(db, task_updates):
    """Update task metrics asynchronously."""
    async with db.cursor() as cur:
        await cur.executemany(
            """
            UPDATE tasks
            SET total_area_sqkm = %s, flight_time_minutes = %s, flight_distance_km = %s
            WHERE id = %s
            """,
            task_updates,
        )
        log.debug(f"Updated {len(task_updates)} tasks with flight metrics")
    await db.commit()


async def process_task_metrics(db, tasks_data, project):
    """Process flight metrics and update tasks."""
    task_updates = []
    for task in tasks_data:
        task_id, project_id, outline, index = task[:4]
        geom = shape(wkblib.loads(outline))

        proj_wgs84 = pyproj.CRS("EPSG:4326")
        proj_mercator = pyproj.CRS("EPSG:3857")
        project_transformer = pyproj.Transformer.from_crs(
            proj_wgs84, proj_mercator, always_xy=True
        )
        transformed_geom = transform(project_transformer.transform, geom)
        total_area_sqkm = transformed_geom.area / 1_000_000

        forward_overlap = project.front_overlap or 70
        side_overlap = project.side_overlap or 70
        gsd = project.gsd_cm_px
        altitude = project.altitude_from_ground

        if altitude is None or gsd is None:
            task_updates.append((total_area_sqkm, None, None, task_id))
            continue

        parameters = calculate_parameters(
            forward_overlap, side_overlap, altitude, gsd, 2
        )
        waypoint_params = {
            "project_area": FeatureCollection([Feature(geometry=geom)]),
            "agl": altitude,
            "gsd": gsd,
            "forward_overlap": forward_overlap,
            "side_overlap": side_overlap,
            "rotation_angle": 0,
            "generate_3d": False,
            "mode": FlightMode.WAYPOINTS,
        }

        if project.is_terrain_follow:
            dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"
            points = create_waypoint(**waypoint_params)
            try:
                get_file_from_bucket(
                    settings.S3_BUCKET_NAME,
                    f"projects/{project.id}/dem.tif",
                    dem_path,
                )
                outfile_with_elevation = "/tmp/output_file_with_elevation.geojson"
                add_elevation_from_dem(dem_path, points, outfile_with_elevation)
                with open(outfile_with_elevation) as inpointsfile:
                    points_with_elevation = inpointsfile.read()
            except Exception:
                points_with_elevation = points

            if (
                isinstance(points_with_elevation, dict)
                and "geojson" in points_with_elevation
            ):
                points_str = points_with_elevation["geojson"]
            else:
                points_str = points_with_elevation

            placemarks = create_placemarks(geojson.loads(points_str), parameters)
        else:
            points = create_waypoint(**waypoint_params)
            if isinstance(points, dict) and "geojson" in points:
                points_str = points["geojson"]
            else:
                points_str = points
            placemarks = create_placemarks(geojson.loads(points_str), parameters)

        flight_metrics = calculate_flight_time_from_placemarks(placemarks)
        flight_time_minutes = flight_metrics.get("total_flight_time")
        flight_distance_km = flight_metrics.get("flight_distance_km")

        task_updates.append(
            (total_area_sqkm, flight_time_minutes, flight_distance_km, task_id)
        )

    if task_updates:
        await update_task_metrics(db, task_updates)


async def create_tasks_from_geojson(
    db,
    project_id: uuid.UUID,
    boundaries: Any,
    project,
    redis=None,
):
    """Create tasks and enqueue task metric processing asynchronously."""
    try:
        if isinstance(boundaries, str):
            boundaries = json.loads(boundaries)
        polygons = (
            [boundaries] if boundaries["type"] == "Feature" else boundaries["features"]
        )
        log.debug(f"Processing {len(polygons)} task geometries")

        tasks_data = []
        for index, polygon in enumerate(polygons):
            if not polygon.get("geometry"):
                continue

            geom = shape(polygon["geometry"])
            task_id = str(uuid.uuid4())
            tasks_data.append(
                (task_id, project_id, wkblib.dumps(geom, hex=True), index + 1)
            )

        if tasks_data:
            async with db.cursor() as cur:
                await cur.executemany(
                    """
                    INSERT INTO tasks (id, project_id, outline, project_task_index)
                    VALUES (%s, %s, %s, %s)
                    """,
                    tasks_data,
                )
                log.debug(f"Inserted {len(tasks_data)} tasks in bulk")
            await db.commit()

            if redis:
                job = await redis.enqueue_job(
                    "process_project_task_metrics",
                    str(project_id),
                    _queue_name="default_queue",
                )
                log.info(
                    f"Queued task metrics job {job.job_id} for project {project_id}"
                )
            else:
                log.warning(
                    "Project {} task metrics enqueue skipped (Redis unavailable)",
                    project_id,
                )

        return {
            "message": "Task creation started, metrics will be updated in the background"
        }
    except Exception as e:
        log.exception(e)
        raise HTTPException(e) from e


async def preview_split_by_square(db, boundary, meters: int):
    async with db.cursor() as cur:
        await cur.execute(

    """Preview split by square for a project boundary.

    Use a lambda function to remove the "z" dimension from each
    coordinate in the feature's geometry.
    """
    boundary = merge_multipolygon(boundary)

    try:
        return await run_in_threadpool(
            lambda: split_by_square(
                boundary,
                meters=meters,
            )
        )
    except (GeometryValidationError, GeometryTopologyError, GEOSException) as e:
        raise HTTPException(
            status_code=422,
            ...,
        ) from e
            detail="Invalid geometry for split preview. Please fix AOI or no-fly zone geometry and retry.",
        ) from e


async def process_drone_images(
    ctx: Dict[Any, Any],
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: str,
    odm_url: Optional[str] = None,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Submit a per-task ScaleODM run.

    NOTE: **_kwargs absorbs extra keys (e.g. ``_carrier``) that OpenTelemetry's
    now-removed ArqInstrumentor injected into job payloads stored in Redis.
    Without it, stale jobs enqueued before the instrumentor was removed crash
    with ``TypeError: got an unexpected keyword argument '_carrier'``.
    All other ARQ worker functions use **_kwargs for the same reason.
    """
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting process_drone_images (Job ID: {job_id})")

    try:
        pool = ctx["db_pool"]
        async with pool.connection() as conn:
            # Update task state to IMAGE_PROCESSING_STARTED first, so that any
            # failure below can be correctly transitioned to IMAGE_PROCESSING_FAILED.
            # Support fresh processing (READY_FOR_PROCESSING), retries from failure
            # (IMAGE_PROCESSING_FAILED), and reruns after completion
            # (IMAGE_PROCESSING_FINISHED) when new imagery has been verified.
            result = await task_logic.update_task_state_system(
                conn,
                project_id,
                task_id,
                "ODM processing started",
                State.READY_FOR_PROCESSING,
                State.IMAGE_PROCESSING_STARTED,
                timestamp(),
            )
            if result is None:
                result = await task_logic.update_task_state_system(
                    conn,
                    project_id,
                    task_id,
                    "ODM processing retry",
                    State.IMAGE_PROCESSING_FAILED,
                    State.IMAGE_PROCESSING_STARTED,
                    timestamp(),
                )
            if result is None:
                result = await task_logic.update_task_state_system(
                    conn,
                    project_id,
                    task_id,
                    "ODM processing rerun",
                    State.IMAGE_PROCESSING_FINISHED,
                    State.IMAGE_PROCESSING_STARTED,
                    timestamp(),
                )
            if result is None:
                raise RuntimeError(
                    "Cannot start processing: task is not in a valid state "
                    "(expected READY_FOR_PROCESSING, IMAGE_PROCESSING_FAILED, "
                    "or IMAGE_PROCESSING_FINISHED)"
                )
            log.info(
                f"Task {task_id} state set to IMAGE_PROCESSING_STARTED (pending commit)"
            )

            await conn.commit()

            scaleodm_endpoint = odm_url or settings.ODM_ENDPOINT
            log.info(f"Using ScaleODM endpoint: {scaleodm_endpoint}")

            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT gsd_cm_px FROM projects WHERE id = %(project_id)s",
                    {"project_id": project_id},
                )
                proj_row = await cur.fetchone()
            gsd = proj_row["gsd_cm_px"] if proj_row and proj_row["gsd_cm_px"] else 5

            options = [
                {"name": "fast-orthophoto", "value": True},
                # NOTE deletes large intermediate files after processed
                # reducing disk space requirements
                # {"name": "optimize-disk-space", "value": True},
                {"name": "orthophoto-resolution", "value": gsd},
            ]

            read_s3_path = f"s3://{settings.S3_BUCKET_NAME}/projects/{project_id}/{task_id}/images/"
            write_s3_path = (
                f"s3://{settings.S3_BUCKET_NAME}/projects/{project_id}/{task_id}/odm/"
            )

            odm_uuid = await submit_scaleodm_task(
                scaleodm_url=scaleodm_endpoint,
                read_s3_path=read_s3_path,
                write_s3_path=write_s3_path,
                name=f"DTM-Task-{task_id}",
                options=options,
                processing_mode="standard",
                s3_scan_depth=0,
                use_default_excludes=True,
                exclude_paths=["*/thumbs/*"],
                s3_endpoint=settings.SCALEODM_S3_ENDPOINT,
            )

            await update_task_field(
                conn, project_id, task_id, "odm_task_uuid", odm_uuid
            )
            await conn.commit()
            log.info(f"Stored ScaleODM task UUID {odm_uuid} for task {task_id}")

            return {
                "job_id": job_id,
                "project_id": str(project_id),
                "task_id": str(task_id),
                "status": "processing_started",
                "odm_task_uuid": odm_uuid,
            }

    except Exception as e:
        failure_message = str(e).strip() or e.__class__.__name__
        if (
            isinstance(e, ScaleOdmSubmitError)
            and "Not enough images" in failure_message
        ):
            failure_message = (
                "Not enough images for ODM processing. "
                "At least 3 task images are required."
            )

        try:
            pool = ctx["db_pool"]
            async with pool.connection() as conn:
                await task_logic.update_task_state_system(
                    conn,
                    project_id,
                    task_id,
                    failure_message,
                    State.IMAGE_PROCESSING_STARTED,
                    State.IMAGE_PROCESSING_FAILED,
                    timestamp(),
                )
                await conn.commit()
                log.info(
                    f"Task {task_id} state updated to IMAGE_PROCESSING_FAILED: "
                    f"{failure_message}"
                )
        except Exception as state_error:
            log.error(
                f"Failed to persist processing failure state for task {task_id}: "
                f"{state_error}"
            )

        log.error(
            f"Error in process_drone_images (Job ID: {job_id}): {failure_message}"
        )
        raise


async def update_processing_status(
    db: Connection, project_id: uuid.UUID, status: ImageProcessingStatus
):
    """Update the processing status in the database.

    On SUCCESS, clears odm_task_uuid and odm_endpoint_used so stale
    metadata doesn't interfere with future reconciliation.
    """
    log.debug(f"status = {status.name}")
    if status == ImageProcessingStatus.SUCCESS:
        await db.execute(
            """
            UPDATE projects
            SET image_processing_status = %(status)s,
                odm_task_uuid = NULL,
                odm_endpoint_used = NULL
            WHERE id = %(project_id)s;
            """,
            {"status": status.name, "project_id": project_id},
        )
    else:
        await db.execute(
            """
            UPDATE projects
            SET image_processing_status = %(status)s
            WHERE id = %(project_id)s;
            """,
            {"status": status.name, "project_id": project_id},
        )
    await db.commit()
    return


async def process_all_drone_images(
    ctx: Dict[Any, Any],
    project_id: uuid.UUID,
    tasks: list,
    user_id: str,
    capacity_type: Optional[str] = None,
    **_kwargs: Any,
):
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting process_drone_images_for_a_project (Job ID: {job_id})")

    try:
        pool = ctx["db_pool"]
        async with pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT final_output, gsd_cm_px FROM projects WHERE id = %(project_id)s",
                    {"project_id": project_id},
                )
                row = await cur.fetchone()
            requested_outputs = row["final_output"] or [] if row else []
            gsd = row["gsd_cm_px"] if row and row["gsd_cm_px"] else 5

            options = [{"name": "orthophoto-resolution", "value": gsd}]
            if FinalOutput.DIGITAL_SURFACE_MODEL in requested_outputs:
                options.append({"name": "dsm", "value": True})
            if FinalOutput.DIGITAL_TERRAIN_MODEL in requested_outputs:
                options.append({"name": "dtm", "value": True})

            # Project-wide submission: scan under projects/{pid}/ deep enough
            # to include {tid}/images/file (3 levels: {tid}/ → images/ → file).
            # Exclude user-uploads/ entirely (staging area, not inputs) and
            # thumb_* filenames so DroneTM-generated thumbnails are never fed
            # to ODM regardless of where they reside.
            read_s3_path = f"s3://{settings.S3_BUCKET_NAME}/projects/{project_id}/"
            write_s3_path = f"s3://{settings.S3_BUCKET_NAME}/projects/{project_id}/odm/"

            odm_uuid = await submit_scaleodm_task(
                scaleodm_url=settings.ODM_ENDPOINT,
                read_s3_path=read_s3_path,
                write_s3_path=write_s3_path,
                name=f"DTM-Project-{project_id}",
                options=options,
                processing_mode="standard",
                s3_scan_depth=3,
                use_default_excludes=True,
                exclude_paths=[
                    "*/thumbs/*",
                    "user-uploads/*",
                    "thumb_*",
                    "dem.tif",
                    "map_screenshot.png",
                    "odm/*",
                ],
                s3_endpoint=settings.SCALEODM_S3_ENDPOINT,
                capacity_type=capacity_type,
            )

            # Persist ODM metadata for reconciliation/recovery, then mark PROCESSING.
            # Overwrite on every new run so retries never reconcile against stale metadata.
            await conn.execute(
                """
                UPDATE projects
                SET odm_task_uuid = %(odm_uuid)s,
                    odm_endpoint_used = %(odm_endpoint)s,
                    image_processing_status = %(status)s,
                    last_updated = NOW()
                WHERE id = %(project_id)s;
                """,
                {
                    "odm_uuid": odm_uuid,
                    "odm_endpoint": settings.ODM_ENDPOINT,
                    "status": ImageProcessingStatus.PROCESSING.name,
                    "project_id": project_id,
                },
            )
            await conn.commit()
            log.info(f"Stored ScaleODM task UUID {odm_uuid} for project {project_id}")
            return

    except Exception as e:
        log.error(f"Error in process_all_drone_images (Job ID: {job_id}): {e}")
        try:
            pool = ctx["db_pool"]
            async with pool.connection() as conn:
                await conn.execute(
                    """
                    UPDATE projects
                    SET image_processing_status = %(status)s,
                        last_updated = NOW()
                    WHERE id = %(project_id)s;
                    """,
                    {
                        "status": ImageProcessingStatus.FAILED.name,
                        "project_id": project_id,
                    },
                )
                await conn.commit()
        except Exception:
            log.error(f"Failed to reset processing status for project {project_id}")
        raise


async def get_assets_info_bulk(
    db: Connection,
    project_id: uuid.UUID,
    task_ids: list[uuid.UUID],
) -> list[project_schemas.AssetsInfo]:
    """Bulk variant of per-task assets info gathering.

    Performs 2 SQL queries (image counts + latest task states) plus a
    single project-level orthophoto probe and per-task S3 probes run
    concurrently via ``asyncio.gather``. This collapses what was
    previously N x (3 S3 calls + 1 DB query) into ~2 DB queries plus
    a parallel batch of S3 lookups.
    """
    if not task_ids:
        return []

    task_id_strs = [str(t) for t in task_ids]

    image_counts: dict[str, int] = {}
    async with db.cursor() as cur:
        await cur.execute(
            """
            SELECT task_id::text, COUNT(*) AS cnt
            FROM project_images
            WHERE project_id = %(pid)s
              AND task_id = ANY(%(tids)s)
              AND status = 'assigned'
            GROUP BY task_id
            """,
            {"pid": str(project_id), "tids": task_id_strs},
        )
        for row in await cur.fetchall():
            image_counts[row[0]] = row[1]

    states: dict[str, str] = {}
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT DISTINCT ON (task_id)
                task_id::text AS task_id, state
            FROM task_events
            WHERE project_id = %(pid)s
              AND task_id = ANY(%(tids)s)
            ORDER BY task_id, created_at DESC
            """,
            {"pid": str(project_id), "tids": task_id_strs},
        )
        for row in await cur.fetchall():
            states[row["task_id"]] = row["state"]

    project_ortho_key = f"projects/{project_id}/odm/odm_orthophoto/odm_orthophoto.tif"

    def _probe_project_ortho() -> Optional[str]:
        try:
            get_object_metadata(settings.S3_BUCKET_NAME, project_ortho_key)
            return maybe_presign_s3_key(project_ortho_key, expires_hours=12)
        except S3Error as e:
            if e.code != "NoSuchKey":
                log.warning(f"Project ortho lookup failed: {e}")
            return None

    def _probe_task(task_id: uuid.UUID) -> tuple[uuid.UUID, bool, Optional[str]]:
        """Return (task_id, has_odm_output, task_level_ortho_url)."""
        try:
            odm_prefix = f"projects/{project_id}/{task_id}/odm/"
            has_odm = (
                next(
                    s3_client().list_objects(
                        settings.S3_BUCKET_NAME, prefix=odm_prefix, recursive=False
                    ),
                    None,
                )
                is not None
            )
        except S3Error as e:
            log.error(f"ODM probe failed for task {task_id}: {e}")
            has_odm = False

        task_ortho_key = (
            f"projects/{project_id}/{task_id}/odm/odm_orthophoto/odm_orthophoto.tif"
        )
        try:
            get_object_metadata(settings.S3_BUCKET_NAME, task_ortho_key)
            task_ortho_url = maybe_presign_s3_key(task_ortho_key, expires_hours=12)
        except S3Error as e:
            if e.code != "NoSuchKey":
                log.warning(f"Task ortho lookup failed for {task_id}: {e}")
            task_ortho_url = None

        return task_id, has_odm, task_ortho_url

    project_ortho_url, probe_results = await asyncio.gather(
        run_in_threadpool(_probe_project_ortho),
        asyncio.gather(*(run_in_threadpool(_probe_task, tid) for tid in task_ids)),
    )

    results: list[project_schemas.AssetsInfo] = []
    for tid, has_odm, task_ortho_url in probe_results:
        tid_str = str(tid)
        assets_url = (
            f"{settings.API_PREFIX}/projects/odm/export/{project_id}/{tid}/"
            if has_odm
            else None
        )
        results.append(
            project_schemas.AssetsInfo(
                project_id=str(project_id),
                task_id=tid_str,
                image_count=image_counts.get(tid_str, 0),
                assets_url=assets_url,
                orthophoto_url=task_ortho_url or project_ortho_url,
                state=states.get(tid_str),
            )
        )
    return results


async def check_regulator_project(db: Connection, project_id: str, email: str):
    sql = """
    SELECT id FROM projects WHERE
    id = %(project_id)s
    AND %(email)s = ANY(regulator_emails)
    AND regulator_comment IS NULL
    """
    async with db.cursor() as cur:
        await cur.execute(sql, {"project_id": project_id, "email": email})
        project = await cur.fetchone()
        return bool(project)


def generate_square_geojson(center_lat, center_lon, side_length_meters):
    transformer = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    transformer_back = pyproj.Transformer.from_crs(
        "EPSG:3857", "EPSG:4326", always_xy=True
    )

    center_x, center_y = transformer.transform(center_lon, center_lat)
    half_side = side_length_meters / 2

    corners_m = [
        (center_x - half_side, center_y - half_side),
        (center_x + half_side, center_y - half_side),
        (center_x + half_side, center_y + half_side),
        (center_x - half_side, center_y + half_side),
        (center_x - half_side, center_y - half_side),
    ]

    corners_lat_lon = [transformer_back.transform(x, y) for x, y in corners_m]

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [corners_lat_lon]},
            }
        ],
    }
    return geojson


async def get_processable_tasks_with_pending_transfer_count(
    project_id, db
) -> tuple[list[str], list[str], int]:
    """Return task ids eligible for project-wide processing.

    Returns a tuple of:
      - ready_task_ids: tasks in READY_FOR_PROCESSING state
      - has_imagery_task_ids: tasks in HAS_IMAGERY state (not yet marked ready)
      - pending_transfer_count: how many of the eligible tasks still have
        imagery being transferred
    """
    async with db.cursor() as cur:
        await cur.execute(
            """
            WITH latest_task_state AS (
                SELECT DISTINCT ON (te.task_id)
                    te.task_id,
                    te.state
                FROM task_events te
                JOIN tasks t ON t.id = te.task_id
                WHERE t.project_id = %(project_id)s
                ORDER BY te.task_id, te.created_at DESC
            ),
            ready_tasks AS (
                SELECT t.id, t.project_task_index
                FROM tasks t
                JOIN latest_task_state lts ON lts.task_id = t.id
                WHERE t.project_id = %(project_id)s
                  AND lts.state::text = 'READY_FOR_PROCESSING'
            ),
            has_imagery_tasks AS (
                SELECT t.id, t.project_task_index
                FROM tasks t
                JOIN latest_task_state lts ON lts.task_id = t.id
                WHERE t.project_id = %(project_id)s
                  AND lts.state::text = 'HAS_IMAGERY'
            ),
            all_eligible AS (
                SELECT id FROM ready_tasks
                UNION ALL
                SELECT id FROM has_imagery_tasks
            ),
            pending_eligible_tasks AS (
                SELECT DISTINCT ae.id
                FROM all_eligible ae
                JOIN project_images pi
                  ON pi.project_id = %(project_id)s
                 AND pi.task_id = ae.id
                WHERE pi.status = 'assigned'
                  AND pi.s3_key LIKE '%%user-uploads%%'
            )
            SELECT
                COALESCE(
                    ARRAY(
                        SELECT rt.id::text
                        FROM ready_tasks rt
                        ORDER BY rt.project_task_index
                    ),
                    ARRAY[]::text[]
                ) AS ready_task_ids,
                COALESCE(
                    ARRAY(
                        SELECT ht.id::text
                        FROM has_imagery_tasks ht
                        ORDER BY ht.project_task_index
                    ),
                    ARRAY[]::text[]
                ) AS has_imagery_task_ids,
                (SELECT COUNT(*) FROM pending_eligible_tasks) AS pending_transfer_count
            """,
            {"project_id": project_id},
        )
        row = await cur.fetchone()

    if not row:
        return [], [], 0

    ready_task_ids = list(row[0] or [])
    has_imagery_task_ids = list(row[1] or [])
    pending_transfer_count = int(row[2] or 0)
    return ready_task_ids, has_imagery_task_ids, pending_transfer_count


async def get_all_tasks_for_project(project_id, db):
    """Get all unique tasks associated with the project ID
    that are in state READY_FOR_PROCESSING.
    """
    ready_task_ids, _, _ = await get_processable_tasks_with_pending_transfer_count(
        project_id, db
    )
    return ready_task_ids


async def update_task_field(
    db: Connection,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    column: Any,
    value: Any,
):
    """Generic function to update a field(assets_url and total_image_count) in the tasks table."""
    async with db.cursor() as cur:
        await cur.execute(
            f"""
            UPDATE tasks
            SET {column} = %(value)s
            WHERE project_id = %(project_id)s AND id = %(task_id)s;
            """,
            {
                "value": value,
                "project_id": str(project_id),
                "task_id": str(task_id),
            },
        )
    return True


async def get_active_odm_tasks(db: Connection, project_id: uuid.UUID):
    """Return project tasks currently marked as ODM-processing with a stored ODM UUID."""
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            WITH latest_state AS (
                SELECT DISTINCT ON (te.task_id)
                    te.task_id,
                    te.state
                FROM task_events te
                ORDER BY te.task_id, te.created_at DESC
            )
            SELECT
                t.id,
                t.project_task_index,
                t.odm_task_uuid
            FROM tasks t
            JOIN latest_state ls ON ls.task_id = t.id
            WHERE
                t.project_id = %(project_id)s
                AND ls.state = 'IMAGE_PROCESSING_STARTED'
                AND t.odm_task_uuid IS NOT NULL
            ORDER BY t.project_task_index;
            """,
            {"project_id": project_id},
        )
        return await cur.fetchall()


async def process_waypoints_and_waylines(
    side_overlap: float,
    front_overlap: float,
    altitude_from_ground: float,
    gsd_cm_px: float,
    meters: float,
    boundary: dict,
    is_terrain_follow: bool,
    dem: UploadFile,
):
    """Processes and returns counts of waypoints and waylines.

    Args:
        boundary: A normalised FeatureCollection containing one Polygon
            feature (already parsed and merged by normalize_aoi).
    """
    geometry = shape(boundary["features"][0]["geometry"])
    centroid = geometry.centroid
    center_lon = centroid.x
    center_lat = centroid.y
    square_geojson = generate_square_geojson(center_lat, center_lon, meters)

    # Prepare common parameters for waypoint creation
    forward_overlap = front_overlap if front_overlap else 70
    side_overlap = side_overlap if side_overlap else 70
    parameters = calculate_parameters(
        forward_overlap,
        side_overlap,
        altitude_from_ground,
        gsd_cm_px,
        2,
    )
    waypoint_params = {
        "project_area": square_geojson,
        "agl": altitude_from_ground,
        "gsd": gsd_cm_px,
        "forward_overlap": forward_overlap,
        "side_overlap": side_overlap,
        "rotation_angle": 0,
        "generate_3d": False,  # TODO: For 3d imageries drone_flightplan package needs to be updated.
        "take_off_point": None,
    }
    count_data = {"waypoints": 0, "waylines": 0}

    if is_terrain_follow and dem:
        temp_dir = f"/tmp/{uuid.uuid4()}"
        dem_path = os.path.join(temp_dir, "dem.tif")

        try:
            os.makedirs(temp_dir, exist_ok=True)
            # Read DEM content into memory and write to the file
            file_content = await dem.read()
            with open(dem_path, "wb") as file:
                file.write(file_content)

            # Process waypoints with terrain-follow elevation
            waypoint_params["mode"] = FlightMode.WAYPOINTS
            points = create_waypoint(**waypoint_params)

            # Add elevation data to waypoints
            outfile_with_elevation = os.path.join(
                temp_dir, "output_file_with_elevation.geojson"
            )
            add_elevation_from_dem(dem_path, points, outfile_with_elevation)

            # Read the updated waypoints with elevation
            with open(outfile_with_elevation) as inpointsfile:
                points_with_elevation = inpointsfile.read()
                count_data["waypoints"] = len(
                    json.loads(points_with_elevation)["features"]
                )

            # Generate waylines from waypoints with elevation
            wayline_placemarks = create_placemarks(
                geojson.loads(points_with_elevation), parameters
            )

            placemarks = terrain_following_waylines.waypoints2waylines(
                wayline_placemarks, 5
            )
            count_data["waylines"] = len(placemarks["features"])

        except Exception as e:
            log.error(f"Error processing DEM: {e}")

        finally:
            # Cleanup temporary files and directory
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
        return count_data

    else:
        # Generate waypoints and waylines
        waypoint_params["mode"] = FlightMode.WAYPOINTS
        points = create_waypoint(**waypoint_params)
        count_data["waypoints"] = len(json.loads(points["geojson"])["features"])

        waypoint_params["mode"] = FlightMode.WAYLINES
        lines = create_waypoint(**waypoint_params)
        count_data["waylines"] = len(json.loads(lines["geojson"])["features"])

    return count_data
