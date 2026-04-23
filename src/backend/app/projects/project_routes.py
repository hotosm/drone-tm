import asyncio
import json
import uuid
from collections import defaultdict
from urllib.parse import urlparse, urlunparse
from datetime import datetime, timedelta, timezone
from typing import Annotated, Dict, List, Optional
from uuid import UUID

import aiohttp
import geojson
from arq import ArqRedis
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from geojson_pydantic import FeatureCollection
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from stream_zip import NO_COMPRESSION_64, stream_zip
from app.arq.tasks import get_redis_pool
from app.config import settings
from app.db import database
from app.jaxa.upload_dem import enqueue_dem_download
from app.models.enums import (
    HTTPStatus,
    ImageProcessingStatus,
    OAMUploadStatus,
    ProjectCompletionStatus,
    State,
)
from app.images.image_classification import ImageClassifier
from app.projects import project_deps, project_logic, project_schemas
from app.projects.project_deps import normalize_aoi
from app.projects.oam import upload_to_oam
from app.s3 import (
    abort_multipart_upload,
    build_browser_object_url,
    check_file_exists,
    complete_multipart_upload,
    delete_objects_by_prefix,
    generate_presigned_multipart_upload_url,
    initiate_multipart_upload,
    list_parts,
    s3_client,
)
from app.tasks import task_logic, task_schemas
from app.users.permissions import (
    IsProjectCreator,
    IsSuperUser,
    check_permissions,
)
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.utils import (
    geojson_to_kml,
    send_project_approval_email_to_regulator,
    timestamp,
)

router = APIRouter(
    prefix="/projects",
    responses={404: {"description": "Not found"}},
)


ODM_STATUS_LABELS = project_logic.ODM_STATUS_LABELS

ODM_QUEUE_DISPLAY_CODES = {10, 20, 30}


# Re-export from project_logic for local use in this module.
_parse_odm_status = project_logic.parse_odm_status
_extract_valid_odm_task_info = project_logic.extract_valid_odm_task_info
_get_project_odm_endpoint = project_logic.get_project_odm_endpoint


@router.get(
    "/centroids", tags=["Projects"], response_model=list[project_schemas.CentroidOut]
)
async def read_project_centroids(
    db: Annotated[Connection, Depends(database.get_db)],
):
    """Get all project centroids."""
    return await project_logic.get_centroids(
        db,
    )


@router.get("/{project_id}/download-boundaries", tags=["Projects"])
async def download_boundaries(
    project_id: Annotated[
        UUID,
        Path(
            description="The project ID in UUID format.",
        ),
    ],
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    task_id: Optional[UUID] = Query(
        default=None,
        description="The task ID in UUID format. If not provided, all tasks will be downloaded.",
    ),
    split_area: bool = Query(
        default=False,
        description="Whether to split the area or not. Set to True to download task boundaries, otherwise AOI will be downloaded.",
    ),
    export_type: str = Query(
        default="geojson",
        description="The format of the file to download. Options are 'geojson' or 'kml'.",
    ),
):
    """Downloads the AOI or task boundaries for a project as a GeoJSON file.

    Args:
        project_id (UUID): The ID of the project in UUID format.
        db (Connection): The database connection, provided automatically.
        user_data (AuthUser): The authenticated user data, checks if the user has permission.
        task_id (Optional[UUID]): The task ID in UUID format. If not provided and split_area is True, all tasks will be downloaded.
        split_area (bool): Whether to split the area or not. Set to True to download task boundaries, otherwise AOI will be downloaded.
        export_type (str): The format of the file to download. Can be either 'geojson' or 'kml'.

    Returns:
        Response: The HTTP response object containing the downloaded file.
    """
    try:
        out = await task_schemas.Task.get_task_geometry(
            db, project_id, task_id, split_area
        )

        if out is None:
            raise HTTPException(status_code=404, detail="Geometry not found.")

        if isinstance(out, str):
            out = json.loads(out)

        # Convert the geometry to a FeatureCollection if it is a valid GeoJSON geometry
        if isinstance(out, dict) and "type" in out and "coordinates" in out:
            out = {
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "geometry": out, "properties": {}}],
            }

        # Determine filename and content-type based on export type
        if export_type == "geojson":
            filename = (
                f"task_{task_id}.geojson" if task_id else "project_outline.geojson"
            )
            if not split_area:
                filename = "project_aoi.geojson"
            content_type = "application/geo+json"
            content = json.dumps(out)

        elif export_type == "kml":
            filename = f"task_{task_id}.kml" if task_id else "project_outline.kml"
            if not split_area:
                filename = "project_aoi.kml"
            content_type = "application/vnd.google-earth.kml+xml"
            content = geojson_to_kml(out)

        else:
            raise HTTPException(
                status_code=400, detail="Invalid export type specified."
            )

        headers = {
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Type": content_type,
        }
        return Response(content=content.encode("utf-8"), headers=headers)

    except HTTPException as e:
        log.error(f"Error during boundaries download: {e.detail}")
        raise e

    except Exception as e:
        log.error(f"Unexpected error during boundaries download: {e}")
        raise HTTPException(status_code=500, detail="Internal server error.")


@router.delete("/{project_id}", tags=["Projects"])
async def delete_project_by_id(
    db: Annotated[Connection, Depends(database.get_db)],
    project: Annotated[
        project_schemas.DbProject,
        Depends(
            check_permissions(
                IsSuperUser() | IsProjectCreator(),
                get_obj=project_deps.get_project_by_id,
            )
        ),
    ],
):
    project_id = await project_schemas.DbProject.delete(db, project.id)

    # After DB rows are gone, purge all S3 assets under the project prefix.
    # We do this best-effort: if S3 cleanup fails the DB delete still stands,
    # and the script in scripts/ can sweep orphaned prefixes later.
    try:
        deleted = delete_objects_by_prefix(
            settings.S3_BUCKET_NAME, f"projects/{project_id}/"
        )
        log.info(f"Deleted {deleted} S3 objects for project {project_id}")
    except Exception as e:
        log.error(f"S3 cleanup failed for project {project_id}: {e}")

    return {"message": f"Project successfully deleted {project_id}"}


