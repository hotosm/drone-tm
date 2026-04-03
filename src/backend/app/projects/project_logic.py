import json
import os
import shutil
import uuid
from io import BytesIO
from typing import Any, Dict, Optional

import geojson
import pyproj
import shapely.wkb as wkblib
from fastapi import HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from geojson import Feature, FeatureCollection
from loguru import logger as log
from minio.error import S3Error
from psycopg import Connection
from psycopg.rows import dict_row
from pyodm.exceptions import NodeResponseError
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
from app.images.image_classification import ImageClassifier
from app.models.enums import ImageProcessingStatus, OAMUploadStatus, State
from app.projects import project_schemas
from app.images.image_processing import DroneImageProcessor
from app.s3 import (
    s3_client,
    add_obj_to_bucket,
    maybe_presign_s3_key,
    get_file_from_bucket,
    get_object_metadata,
    list_objects_from_bucket,
)
from app.tasks.task_splitter import split_by_square
from app.utils import (
    calculate_flight_time_from_placemarks,
    merge_multipolygon,
)


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
                with open(outfile_with_elevation, "r") as inpointsfile:
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

    return await run_in_threadpool(
        lambda: split_by_square(
            boundary,
            meters=meters,
        )
    )


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
            from app.tasks import task_logic
            from app.utils import timestamp

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
            await conn.commit()
            log.info(f"Task {task_id} state updated to IMAGE_PROCESSING_STARTED")

            # Ensure images classified for this task are available in the task folder.
            # Single-task processing can be triggered from the project dialog before the
            # batch-processing flow has copied files out of staging.
            move_result = await ImageClassifier.move_task_images_to_folder(
                conn, project_id, task_id
            )
            if move_result.get("failed_count", 0) > 0:
                await conn.rollback()
                raise RuntimeError(
                    f"Failed to move {move_result['failed_count']} image(s) into the task folder"
                )
            if move_result.get("moved_count", 0) > 0:
                await conn.commit()
                log.info(
                    f"Task {task_id}: moved {move_result['moved_count']} staged image(s) "
                    "into the task folder before ODM submission"
                )

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
        failure_message = str(e).strip() or "Image processing failed."
        if isinstance(e, NodeResponseError) and "Not enough images" in failure_message:
            failure_message = "Not enough images for ODM processing. At least 3 task images are required."

        try:
            pool = ctx["db_pool"]
            async with pool.connection() as conn:
                from app.tasks import task_logic
                from app.utils import timestamp

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
                f"Failed to persist processing failure state for task {task_id}: {state_error}"
            )

        log.error(f"Error in process_drone_images (Job ID: {job_id}): {str(e)}")
        raise


async def update_processing_status(
    db: Connection, project_id: uuid.UUID, status: ImageProcessingStatus
):
    """
    Update the processing status to the specified status in the database.
    """
    log.debug(f"status = {status.name}")
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
            await processor.process_images_for_all_tasks(
                settings.S3_BUCKET_NAME,
                name_prefix=f"DTM-Task-{project_id}",
                options=options,
                webhook=webhook_url,
            )

            # Update the processing status to 'IMAGE_PROCESSING_STARTED' in the database.
            await update_processing_status(
                conn, project_id, ImageProcessingStatus.PROCESSING
            )
            return

    except Exception as e:
        log.error(f"Error in process_drone_images (Job ID: {job_id}): {str(e)}")
        raise


def get_project_info_from_s3(project_id: uuid.UUID, task_id: uuid.UUID):
    """Helper function to get the number of images and the URL to download the assets."""
    try:
        # Prefix for the images
        images_prefix = f"projects/{project_id}/{task_id}/images/"

        # List and count the images
        objects = list_objects_from_bucket(
            settings.S3_BUCKET_NAME, prefix=images_prefix
        )
        image_extensions = (".jpg", ".jpeg", ".png", ".tif", ".tiff")
        image_count = sum(
            1 for obj in objects if obj.object_name.lower().endswith(image_extensions)
        )

        # Check for ODM assets under the new individual-file layout first,
        # then fall back to the legacy monolithic assets.zip.
        # Use a single-object probe instead of listing the entire prefix.
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
                # New layout: point to the streaming export endpoint
                presigned_url = (
                    f"{settings.API_PREFIX}/projects/odm/export/{project_id}/{task_id}/"
                )
            else:
                # Fallback: legacy assets.zip
                assets_path = f"projects/{project_id}/{task_id}/assets.zip"
                get_object_metadata(settings.S3_BUCKET_NAME, assets_path)
                presigned_url = maybe_presign_s3_key(assets_path, expires_hours=2)
        except S3Error as e:
            if e.code == "NoSuchKey":
                log.debug(f"Assets not found for project {project_id}, task {task_id}.")
                presigned_url = None
            else:
                log.error(f"An error occurred while accessing assets: {e}")
                raise HTTPException(status_code=500, detail=str(e))

        # Generate a presigned URL for the orthophoto (task-level preferred; fallback to project-level)
        orthophoto_url = None
        try:
            task_ortho_path = (
                f"projects/{project_id}/{task_id}/orthophoto/odm_orthophoto.tif"
            )
            project_ortho_path = f"projects/{project_id}/orthophoto/odm_orthophoto.tif"

            # Prefer per-task orthophoto if it exists
            try:
                get_object_metadata(settings.S3_BUCKET_NAME, task_ortho_path)
                orthophoto_url = maybe_presign_s3_key(task_ortho_path, expires_hours=12)
            except S3Error as e:
                if e.code != "NoSuchKey":
                    raise

                # Fallback to project-level orthophoto if present (e.g. single-task projects)
                try:
                    get_object_metadata(settings.S3_BUCKET_NAME, project_ortho_path)
                    orthophoto_url = maybe_presign_s3_key(
                        project_ortho_path, expires_hours=12
                    )
                except S3Error as e2:
                    if e2.code == "NoSuchKey":
                        orthophoto_url = None
                    else:
                        raise
        except Exception as e:
            # Do not fail the whole endpoint if orthophoto is missing; just omit it.
            log.warning(f"Unable to generate orthophoto_url: {e}")
            orthophoto_url = None

        return project_schemas.AssetsInfo(
            project_id=str(project_id),
            task_id=str(task_id),
            image_count=image_count,
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


async def get_all_tasks_for_project(project_id, db):
    """Get all unique tasks associated with the project ID
    that are in state READY_FOR_PROCESSING.
    """
    async with db.cursor() as cur:
        query = """
        SELECT DISTINCT ON (t.id) t.id
        FROM tasks t
        JOIN task_events te ON t.id = te.task_id
        WHERE t.project_id = %s AND te.state::text = 'READY_FOR_PROCESSING'
        ORDER BY t.id, te.created_at DESC;
        """
        await cur.execute(query, (project_id,))
        results = await cur.fetchall()
        # Convert UUIDs to string
        return [str(result[0]) for result in results]


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
            with open(outfile_with_elevation, "r") as inpointsfile:
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
