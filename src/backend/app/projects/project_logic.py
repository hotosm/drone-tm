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
from pyodm.exceptions import NodeResponseError
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
from app.models.enums import ImageProcessingStatus, OAMUploadStatus, State
from app.projects import project_schemas
from app.images.image_processing import DroneImageProcessor
from app.s3 import (
    s3_client,
    add_obj_to_bucket,
    maybe_presign_s3_key,
    get_file_from_bucket,
    get_object_metadata,
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
    """Parse a NodeODM status field into (status_code, status_label).

    NodeODM returns status as an object like ``{"code": 20}`` or as a plain
    integer.  We normalise both forms into an ``(int, str)`` pair.
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
    """Return only real NodeODM task info payloads.

    NodeODM can return HTTP 200 with an error JSON for deleted tasks, for example
    ``{"error": "<uuid> not found"}``. Those payloads should be treated as
    missing task info so the DB-backed fallback logic can classify the task.
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


async def reconcile_project_level_odm(
    db: Connection,
    project: "project_schemas.DbProject",
    odm_url: str,
    parsed_url,
    odm_query: str,
    redis_pool: ArqRedis,
    not_found_age_sec: int,
) -> dict:
    """Handle queue-info for project-level ODM runs (no per-task ODM UUIDs).

    Fetches the single project-level ODM task status and reconciles:
    - Completed but webhook missed -> enqueue asset download
    - Failed/canceled -> mark project FAILED
    - Not found (age > threshold) -> mark project FAILED
    - Otherwise -> report current status

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
    if not project_odm_uuid or project_status != "PROCESSING":
        return empty

    # Fetch status from NodeODM
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
                else:
                    fetch_failed = True
    except Exception as e:
        log.warning(
            "Failed to fetch project-level ODM task info for {}: {}",
            project_odm_uuid,
            e,
        )
        fetch_failed = True

    if fetch_failed:
        # Can't reach NodeODM - show as running, don't reconcile.
        task_entry = project_schemas.OdmQueueTask(
            uuid=project_odm_uuid,
            name=f"Project {project.id}",
            status_code=20,
            status_label="Running (status pending)",
        )
        return {
            "running": 1,
            "queued": 0,
            "failed": 0,
            "completed": 0,
            "total": 1,
            "groups": [
                project_schemas.OdmStatusGroup(
                    status_code=20,
                    status_label="Running",
                    count=1,
                    tasks=[task_entry],
                )
            ],
        }

    if odm_info:
        status_code, status_label = parse_odm_status(odm_info.get("status"))

        if status_code == 40:
            # Completed but webhook was missed - enqueue asset download.
            node_odm_endpoint = (
                getattr(project, "odm_endpoint_used", None) or settings.ODM_ENDPOINT
            )
            await redis_pool.enqueue_job(
                "process_odm_webhook_assets",
                node_odm_url=node_odm_endpoint,
                dtm_project_id=str(project.id),
                odm_task_id=project_odm_uuid,
                odm_status_code=40,
                _job_id=f"odm-assets:project:{project.id}",
                _queue_name="default_queue",
            )
            log.warning(
                "Reconciling project-level completed ODM task (missed webhook): "
                "project={} odm_uuid={}",
                project.id,
                project_odm_uuid,
            )
            task_entry = project_schemas.OdmQueueTask(
                uuid=project_odm_uuid,
                name=f"Project {project.id}",
                status_code=20,
                status_label="Downloading assets (missed webhook)",
                images_count=odm_info.get("imagesCount"),
                progress=odm_info.get("progress"),
                date_created=odm_info.get("dateCreated"),
                processing_time=odm_info.get("processingTime"),
            )
            return {
                "running": 1,
                "queued": 0,
                "failed": 0,
                "completed": 0,
                "total": 1,
                "groups": [
                    project_schemas.OdmStatusGroup(
                        status_code=20,
                        status_label="Running",
                        count=1,
                        tasks=[task_entry],
                    )
                ],
            }

        if status_code in (30, 50):
            # Failed or canceled - mark project FAILED.
            try:
                await update_processing_status(
                    db, project.id, ImageProcessingStatus.FAILED
                )
                log.warning(
                    "Reconciled project-level ODM failure: project={} odm_uuid={} status={}",
                    project.id,
                    project_odm_uuid,
                    status_label,
                )
            except Exception as e:
                log.error("Failed to reconcile project ODM failure: {}", e)

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

        # Still running or queued
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

    # NodeODM responded but doesn't know this task (not found).
    # Apply the same age guard as task-level reconciliation.
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT last_updated FROM projects WHERE id = %(pid)s",
            {"pid": project.id},
        )
        row = await cur.fetchone()

    age_ok = True
    if row and row.get("last_updated"):
        entered = row["last_updated"]
        if entered.tzinfo is None:
            entered = entered.replace(tzinfo=timezone.utc)
        age_sec = (datetime.now(timezone.utc) - entered).total_seconds()
        age_ok = age_sec >= not_found_age_sec

    if age_ok:
        try:
            await update_processing_status(db, project.id, ImageProcessingStatus.FAILED)
            log.warning(
                "Reconciled project-level lost ODM task: project={} odm_uuid={} not found on NodeODM",
                project.id,
                project_odm_uuid,
            )
        except Exception as e:
            log.error("Failed to reconcile project-level lost task: {}", e)

        task_entry = project_schemas.OdmQueueTask(
            uuid=project_odm_uuid,
            name=f"Project {project.id}",
            status_code=30,
            status_label="Failed (lost)",
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

    # Too young to declare lost
    task_entry = project_schemas.OdmQueueTask(
        uuid=project_odm_uuid,
        name=f"Project {project.id}",
        status_code=20,
        status_label="Running (awaiting NodeODM registration)",
    )
    return {
        "running": 1,
        "queued": 0,
        "failed": 0,
        "completed": 0,
        "total": 1,
        "groups": [
            project_schemas.OdmStatusGroup(
                status_code=20,
                status_label="Running",
                count=1,
                tasks=[task_entry],
            )
        ],
    }


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


async def preview_split_by_square(boundary: str, meters: int):
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
    """Process drone images using ODM.

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

            # Initialize the processor with the database connection
            node_odm_endpoint = odm_url or settings.ODM_ENDPOINT
            log.info(f"Using NodeODM endpoint: {node_odm_endpoint}")
            processor = DroneImageProcessor(
                node_odm_url=node_odm_endpoint,
                project_id=project_id,
                task_id=task_id,
                user_id=user_id,
                db=conn,
                task_ids=None,
            )

            # Define processing options
            options = [
                {"name": "dsm", "value": True},
                {"name": "orthophoto-resolution", "value": 5},
            ]

            # Use public URL when processing on an external NodeODM, internal otherwise
            if odm_url:
                from urllib.parse import quote

                base_url = settings.PUBLIC_BASE_URL
                webhook_url = f"{base_url}/api/projects/odm/webhook/{project_id}/{task_id}/?odm_url={quote(odm_url, safe='')}"
            else:
                webhook_url = f"{settings.BACKEND_URL_INTERNAL}/api/projects/odm/webhook/{project_id}/{task_id}/"

            result = await processor.process_images_from_s3(
                settings.S3_BUCKET_NAME,
                name=f"DTM-Task-{task_id}",
                options=options,
                webhook=webhook_url,
            )

            await update_task_field(
                conn,
                project_id,
                task_id,
                "odm_task_uuid",
                str(result.uuid),
            )
            await conn.commit()
            log.info(f"Stored ODM task UUID {result.uuid} for task {task_id}")

            return {
                "job_id": job_id,
                "project_id": str(project_id),
                "task_id": str(task_id),
                "status": "processing_started",
                "result": result,
            }

    except Exception as e:
        failure_message = str(e).strip() or e.__class__.__name__
        if isinstance(e, NodeResponseError) and "Not enough images" in failure_message:
            failure_message = "Not enough images for ODM processing. At least 3 task images are required."

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
    **_kwargs: Any,
):
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting process_drone_images_for_a_project (Job ID: {job_id})")

    try:
        pool = ctx["db_pool"]
        async with pool.connection() as conn:
            # Initialize the processor
            processor = DroneImageProcessor(
                node_odm_url=settings.ODM_ENDPOINT,
                project_id=project_id,
                task_id=None,
                user_id=user_id,
                task_ids=tasks,
                db=conn,
            )

            # Define processing options
            options = [
                {"name": "dsm", "value": True},
                {"name": "orthophoto-resolution", "value": 5},
            ]
            webhook_url = (
                f"{settings.PUBLIC_BASE_URL}/api/projects/odm/webhook/{project_id}/"
            )
            result = await processor.process_images_for_all_tasks(
                settings.S3_BUCKET_NAME,
                name_prefix=f"DTM-Task-{project_id}",
                options=options,
                webhook=webhook_url,
            )
            if result is None or not getattr(result, "uuid", None):
                raise RuntimeError(
                    "ODM did not return a valid task object after submission"
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
                    "odm_uuid": str(result.uuid),
                    "odm_endpoint": settings.ODM_ENDPOINT,
                    "status": ImageProcessingStatus.PROCESSING.name,
                    "project_id": project_id,
                },
            )
            await conn.commit()
            log.info(f"Stored ODM task UUID {result.uuid} for project {project_id}")
            return

    except Exception as e:
        log.error(f"Error in process_all_drone_images (Job ID: {job_id}): {e}")
        raise