@router.post("/", tags=["Projects"])
async def create_project(
    project_info: project_schemas.ProjectIn,
    db: Annotated[Connection, Depends(database.get_db)],
    background_tasks: BackgroundTasks,
    user_data: Annotated[AuthUser, Depends(login_required)],
    dem: UploadFile = File(None),
    image: UploadFile = File(None),
):
    """Create a project in the database."""
    # Create project in database first
    project_id = await project_schemas.DbProject.create(db, project_info, user_data.id)

    # Upload DEM and Image to S3 (only if project creation succeeded)
    dem_url = None
    try:
        if dem:
            dem_url = await project_logic.upload_file_to_s3(project_id, dem, "dem.tif")
        if image:
            await project_logic.upload_file_to_s3(
                project_id, image, "map_screenshot.png"
            )
    except Exception as e:
        log.error(f"Failed to upload files to S3 for project {project_id}: {e}")
        # Continue - project is created, file upload failure is non-critical

    # Update DEM URL in the database if uploaded
    if dem_url:
        await project_logic.update_url(db, project_id, dem_url)

    if project_info.requires_approval_from_regulator:
        regulator_emails = project_info.regulator_emails
        background_tasks.add_task(
            send_project_approval_email_to_regulator,
            regulator_emails,
            project_id,
            user_data.name,
            project_info.name,
        )

    if project_info.is_terrain_follow and not dem:
        geometry = project_info.outline["features"][0]["geometry"]
        try:
            redis = await get_redis_pool()
            background_tasks.add_task(enqueue_dem_download, geometry, project_id, redis)
        except HTTPException as e:
            # Project creation should succeed even if DEM background queue is unavailable.
            log.warning(
                "Project {} created but DEM enqueue skipped (Redis unavailable): {}",
                project_id,
                e.detail,
            )

    return {"message": "Project successfully created", "project_id": project_id}


@router.post("/{project_id}/upload-task-boundaries", tags=["Projects"])
async def upload_project_task_boundaries(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    task_featcol: Annotated[FeatureCollection, Depends(project_deps.geojson_upload)],
):
    """Set project task boundaries using split GeoJSON from frontend.

    Each polygon in the uploaded geojson are made into single task.

    Returns:
        dict: JSON containing success message, project ID, and number of tasks.
    """
    log.debug("Creating tasks for each polygon in project")
    redis_pool = None
    try:
        redis_pool = await get_redis_pool()
    except HTTPException as e:
        log.warning(
            "Project {} tasks created without metrics queueing: {}",
            project.id,
            e.detail,
        )

    await project_logic.create_tasks_from_geojson(
        db, project.id, task_featcol, project, redis_pool
    )

    return {
        "message": "Project Boundary Upload Initiated",
        "project_id": f"{project.id}",
    }


@router.post("/preview-split-by-square/", tags=["Projects"])
async def preview_split_by_square(
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    aoi: Annotated[geojson.FeatureCollection, Depends(normalize_aoi)],
    no_fly_zones: UploadFile = File(default=None),
    dimension: int = Form(100),
):
    """Preview splitting by square.

    The AOI is normalised via geojson-aoi-parser so that any valid GeoJSON
    type (including multi-feature FeatureCollections exported by QGIS) is
    accepted and merged into a single Polygon.
    """
    aoi_geometry = aoi["features"][0]["geometry"]

    if no_fly_zones:
        no_fly_content = await no_fly_zones.read()
        no_fly_zones_geojson = geojson.loads(no_fly_content)
        no_fly_features = no_fly_zones_geojson.get("features", [])
        if no_fly_features:
            nfz_geoms = [json.dumps(f["geometry"]) for f in no_fly_features]
            async with db.cursor() as cur:
                await cur.execute(
                    """
                    SELECT ST_AsGeoJSON(
                        ST_Difference(
                            ST_GeomFromGeoJSON(%(aoi)s),
                            ST_UnaryUnion(ST_Collect(ST_GeomFromGeoJSON(nfz)))
                        )
                    )
                    FROM unnest(%(nfz_geoms)s::text[]) AS nfz
                    """,
                    {"aoi": json.dumps(aoi_geometry), "nfz_geoms": nfz_geoms},
                )
                row = await cur.fetchone()
                if row and row[0]:
                    aoi_geometry = json.loads(row[0])

    result_geojson = geojson.Feature(geometry=aoi_geometry)
    return await project_logic.preview_split_by_square(result_geojson, dimension)


@router.post("/normalize-aoi/", tags=["Projects"])
async def normalize_project_aoi(
    user: Annotated[AuthUser, Depends(login_required)],
    aoi: Annotated[geojson.FeatureCollection, Depends(normalize_aoi)],
):
    """Normalise an uploaded AOI and return a merged single-polygon FeatureCollection."""
    return aoi


@router.get("/", tags=["Projects"], response_model=project_schemas.ProjectOut)
async def read_projects(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    filter_by_owner: Optional[bool] = Query(
        False, description="Filter projects by authenticated user (creator)"
    ),
    status: Optional[ProjectCompletionStatus] = Query(
        None, description="Filter projects by status"
    ),
    search: Optional[str] = Query(None, description="Search projects by name"),
    page: int = Query(1, ge=1, description="Page number"),
    results_per_page: int = Query(
        20, gt=0, le=100, description="Number of results per page"
    ),
):
    """Get all projects with task count."""
    try:
        user_id = user_data.id if filter_by_owner else None
        skip = (page - 1) * results_per_page
        projects, total_count = await project_schemas.DbProject.all(
            db,
            user_id=user_id,
            search=search,
            status=status,
            skip=skip,
            limit=results_per_page,
        )
        if not projects:
            return {
                "results": [],
                "pagination": {
                    "page": page,
                    "per_page": results_per_page,
                    "total": total_count,
                },
            }

        return {
            "results": projects,
            "pagination": {
                "page": page,
                "per_page": results_per_page,
                "total": total_count,
            },
        }
    except KeyError as e:
        raise HTTPException(status_code=HTTPStatus.UNPROCESSABLE_ENTITY) from e


@router.get(
    "/{project_id}", tags=["Projects"], response_model=project_schemas.ProjectInfo
)
async def read_project(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
):
    """Get a specific project and all associated tasks by ID."""
    return project


@router.post("/process_imagery/{project_id}/{task_id}/", tags=["Image Processing"])
async def process_imagery(
    task_id: uuid.UUID,
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    user_data: Annotated[AuthUser, Depends(login_required)],
    db: Annotated[Connection, Depends(database.get_db)],
    redis_pool: ArqRedis = Depends(get_redis_pool),
    odm_url: Optional[str] = Query(None, description="Custom NodeODM server URL"),
):
    """Start a queued task to process drone imagery."""
    pending_transfer_count = await ImageClassifier.get_task_pending_transfer_count(
        db, project.id, task_id
    )
    if pending_transfer_count > 0:
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail=(
                "Imagery for this task is still being transferred. "
                "Please wait and retry processing."
            ),
        )

    user_id = user_data.id
    job = await redis_pool.enqueue_job(
        "process_drone_images",
        project.id,
        task_id,
        user_id,
        odm_url,
        _queue_name="default_queue",
    )

    return {"message": "Processing started", "job_id": job.job_id}


@router.post("/process_all_imagery/{project_id}/", tags=["Image Processing"])
async def process_all_imagery(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    user_data: Annotated[AuthUser, Depends(login_required)],
    db: Annotated[Connection, Depends(database.get_db)],
    redis_pool: ArqRedis = Depends(get_redis_pool),
):
    """API endpoint to process all tasks associated with a project.

    If a GCP file has been saved for this project (via POST /gcp/save/),
    it will be automatically included during ODM processing.
    """
    user_id = user_data.id

    if project.image_processing_status == "PROCESSING":
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail="Image processing is already running for this project.",
        )

    (
        tasks,
        pending_ready_tasks,
    ) = await project_logic.get_ready_tasks_with_pending_transfer_count(project.id, db)

    if not tasks:
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            detail="No tasks are in READY_FOR_PROCESSING state.",
        )

    if pending_ready_tasks > 0:
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail=(
                "Imagery for ready tasks is still being transferred. "
                "Please wait and retry processing."
            ),
        )

    await db.execute(
        """
        UPDATE projects
        SET image_processing_status = %(status)s, last_updated = NOW()
        WHERE id = %(project_id)s;
        """,
        {
            "status": ImageProcessingStatus.PROCESSING.name,
            "project_id": project.id,
        },
    )

    job = await redis_pool.enqueue_job(
        "process_all_drone_images",
        project.id,
        tasks,
        user_id,
        _queue_name="default_queue",
    )

    return {
        "message": f"Processing started for {len(tasks)} tasks.",
        "job_id": job.job_id,
    }


@router.post("/odm/webhook/{dtm_project_id}/", tags=["Image Processing"])
async def odm_webhook_for_processing_whole_project(
    request: Request,
    dtm_project_id: uuid.UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    redis_pool: Annotated[ArqRedis, Depends(get_redis_pool)],
):
    payload = await request.json()
    odm_task_id = payload.get("uuid")
    status = payload.get("status")
    log.info(
        "ODM webhook (whole project): project={} odm_task={} status={}",
        dtm_project_id,
        odm_task_id,
        status,
    )

    if not odm_task_id or not status:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    if status["code"] in {30, 40}:
        # Use the endpoint persisted when processing started so downloads
        # target the correct server even if config has changed since.
        node_odm_url = await _get_project_odm_endpoint(db, dtm_project_id)
        await redis_pool.enqueue_job(
            "process_odm_webhook_assets",
            node_odm_url=node_odm_url,
            dtm_project_id=str(dtm_project_id),
            odm_task_id=odm_task_id,
            odm_status_code=status["code"],
            _job_id=f"odm-assets:project:{dtm_project_id}",
            _queue_name="default_queue",
        )

    return {"message": "Webhook received", "task_id": dtm_project_id}


@router.post(
    "/odm/webhook/{dtm_project_id}/{dtm_task_id}/",
    tags=["Image Processing"],
)
async def odm_webhook_for_processing_a_single_task(
    request: Request,
    db: Annotated[Connection, Depends(database.get_db)],
    dtm_project_id: uuid.UUID,
    dtm_task_id: uuid.UUID,
    redis_pool: Annotated[ArqRedis, Depends(get_redis_pool)],
    odm_url: Optional[str] = Query(None, description="Custom NodeODM server URL"),
):
    payload = await request.json()
    odm_task_id = payload.get("uuid")
    status = payload.get("status")
    node_odm_endpoint = odm_url or settings.ODM_ENDPOINT
    log.info(
        "ODM webhook (single task): project={} task={} odm_task={} status={} odm_url={}",
        dtm_project_id,
        dtm_task_id,
        odm_task_id,
        status,
        node_odm_endpoint,
    )

    if not odm_task_id or not status:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    current_state = await task_logic.get_task_state(db, dtm_project_id, dtm_task_id)
    state_value = State[current_state.get("state")]
    log.info(
        "ODM webhook: task {} current DB state={}, ODM status code={}",
        dtm_task_id,
        state_value,
        status["code"],
    )

    if status["code"] == 40:
        await redis_pool.enqueue_job(
            "process_odm_webhook_assets",
            node_odm_url=node_odm_endpoint,
            dtm_project_id=str(dtm_project_id),
            odm_task_id=odm_task_id,
            state_name=state_value.name,
            message="Task completed.",
            dtm_task_id=str(dtm_task_id),
            odm_status_code=40,
            _job_id=f"odm-assets:task:{dtm_task_id}",
            _queue_name="default_queue",
        )

    elif status["code"] == 30 and state_value != State.IMAGE_PROCESSING_FAILED:
        # Use system-level update since webhook may be called from batch processor
        await task_logic.update_task_state_system(
            db,
            dtm_project_id,
            dtm_task_id,
            "Image processing failed.",
            state_value,
            State.IMAGE_PROCESSING_FAILED,
            timestamp(),
        )
        await redis_pool.enqueue_job(
            "process_odm_webhook_assets",
            node_odm_url=node_odm_endpoint,
            dtm_project_id=str(dtm_project_id),
            odm_task_id=odm_task_id,
            state_name=state_value.name,
            message="Image processing failed.",
            dtm_task_id=str(dtm_task_id),
            odm_status_code=30,
            _job_id=f"odm-assets:task:{dtm_task_id}",
            _queue_name="default_queue",
        )

    return {"message": "Webhook received", "odm_task_id": odm_task_id}


@router.post("/regulator/comment/{project_id}/", tags=["regulator"])
async def regulator_approval(
    project_id: str,
    data: dict,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    response: Response,
):
    """Endpoint to allow a regulator to add comments and approve or reject to a project.

    Args:
        project_id (str): The unique identifier of the project.
        data (dict): A dictionary containing the regulator's comment.
        Expected key: 'regulator_comment' and 'regulator_approval_status.
        db (Connection): Database connection instance, provided via dependency injection.
        user_data (AuthUser): Authenticated user data, provided via dependency injection.
        response (Response): FastAPI Response object to set custom status codes.

    Returns:
        dict: A response message indicating success or failure.

    Raises:
        HTTPException: Raised with status code 400 if any error occurs during execution.

    Notes:
        - Requires the user to be logged in and to have the "REGULATOR" role.
        - Ensures that the user is authorized to comment on the specified project.
    """
    try:
        if (
            user_data.role != "REGULATOR"
            or not await project_logic.check_regulator_project(
                db, project_id, user_data.email
            )
        ):
            response.status_code = 403
            return {"details": "You are not authorized to perform the action"}

        sql = """
        UPDATE projects SET
        regulator_comment = %(comment)s,
        commenting_regulator_id = %(user_id)s,
        regulator_approval_status = %(regulator_approval_status)s
        WHERE id = %(project_id)s
        """

        async with db.cursor() as cur:
            await cur.execute(
                sql,
                {
                    "comment": data["regulator_comment"],
                    "regulator_approval_status": data["regulator_approval_status"],
                    "user_id": user_data.id,
                    "project_id": project_id,
                },
            )

        return {"message": "Comment Added successfully !!!"}
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"An error occurred: {str(e)}",
        )