def get_project_info_from_s3(project_id: uuid.UUID, task_id: uuid.UUID):
    """Helper function to get ODM assets and orthophoto URLs for a task.

    Note: image_count is no longer derived from S3 listings. The caller
    is responsible for setting it from the database.
    """
    try:
        # Check for ODM assets under the odm/ prefix via a single-object probe.
        presigned_url = None
        odm_prefix = f"projects/{project_id}/{task_id}/odm/"
        try:
            odm_probe = next(
                s3_client().list_objects(
                    settings.S3_BUCKET_NAME, prefix=odm_prefix, recursive=False
                ),
                None,
            )
            if odm_probe is not None:
                presigned_url = (
                    f"{settings.API_PREFIX}/projects/odm/export/{project_id}/{task_id}/"
                )
        except S3Error as e:
            log.error(f"An error occurred while accessing assets: {e}")
            raise HTTPException(status_code=500, detail=str(e))

        # Generate a presigned URL for the orthophoto COG.  Prefer the
        # task-level file, fall back to a project-level ortho if the task
        # doesn't have its own (e.g. final project-wide processing).
        orthophoto_url = None
        try:
            candidates = [
                f"projects/{project_id}/{task_id}/odm/odm_orthophoto/odm_orthophoto.tif",
                f"projects/{project_id}/odm/odm_orthophoto/odm_orthophoto.tif",
            ]
            for path in candidates:
                try:
                    get_object_metadata(settings.S3_BUCKET_NAME, path)
                    orthophoto_url = maybe_presign_s3_key(path, expires_hours=12)
                    break
                except S3Error as e:
                    if e.code != "NoSuchKey":
                        raise
        except Exception as e:
            # Do not fail the whole endpoint if orthophoto is missing; just omit it.
            log.warning(f"Unable to generate orthophoto_url: {e}")
            orthophoto_url = None

        return project_schemas.AssetsInfo(
            project_id=str(project_id),
            task_id=str(task_id),
            image_count=0,  # Overridden by caller with DB count
            assets_url=presigned_url,
            orthophoto_url=orthophoto_url,
        )
    except Exception as e:
        log.exception(f"An error occurred while retrieving assets info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


async def get_ready_tasks_with_pending_transfer_count(
    project_id, db
) -> tuple[list[str], int]:
    """Return READY task ids and how many still have assigned user-uploads imagery."""
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
            pending_ready_tasks AS (
                SELECT DISTINCT rt.id
                FROM ready_tasks rt
                JOIN project_images pi
                  ON pi.project_id = %(project_id)s
                 AND pi.task_id = rt.id
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
                (SELECT COUNT(*) FROM pending_ready_tasks) AS pending_ready_count
            """,
            {"project_id": project_id},
        )
        row = await cur.fetchone()

    if not row:
        return [], 0

    ready_task_ids = list(row[0] or [])
    pending_ready_count = int(row[1] or 0)
    return ready_task_ids, pending_ready_count


async def get_all_tasks_for_project(project_id, db):
    """Get all unique tasks associated with the project ID
    that are in state READY_FOR_PROCESSING.
    """
    ready_task_ids, _ = await get_ready_tasks_with_pending_transfer_count(
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