@router.post("/waypoints/", tags=["Projects"])
async def get_project_waypoints_counts(
    side_overlap: float,
    front_overlap: float,
    altitude_from_ground: float,
    gsd_cm_px: float,
    aoi: Annotated[geojson.FeatureCollection, Depends(normalize_aoi)],
    meters: float = 100,
    is_terrain_follow: bool = False,
    dem: UploadFile = File(None),
    user_data: AuthUser = Depends(login_required),
):
    """Count waypoints and waylines within AOI.

    The AOI is normalised via geojson-aoi-parser so that any valid GeoJSON
    type is accepted and merged into a single Polygon.
    """
    return await project_logic.process_waypoints_and_waylines(
        side_overlap,
        front_overlap,
        altitude_from_ground,
        gsd_cm_px,
        meters,
        aoi,
        is_terrain_follow,
        dem,
    )


@router.get(
    "/assets/{project_id}/",
    tags=["Image Processing"],
)
async def get_assets_info(
    user_data: Annotated[AuthUser, Depends(login_required)],
    db: Annotated[Connection, Depends(database.get_db)],
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    task_id: Optional[uuid.UUID] = None,
):
    """Endpoint to get the number of images and the URL to download the assets
    for a given project and task. If no task_id is provided, returns info
    for all tasks associated with the project.
    """
    # Get image counts from DB (authoritative source) instead of S3 listing.
    image_counts: dict[uuid.UUID, int] = {}
    async with db.cursor() as cur:
        if task_id is None:
            await cur.execute(
                """
                SELECT task_id, COUNT(*) as cnt
                FROM project_images
                WHERE project_id = %(pid)s
                  AND task_id IS NOT NULL
                  AND status = 'assigned'
                GROUP BY task_id
                """,
                {"pid": str(project.id)},
            )
        else:
            await cur.execute(
                """
                SELECT task_id, COUNT(*) as cnt
                FROM project_images
                WHERE project_id = %(pid)s
                  AND task_id = %(tid)s
                  AND status = 'assigned'
                GROUP BY task_id
                """,
                {"pid": str(project.id), "tid": str(task_id)},
            )
        for row in await cur.fetchall():
            image_counts[row[0]] = row[1]

    if task_id is None:
        tasks = await project_deps.get_tasks_by_project_id(project.id, db)
        results = []

        for task in tasks:
            tid = task.get("id")
            task_info = project_logic.get_project_info_from_s3(project.id, tid)
            task_info.image_count = image_counts.get(tid, 0)
            try:
                current_state = await task_logic.get_task_state(db, project.id, tid)
                task_info.state = current_state.get("state") if current_state else None
            except Exception:
                task_info.state = None
            results.append(task_info)

        return results
    else:
        current_state = await task_logic.get_task_state(db, project.id, task_id)
        project_info = project_logic.get_project_info_from_s3(project.id, task_id)
        project_info.image_count = image_counts.get(task_id, 0)
        project_info.state = current_state.get("state")
        return project_info


@router.post("/{project_id}/upload-to-oam", tags=["OAM"])
async def upload_imagery_to_oam(
    user_data: Annotated[AuthUser, Depends(login_required)],
    db: Annotated[Connection, Depends(database.get_db)],
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    background_tasks: BackgroundTasks,
    tags: Dict[str, List[str]] = Body(default={"tags": []}),
):
    """Upload project orthophoto to OpenAerialMap."""
    if project.author_id != user_data.id:
        return HTTPException(
            status_code=HTTPStatus.FORBIDDEN,
            detail="User not authorized to do this action",
        )

    # Check if upload is already in progress or already uploaded.
    if (
        project.oam_upload_status == OAMUploadStatus.UPLOADING
        or project.oam_upload_status == OAMUploadStatus.UPLOADED
    ):
        return HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail="Upload to OAM already in progress or already done",
        )

    # Update project status to UPLOADING
    await project_logic.update_project_oam_status(
        db, project.id, OAMUploadStatus.UPLOADING
    )

    background_tasks.add_task(upload_to_oam, db, project, user_data, tags)
    return {"message": "Uploading to OAM Started", "status": OAMUploadStatus.UPLOADING}


@router.post("/{project_id}/generate-qfield-project", tags=["Projects"])
async def generate_qfield_project(
    project_id: Annotated[UUID, Path(description="The project ID in UUID format.")],
    db: Annotated[Connection, Depends(database.get_db)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Enqueue a QField project generation job.

    Triggers the QGIS container to build a QField-ready zip and upload it
    to S3 under publicuploads/qfield/{project_id}.zip.
    """
    # Verify project exists
    project = await project_schemas.DbProject.one(db, project_id)
    if not project:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND,
            detail=f"Project {project_id} not found",
        )

    job = await redis.enqueue_job(
        "generate_qfield_project",
        str(project_id),
        _queue_name="default_queue",
    )

    return {
        "message": "QField project generation started",
        "job_id": job.job_id,
        "project_id": str(project_id),
    }


@router.get("/{project_id}/qfield-project-status", tags=["Projects"])
async def qfield_project_status(
    project_id: Annotated[UUID, Path(description="The project ID in UUID format.")],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Check if a QField project zip exists in S3.

    Returns the public download URL if the zip is available.
    """
    s3_key = f"publicuploads/qfield/{project_id}.zip"
    exists = check_file_exists(settings.S3_BUCKET_NAME, s3_key)

    if not exists:
        return {"exists": False, "url": None}

    url = build_browser_object_url(settings.S3_BUCKET_NAME, s3_key)
    return {"exists": True, "url": url}


@router.post("/initiate-multipart-upload/", tags=["Image Upload"])
async def initiate_upload(
    user: Annotated[AuthUser, Depends(login_required)],
    db: Annotated[Connection, Depends(database.get_db)],
    data: project_schemas.MultipartUploadRequest,
):
    """Initiate a multipart upload for large files.

    Args:
        data: Contains project_id, optional task_id, file_name, and staging flag.

    Returns:
        dict: Upload ID and file key for the multipart upload session.
    """
    try:
        if data.purpose == "odm_import":
            # ODM import: upload zip to a temporary location
            if not data.task_id:
                raise HTTPException(
                    status_code=HTTPStatus.BAD_REQUEST,
                    detail="task_id is required for ODM import",
                )
            # Only the project creator or a superuser may import ODM assets
            project = await project_schemas.DbProject.one(db, data.project_id)
            if not (user.is_superuser or project.author_id == user.id):
                raise HTTPException(
                    status_code=HTTPStatus.FORBIDDEN,
                    detail="Only the project creator may import ODM assets",
                )
            file_key = f"projects/{data.project_id}/{data.task_id}/odm_import.zip"
        elif data.staging:
            # Upload to staging directory
            file_key = f"projects/{data.project_id}/user-uploads/{data.file_name}"
        else:
            # Upload to task directory (original behavior)
            if not data.task_id:
                raise HTTPException(
                    status_code=HTTPStatus.BAD_REQUEST,
                    detail="task_id is required when staging=False",
                )
            file_key = (
                f"projects/{data.project_id}/{data.task_id}/images/{data.file_name}"
            )

        upload_id = initiate_multipart_upload(settings.S3_BUCKET_NAME, file_key)

        return {
            "upload_id": upload_id,
            "file_key": file_key,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to initiate multipart upload: {e}",
        )


@router.post("/sign-part-upload/", tags=["Image Upload"])
async def sign_part_upload(
    user: Annotated[AuthUser, Depends(login_required)],
    data: project_schemas.SignPartUploadRequest,
):
    """Generate a presigned URL for uploading a specific part.

    Args:
        data: Contains upload_id, file_key, part_number, and optional expiry.

    Returns:
        dict: Presigned URL for uploading the part.
    """
    try:
        url = generate_presigned_multipart_upload_url(
            settings.S3_BUCKET_NAME,
            data.file_key,
            data.upload_id,
            data.part_number,
            data.expiry,
        )

        return {
            "url": url,
            "part_number": data.part_number,
        }
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to generate presigned URL for part: {e}",
        )


@router.post("/complete-multipart-upload/", tags=["Image Upload"])
async def complete_upload(
    user: Annotated[AuthUser, Depends(login_required)],
    db: Annotated[Connection, Depends(database.get_db)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
    data: project_schemas.CompleteMultipartUploadRequest,
):
    """Complete a multipart upload and queue image processing in background.

    Args:
        user: Authenticated user
        redis: Redis connection for background tasks
        data: Contains upload_id, file_key, parts, project_id, and filename.

    Returns:
        dict: Success message with background job ID.
    """
    try:
        # For ODM imports, validate authorization BEFORE finalizing the
        # multipart upload so a rejected request doesn't leave an orphaned
        # zip object in S3.
        if data.purpose == "odm_import":
            if not data.task_id:
                raise HTTPException(
                    status_code=HTTPStatus.BAD_REQUEST,
                    detail="task_id is required for ODM import",
                )
            project = await project_schemas.DbProject.one(db, data.project_id)
            if not (user.is_superuser or project.author_id == user.id):
                # Abort the multipart upload so no orphaned parts remain
                try:
                    abort_multipart_upload(
                        settings.S3_BUCKET_NAME, data.file_key, data.upload_id
                    )
                except Exception:
                    pass
                raise HTTPException(
                    status_code=HTTPStatus.FORBIDDEN,
                    detail="Only the project creator may import ODM assets",
                )

        # Complete the multipart upload in S3
        complete_multipart_upload(
            settings.S3_BUCKET_NAME,
            data.file_key,
            data.upload_id,
            data.parts,
        )

        if data.purpose == "odm_import":
            job = await redis.enqueue_job(
                "process_imported_odm_assets",
                str(data.project_id),
                str(data.task_id),
                data.file_key,
                str(user.id),
                _queue_name="default_queue",
                _defer_by=timedelta(seconds=3),
            )
            if job is None:
                log.error(f"Failed to enqueue ODM import job for file: {data.file_key}")
                raise HTTPException(
                    status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                    detail="Upload completed but failed to queue processing job. "
                    "Please trigger ingestion manually.",
                )
            log.info(f"Queued ODM import job: {job.job_id} for task: {data.task_id}")
            return {
                "message": "ODM import queued",
                "file_key": data.file_key,
                "job_id": job.job_id,
            }

        # Queue background task to process image (EXIF extraction, hash, duplicate check)
        # NOTE: Each image is queued individually (not batched) to isolate failures.
        # If one image has corrupt EXIF data, others aren't affected. Redis/ARQ should
        # handle thousands of jobs, but monitor performance if queue length grows significantly.
        # NOTE: _defer_by delays job execution by 2 seconds to allow S3/MinIO eventual
        # consistency - the file may not be immediately readable after multipart upload completes.
        job = await redis.enqueue_job(
            "process_uploaded_image",
            str(data.project_id),
            data.file_key,
            data.filename,
            str(user.id),
            str(data.batch_id) if data.batch_id else None,
            _queue_name="default_queue",
            _defer_by=timedelta(seconds=2),
        )

        if job is None:
            log.error(
                f"Failed to enqueue image processing job for file: {data.filename}"
            )
            raise HTTPException(
                status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                detail="Upload completed but failed to queue processing job. "
                "Please trigger ingestion manually.",
            )

        log.info(f"Queued image processing job: {job.job_id} for file: {data.filename}")

        return {
            "message": "Multipart upload completed successfully. Image processing queued.",
            "file_key": data.file_key,
            "job_id": job.job_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to complete multipart upload: {e}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to complete multipart upload: {e}",
        )


@router.post("/abort-multipart-upload/", tags=["Image Upload"])
async def abort_upload(
    user: Annotated[AuthUser, Depends(login_required)],
    data: project_schemas.AbortMultipartUploadRequest,
):
    """Abort a multipart upload and clean up parts.

    Args:
        data: Contains upload_id and file_key.

    Returns:
        dict: Success message.
    """
    try:
        abort_multipart_upload(
            settings.S3_BUCKET_NAME,
            data.file_key,
            data.upload_id,
        )

        return {
            "message": "Multipart upload aborted successfully",
        }
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to abort multipart upload: {e}",
        )


@router.get("/list-parts/", tags=["Image Upload"])
async def get_uploaded_parts(
    user: Annotated[AuthUser, Depends(login_required)],
    upload_id: str = Query(..., description="The upload ID"),
    file_key: str = Query(..., description="The S3 file key"),
):
    """List all uploaded parts for a multipart upload (for resume capability).

    Args:
        upload_id: The upload ID from initiate_multipart_upload.
        file_key: The S3 object key.

    Returns:
        dict: List of uploaded parts.
    """
    try:
        parts = list_parts(
            settings.S3_BUCKET_NAME,
            file_key,
            upload_id,
        )

        return {
            "parts": parts,
            "upload_id": upload_id,
        }
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to list parts: {e}",
        )


@router.get(
    "/odm/queue-info/{project_id}/",
    tags=["Image Processing"],
    response_model=project_schemas.OdmQueueInfo,
)
async def get_odm_queue_info(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    redis_pool: Annotated[ArqRedis, Depends(get_redis_pool)],
    task_id: Optional[uuid.UUID] = Query(
        default=None,
        description="DTM task ID to find its approximate queue position.",
    ),
):
    """Get the ODM processing queue info for this project.

    Queries our DB for tasks that have been submitted to NodeODM
    (have an odm_task_uuid), then fetches each task's real status
    from NodeODM via /task/{uuid}/info.

    If a task is stuck as IMAGE_PROCESSING_STARTED in our DB but NodeODM
    reports it as failed/completed/canceled (or doesn't know about it),
    we reconcile the state automatically.
    """
    # Prefer the ODM endpoint persisted when processing started (ensures
    # reconciliation targets the correct server even if config changes).
    # Fall back to the current config if no persisted endpoint exists.
    odm_url = getattr(project, "odm_endpoint_used", None) or settings.ODM_ENDPOINT
    if not odm_url:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="ODM endpoint is not configured.",
        )

    # Parse ODM_ENDPOINT which may contain ?token=xxx and/or trailing slash
    parsed = urlparse(odm_url)
    odm_query = parsed.query  # e.g. "token=xxx"

    def odm_task_url(odm_uuid: str) -> str:
        path = f"{parsed.path.rstrip('/')}/task/{odm_uuid}/info"
        return urlunparse((parsed.scheme, parsed.netloc, path, "", odm_query, ""))

    # Minimum age (seconds) a task must be in STARTED state before
    # "not found on NodeODM" is treated as a definitive loss.  Prevents
    # false failure when a task was just submitted and NodeODM hasn't
    # registered it yet.
    NOT_FOUND_AGE_THRESHOLD_SEC = 1800  # 30 minutes

    # Get all project tasks that have been sent to ODM (any state)
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            WITH latest_state AS (
                SELECT DISTINCT ON (te.task_id)
                    te.task_id,
                    te.state,
                    te.created_at AS state_entered_at
                FROM task_events te
                ORDER BY te.task_id, te.created_at DESC
            )
            SELECT
                t.id,
                t.project_task_index,
                t.odm_task_uuid,
                ls.state,
                ls.state_entered_at
            FROM tasks t
            JOIN latest_state ls ON ls.task_id = t.id
            WHERE
                t.project_id = %(project_id)s
                AND t.odm_task_uuid IS NOT NULL
            ORDER BY t.project_task_index;
            """,
            {"project_id": project.id},
        )
        all_odm_tasks = await cur.fetchall()

    if not all_odm_tasks:
        # No per-task ODM submissions. Check for a project-level ODM run.
        project_odm_info = await project_logic.reconcile_project_level_odm(
            db,
            project,
            odm_url,
            parsed,
            odm_query,
            redis_pool,
            NOT_FOUND_AGE_THRESHOLD_SEC,
        )
        return project_schemas.OdmQueueInfo(
            total_queued=project_odm_info.get("queued", 0),
            total_running=project_odm_info.get("running", 0),
            total_failed=project_odm_info.get("failed", 0),
            total_completed=project_odm_info.get("completed", 0),
            total_canceled=0,
            total_tasks=project_odm_info.get("total", 0),
            queue_position=None,
            groups=project_odm_info.get("groups", []),
        )

    # Fetch real status from NodeODM for each task via /task/{uuid}/info
    # We use a sentinel to distinguish "fetch failed" (timeout, network error)
    # from "task genuinely not found on NodeODM" (got a 200 response but no
    # valid status, or an error JSON like {"error": "uuid not found"}).
    _FETCH_ERROR = object()
    odm_info_by_uuid: dict[str, dict | object] = {}
    reconciled: list[str] = []

    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=15)
        ) as session:
            # Fetch all task info concurrently
            async def fetch_task_info(
                odm_uuid: str,
            ) -> tuple[str, dict | object | None]:
                try:
                    async with session.get(odm_task_url(odm_uuid)) as resp:
                        if resp.status == 200:
                            return odm_uuid, _extract_valid_odm_task_info(
                                await resp.json()
                            )
                        log.warning(
                            "NodeODM /task/{}/info returned status {}",
                            odm_uuid,
                            resp.status,
                        )
                        # Non-200 could be transient; treat as fetch error
                        return odm_uuid, _FETCH_ERROR
                except Exception as e:
                    log.warning(
                        "Failed to fetch NodeODM task info for {}: {}", odm_uuid, e
                    )
                    return odm_uuid, _FETCH_ERROR

            results = await asyncio.gather(
                *[fetch_task_info(t["odm_task_uuid"]) for t in all_odm_tasks]
            )
            for odm_uuid, info in results:
                if info is not None:
                    odm_info_by_uuid[odm_uuid] = info
    except aiohttp.ClientError as e:
        log.warning("Failed to reach NodeODM at {}: {}", odm_url, e)
        raise HTTPException(
            status_code=503,
            detail="Unable to connect to the processing server.",
        )

    # Build task list and reconcile stuck states
    groups_map: dict[int, list[project_schemas.OdmQueueTask]] = defaultdict(list)

    for db_task in all_odm_tasks:
        odm_uuid = db_task["odm_task_uuid"]
        dtm_task_id = db_task["id"]
        task_index = db_task["project_task_index"]
        db_state = db_task["state"]
        raw_odm_info = odm_info_by_uuid.get(odm_uuid)

        # Distinguish: dict = valid info, _FETCH_ERROR = transient failure, None = not in map
        fetch_failed = raw_odm_info is _FETCH_ERROR
        odm_info = raw_odm_info if isinstance(raw_odm_info, dict) else None

        if odm_info:
            status_code, status_label = _parse_odm_status(odm_info.get("status"))
            name = odm_info.get("name") or f"Task {task_index}"
            display_status_code = status_code
            display_status_label = status_label

            if status_code == 50:
                display_status_code = 30
                display_status_label = "Failed (canceled)"

            t = project_schemas.OdmQueueTask(
                uuid=odm_uuid,
                name=name,
                status_code=display_status_code,
                status_label=display_status_label,
                images_count=odm_info.get("imagesCount"),
                progress=odm_info.get("progress"),
                date_created=odm_info.get("dateCreated"),
                processing_time=odm_info.get("processingTime"),
                dtm_task_id=str(dtm_task_id),
                task_index=task_index,
            )

            # Reconcile: DB says STARTED but NodeODM says otherwise
            if db_state == "IMAGE_PROCESSING_STARTED" and status_code in (30, 40, 50):
                if status_code == 40:
                    # Completed on NodeODM but webhook was missed.
                    # Trigger the same asset-download pipeline the webhook uses.
                    await redis_pool.enqueue_job(
                        "process_odm_webhook_assets",
                        node_odm_url=odm_url,
                        dtm_project_id=str(project.id),
                        odm_task_id=odm_uuid,
                        state_name=State.IMAGE_PROCESSING_STARTED.name,
                        message="Reconciled: processing completed on NodeODM (missed webhook).",
                        dtm_task_id=str(dtm_task_id),
                        odm_status_code=40,
                        _job_id=f"odm-assets:task:{dtm_task_id}",
                        _queue_name="default_queue",
                    )
                    reconciled.append(
                        f"Task {task_index} ({dtm_task_id}): STARTED -> downloading assets (missed webhook)"
                    )
                    log.warning(
                        "Reconciling completed task (missed webhook): project={} dtm_task={} odm_uuid={}",
                        project.id,
                        dtm_task_id,
                        odm_uuid,
                    )
                else:
                    # Failed or canceled - just flip the state
                    try:
                        await task_logic.update_task_state_system(
                            db,
                            project.id,
                            dtm_task_id,
                            f"Reconciled: NodeODM reports {status_label}",
                            State.IMAGE_PROCESSING_STARTED,
                            State.IMAGE_PROCESSING_FAILED,
                            timestamp(),
                        )
                        reconciled.append(
                            f"Task {task_index} ({dtm_task_id}): STARTED -> FAILED ({status_label})"
                        )
                        log.warning(
                            "Reconciled stuck task: project={} dtm_task={} odm_uuid={} odm_status={}",
                            project.id,
                            dtm_task_id,
                            odm_uuid,
                            status_label,
                        )
                    except Exception as e:
                        log.error("Failed to reconcile task {}: {}", dtm_task_id, e)
        elif fetch_failed:
            # Could not reach NodeODM for this task (timeout, network error).
            # Do NOT reconcile - the task may still be running. Show it as
            # "in progress" based on the DB state so the UI doesn't flip to failed.
            if db_state == "IMAGE_PROCESSING_STARTED":
                status_code = 20
                status_label = "Running (status pending)"
                log.debug(
                    "Skipping reconciliation for task {} (fetch failed), keeping STARTED state",
                    dtm_task_id,
                )
            elif db_state == "IMAGE_PROCESSING_FINISHED":
                continue
            elif db_state == "IMAGE_PROCESSING_FAILED":
                status_code = 30
                status_label = "Failed"
            else:
                status_code = 0
                status_label = f"Unknown ({db_state})"

            t = project_schemas.OdmQueueTask(
                uuid=odm_uuid,
                name=f"Task {task_index}",
                status_code=status_code,
                status_label=status_label,
                dtm_task_id=str(dtm_task_id),
                task_index=task_index,
            )
        else:
            # NodeODM returned a valid response but doesn't know this task
            # (deleted/expired). Only treat as a definitive loss if the task
            # has been in STARTED state long enough; otherwise it may simply
            # not have been registered on NodeODM yet.
            state_entered_at = db_task.get("state_entered_at")
            if db_state == "IMAGE_PROCESSING_STARTED":
                age_ok = True
                if state_entered_at:
                    entered = state_entered_at
                    if entered.tzinfo is None:
                        entered = entered.replace(tzinfo=timezone.utc)
                    age_sec = (datetime.now(timezone.utc) - entered).total_seconds()
                    age_ok = age_sec >= NOT_FOUND_AGE_THRESHOLD_SEC

                if not age_ok:
                    # Too young to declare lost - keep showing as running.
                    status_code = 20
                    status_label = "Running (awaiting NodeODM registration)"
                    log.debug(
                        "Skipping not-found reconciliation for task {} "
                        "(only {}s in STARTED, threshold {}s)",
                        dtm_task_id,
                        int(age_sec),
                        NOT_FOUND_AGE_THRESHOLD_SEC,
                    )
                else:
                    # Old enough - mark as failed since NodeODM lost it.
                    status_code = 30
                    status_label = "Failed (lost)"
                    try:
                        await task_logic.update_task_state_system(
                            db,
                            project.id,
                            dtm_task_id,
                            "Reconciled: task not found on NodeODM",
                            State.IMAGE_PROCESSING_STARTED,
                            State.IMAGE_PROCESSING_FAILED,
                            timestamp(),
                        )
                        reconciled.append(
                            f"Task {task_index} ({dtm_task_id}): STARTED -> FAILED (not found on NodeODM)"
                        )
                        log.warning(
                            "Reconciled lost task: project={} dtm_task={} odm_uuid={} not found on NodeODM",
                            project.id,
                            dtm_task_id,
                            odm_uuid,
                        )
                    except Exception as e:
                        log.error(
                            "Failed to reconcile lost task {}: {}", dtm_task_id, e
                        )
            elif db_state == "IMAGE_PROCESSING_FINISHED":
                continue
            elif db_state == "IMAGE_PROCESSING_FAILED":
                status_code = 30
                status_label = "Failed"
            else:
                status_code = 0
                status_label = f"Unknown ({db_state})"

            t = project_schemas.OdmQueueTask(
                uuid=odm_uuid,
                name=f"Task {task_index}",
                status_code=status_code,
                status_label=status_label,
                dtm_task_id=str(dtm_task_id),
                task_index=task_index,
            )

        if t.status_code in ODM_QUEUE_DISPLAY_CODES:
            groups_map[t.status_code].append(t)

    # Sort each group by task_index
    for code in groups_map:
        groups_map[code].sort(key=lambda t: t.task_index or 0)

    # Build ordered groups: Running, Queued, Failed
    display_order = [20, 10, 30]
    groups = []
    for code in display_order:
        if code in groups_map:
            groups.append(
                project_schemas.OdmStatusGroup(
                    status_code=code,
                    status_label=ODM_STATUS_LABELS.get(code, f"Unknown ({code})"),
                    count=len(groups_map[code]),
                    tasks=groups_map[code],
                )
            )
    # Include any unexpected status codes at the end
    for code in sorted(groups_map.keys()):
        if code not in display_order:
            groups.append(
                project_schemas.OdmStatusGroup(
                    status_code=code,
                    status_label=ODM_STATUS_LABELS.get(code, f"Unknown ({code})"),
                    count=len(groups_map[code]),
                    tasks=groups_map[code],
                )
            )

    queued_count = len(groups_map.get(10, []))
    running_count = len(groups_map.get(20, []))
    failed_count = len(groups_map.get(30, []))
    completed_count = 0
    canceled_count = 0

    # Queue position for a specific task
    queue_position = None
    if task_id:
        queued_tasks = groups_map.get(10, [])
        for i, t in enumerate(queued_tasks):
            if t.dtm_task_id == str(task_id):
                queue_position = i + 1
                break

    if reconciled:
        log.info(
            "Reconciled {} stuck task(s) for project {}: {}",
            len(reconciled),
            project.id,
            reconciled,
        )

    log.info(
        "ODM queue info for project_id={}: running={} queued={} failed={} completed={} canceled={} total={} reconciled={}",
        project.id,
        running_count,
        queued_count,
        failed_count,
        completed_count,
        canceled_count,
        queued_count + running_count + failed_count,
        len(reconciled),
    )

    return project_schemas.OdmQueueInfo(
        total_queued=queued_count,
        total_running=running_count,
        total_failed=failed_count,
        total_completed=completed_count,
        total_canceled=canceled_count,
        total_tasks=queued_count + running_count + failed_count,
        queue_position=queue_position,
        groups=groups,
    )


@router.get(
    "/odm/export/{project_id}/{task_id}/orthophoto/",
    tags=["Image Processing"],
)
@router.get(
    "/odm/export/{project_id}/orthophoto/",
    tags=["Image Processing"],
)
async def export_odm_orthophoto(
    request: Request,
    project_id: uuid.UUID,
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    task_id: Optional[uuid.UUID] = None,
):
    """Stream only the orthophoto TIF for a task (or whole project).

    Much smaller than the full ODM assets ZIP - ideal for low-bandwidth
    contexts where only the orthophoto preview is needed.
    """
    task_segment = f"{task_id}/" if task_id else ""
    ortho_key = (
        f"projects/{project.id}/{task_segment}odm/odm_orthophoto/odm_orthophoto.tif"
    )

    try:
        s3_client().stat_object(settings.S3_BUCKET_NAME, ortho_key)
    except Exception:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND,
            detail="No orthophoto found for this task.",
        )

    label = task_id or project_id
    filename = f"orthophoto_{label}.tif"

    def generate():
        response = s3_client().get_object(settings.S3_BUCKET_NAME, ortho_key)
        try:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            response.close()
            response.release_conn()

    return StreamingResponse(
        generate(),
        media_type="image/tiff",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get(
    "/odm/export/{project_id}/{task_id}/",
    tags=["Image Processing"],
)
@router.get(
    "/odm/export/{project_id}/",
    tags=["Image Processing"],
)
async def export_odm_assets(
    request: Request,
    project_id: uuid.UUID,
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    task_id: Optional[uuid.UUID] = None,
    # Uncomment to enforce auth (see TODO in body):
    # user_data: Annotated[AuthUser, Depends(login_required)] = None,
):
    """Stream-zip all ODM assets for a task (or whole project) into a single download.

    Streams the zip on-the-fly using ``stream-zip`` - no full archive is
    ever materialised in memory.  ZIP64 extensions are used automatically
    for large files.

    When ``task_id`` is provided, exports ``projects/{pid}/{tid}/odm/``.
    When omitted, exports the project-level ``projects/{pid}/odm/`` prefix
    (produced by final/whole-project processing).

    Currently public (no auth required) so any user can download assets.
    """
    # TODO: Re-enable auth when we have proper role-based access control.
    # To enable, uncomment the `user_data` dependency in the signature above
    # and the check below. Works for both legacy JWT (access-token header)
    # and Hanko (session cookie - browser sends it automatically on <a>
    # downloads, so no query-param token fallback is needed).
    # if not (user_data.is_superuser or project.author_id == user_data.id):
    #     raise HTTPException(
    #         status_code=HTTPStatus.FORBIDDEN,
    #         detail="Only the project creator may export ODM assets",
    #     )

    task_segment = f"{task_id}/" if task_id else ""
    prefix = f"projects/{project.id}/{task_segment}odm/"

    # Probe for at least one object so we can 404 before streaming starts,
    # then list lazily during the stream to avoid loading all metadata upfront.
    probe = next(
        s3_client().list_objects(
            settings.S3_BUCKET_NAME, prefix=prefix, recursive=False
        ),
        None,
    )
    if probe is None:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND,
            detail="No ODM assets found.",
        )

    filename = (
        f"odm_assets_{task_id}.zip" if task_id else f"odm_assets_{project_id}.zip"
    )

    def member_files():
        for obj in s3_client().list_objects(
            settings.S3_BUCKET_NAME, prefix=prefix, recursive=True
        ):
            if obj.is_dir:
                continue
            name = obj.object_name[len(prefix) :]
            modified = obj.last_modified

            def chunks(object_name=obj.object_name):
                response = s3_client().get_object(settings.S3_BUCKET_NAME, object_name)
                try:
                    while True:
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        yield chunk
                finally:
                    response.close()
                    response.release_conn()

            yield name, modified, 0o644, NO_COMPRESSION_64, chunks()

    def generate():
        yield from stream_zip(member_files())

    return StreamingResponse(
        generate(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# Endpoint not used in production but useful to keep around just for testing the
# queue
@router.post("/test/arq_task")
async def test(redis_pool: ArqRedis = Depends(get_redis_pool)):
    try:
        job = await redis_pool.enqueue_job(
            "sleep_task",
            _queue_name="default_queue",
        )

        log.info(f"Successfully enqueued sleep_task with job ID: {job.job_id}")
        return {
            "status": "success",
            "job_id": job.job_id,
            "message": "Task enqueued successfully",
        }

    except Exception as e:
        log.error(f"Error enqueueing sleep_task: {str(e)}")
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Failed to enqueue task: {str(e)}",
        )
