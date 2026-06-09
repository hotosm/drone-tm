import json
import uuid
from datetime import timedelta
from typing import Annotated, Dict, List, Optional
from uuid import UUID

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
)
from app.images.image_classification import ImageClassifier
from app.projects import project_deps, project_logic, project_schemas
from app.projects.project_deps import normalize_aoi
from app.projects.oam import upload_to_oam
from app.projects.s3_paths import (
    cloudnative_project_root_prefix,
    public_qfield_zip_key,
)
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
from app.tasks import task_schemas
from app.users.permissions import (
    IsProjectCreator,
    IsSuperUser,
    check_permissions,
)
from app.users.user_deps import login_dependency, login_required
from app.users.user_schemas import AuthUser
from app.utils import (
    geojson_to_kml,
    send_project_approval_email_to_regulator,
)

router = APIRouter(
    prefix="/projects",
    responses={404: {"description": "Not found"}},
)


def _odm_assets_prefix(project_id: uuid.UUID, task_id: Optional[uuid.UUID]) -> str:
    task_segment = f"{task_id}/" if task_id else ""
    return f"projects/{project_id}/{task_segment}odm/"


def _odm_assets_available(prefix: str) -> bool:
    probe = next(
        s3_client().list_objects(
            settings.S3_BUCKET_NAME, prefix=prefix, recursive=True
        ),
        None,
    )
    return probe is not None


def _odm_assets_filename(project_id: uuid.UUID, task_id: Optional[uuid.UUID]) -> str:
    return f"odm_assets_{task_id}.zip" if task_id else f"odm_assets_{project_id}.zip"


def _raise_no_odm_assets() -> None:
    raise HTTPException(
        status_code=HTTPStatus.NOT_FOUND,
        detail="No ODM assets found for this project.",
    )


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


@router.get("/{project_id}/terrain-dem", tags=["Projects"])
async def download_terrain_dem(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Stream the terrain-follow DEM GeoTIFF used for flight planning.

    This is the input DEM (e.g. from JAXA) stored at
    ``projects/{project_id}/dem.tif`` - not the DEM produced by ODM.
    """
    if not project.is_terrain_follow:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND,
            detail="Terrain-follow is not enabled for this project.",
        )

    dem_key = f"projects/{project.id}/dem.tif"
    if not check_file_exists(settings.S3_BUCKET_NAME, dem_key):
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND,
            detail="No terrain DEM found for this project.",
        )

    filename = f"terrain_dem_{project.id}.tif"

    def generate():
        response = s3_client().get_object(settings.S3_BUCKET_NAME, dem_key)
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

    # After DB rows are gone, purge every S3 prefix that belongs to this
    # project. Each is best-effort: an S3 hiccup must not roll back the DB
    # delete that already committed, and the sweeper script under scripts/
    # can pick up anything left behind.
    #
    # The three roots we own per project:
    #   projects/{id}/                          - raw ODM input + output (private)
    #   publicuploads/cloudnative/{id}/         - 3D tiles + COG (public)
    #   publicuploads/qfield/{id}.zip           - QField export (public)
    for prefix in (
        f"projects/{project_id}/",
        f"{cloudnative_project_root_prefix(project_id)}/",
        public_qfield_zip_key(project_id),
    ):
        try:
            deleted = delete_objects_by_prefix(settings.S3_BUCKET_NAME, prefix)
            log.info(
                "Deleted {} S3 objects under {} for project {}",
                deleted,
                prefix,
                project_id,
            )
        except Exception as e:
            log.error(
                "S3 cleanup failed at {} for project {}: {}", prefix, project_id, e
            )

    return {"message": f"Project successfully deleted {project_id}"}


@router.post("/", tags=["Projects"])
async def create_project(
    project_info: project_schemas.ProjectIn,
    db: Annotated[Connection, Depends(database.get_db)],
    background_tasks: BackgroundTasks,
    user_data: Annotated[AuthUser, Depends(login_dependency)],
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

    # The frontend immediately follows this response with
    # /upload-task-boundaries. Commit here so that dependency can read the
    # project from a new DB transaction.
    await db.commit()

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
    odm_url: Optional[str] = Query(None, description="Custom ScaleODM server URL"),
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
    capacity_type: Annotated[Optional[str], Body(embed=True)] = None,
):
    """API endpoint to process all tasks associated with a project.

    Submits a single ScaleODM run with ``processingMode=standard`` and a
    project-wide ``s3ScanDepth`` so all per-task ``images/`` subdirs roll
    up into one ODM run. If a GCP file has been saved for this project
    (via POST /gcp/save/), it will be automatically included.
    """
    user_id = user_data.id

    if project.image_processing_status == "PROCESSING":
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail="Image processing is already running for this project.",
        )

    (
        ready_tasks,
        has_imagery_tasks,
        pending_transfer_count,
    ) = await project_logic.get_processable_tasks_with_pending_transfer_count(
        project.id, db
    )

    all_tasks = ready_tasks + has_imagery_tasks
    if not all_tasks:
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            detail="No tasks have imagery available for processing.",
        )

    if pending_transfer_count > 0:
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail=(
                "Imagery for some tasks is still being transferred. "
                "Please wait and retry processing."
            ),
        )

    # Flip to PROCESSING and reset the cloudnative flags atomically. The
    # ARQ worker (process_all_drone_images) re-runs this kind of reset
    # later, but that's after worker latency - between the two updates the
    # project would otherwise have status=PROCESSING coexisting with
    # cloud_*_ready=true (from a prior run), causing the API to keep
    # emitting the old viewer URL and the UI to keep showing "View" while
    # ODM is actually reprocessing.
    await db.execute(
        """
        UPDATE projects
        SET image_processing_status = %(status)s,
            cloud_ortho_ready = false,
            cloud_mesh_ready = false,
            cloud_ortho_generating = false,
            cloud_mesh_generating = false,
            last_updated = NOW()
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
        all_tasks,
        user_id,
        capacity_type,
        _queue_name="default_queue",
    )

    return {
        "message": f"Processing started for {len(all_tasks)} tasks"
        f" ({len(ready_tasks)} verified, {len(has_imagery_tasks)} unverified).",
        "job_id": job.job_id,
    }


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
    if task_id is None:
        tasks = await project_deps.get_tasks_by_project_id(project.id, db)
        task_ids = [task.get("id") for task in tasks]
        return await project_logic.get_assets_info_bulk(db, project.id, task_ids)

    results = await project_logic.get_assets_info_bulk(db, project.id, [task_id])
    return results[0] if results else None


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
    s3_key = public_qfield_zip_key(project_id)
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


def _stream_s3_object_response(
    s3_key: str,
    *,
    not_found_detail: str,
    download_filename: str,
    media_type: str,
) -> StreamingResponse:
    """Common streamer for the per-product export endpoints below.

    Keeps the per-route bodies thin so adding a new export (e.g. mesh OBJ)
    later is just a one-line wrapper rather than another copy-pasted block.
    """
    try:
        s3_client().stat_object(settings.S3_BUCKET_NAME, s3_key)
    except Exception:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail=not_found_detail)

    def generate():
        response = s3_client().get_object(settings.S3_BUCKET_NAME, s3_key)
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
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={download_filename}"},
    )


@router.get(
    "/odm/export/{project_id}/dsm/",
    tags=["Image Processing"],
)
async def export_odm_dsm(
    project_id: uuid.UUID,
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
):
    """Stream the DSM (Digital Surface Model, top-of-canopy) GeoTIFF."""
    return _stream_s3_object_response(
        f"projects/{project.id}/odm/odm_dem/dsm.tif",
        not_found_detail="No DSM found for this project.",
        download_filename=f"dsm_{project_id}.tif",
        media_type="image/tiff",
    )


@router.get(
    "/odm/export/{project_id}/dtm/",
    tags=["Image Processing"],
)
async def export_odm_dtm(
    project_id: uuid.UUID,
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
):
    """Stream the DTM (Digital Terrain Model, bare-ground) GeoTIFF."""
    return _stream_s3_object_response(
        f"projects/{project.id}/odm/odm_dem/dtm.tif",
        not_found_detail="No DTM found for this project.",
        download_filename=f"dtm_{project_id}.tif",
        media_type="image/tiff",
    )


@router.get(
    "/odm/export/{project_id}/pointcloud/",
    tags=["Image Processing"],
)
async def export_odm_pointcloud(
    project_id: uuid.UUID,
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
):
    """Stream the point cloud LAZ file for the project-level ODM output."""
    return _stream_s3_object_response(
        f"projects/{project.id}/odm/odm_georeferencing/odm_georeferenced_model.laz",
        not_found_detail="No point cloud found for this project.",
        download_filename=f"pointcloud_{project_id}.laz",
        media_type="application/octet-stream",
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

    prefix = _odm_assets_prefix(project.id, task_id)

    # Probe for at least one object so we can 404 before streaming starts,
    # then list lazily during the stream to avoid loading all metadata upfront.
    # Use recursive=True so we find files at any depth (e.g. odm_orthophoto/odm_orthophoto.tif)
    # rather than relying on common-prefix returns which vary by S3 implementation.
    if not _odm_assets_available(prefix):
        _raise_no_odm_assets()

    filename = _odm_assets_filename(project_id, task_id)

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


@router.head(
    "/odm/export/{project_id}/{task_id}/",
    tags=["Image Processing"],
)
@router.head(
    "/odm/export/{project_id}/",
    tags=["Image Processing"],
)
async def head_odm_assets(
    request: Request,
    project_id: uuid.UUID,
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    task_id: Optional[uuid.UUID] = None,
):
    """Check whether ODM assets exist without streaming the zip."""
    prefix = _odm_assets_prefix(project.id, task_id)
    if not _odm_assets_available(prefix):
        _raise_no_odm_assets()

    filename = _odm_assets_filename(project_id, task_id)
    return Response(
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# Cloudnative outputs (3D tiles + orthophoto COG)
#
# Both live under ``publicuploads/cloudnative/{project_id}/...`` so the
# browser streams them directly from S3/CDN. No proxy route exists by
# design - the previous proxy did a full project DB load per tile request
# (via the get_project_by_id dependency), which dominated tile-fetch
# latency on low-end clients.
#
# Generation is user-triggered via the two endpoints below: the project UI
# shows "Convert 2D / 3D to View" buttons that POST here, then polls until
# the ``cloud_*_ready`` flag flips and the URL appears in the response.
# Skipping auto-generation means projects whose users never open the viewer
# don't burn worker compute.
#
# The frontend reads ``cloud_mesh_tileset_url`` / ``cloud_ortho_cog_url``
# off the project response (see ProjectInfo.set_cloudnative_urls).
# ---------------------------------------------------------------------------


_GENERATING_COLUMNS = {"cloud_ortho_generating", "cloud_mesh_generating"}


async def _set_generating_flag(
    db: Connection, project_id: uuid.UUID, column: str
) -> None:
    assert column in _GENERATING_COLUMNS  # hardcoded; not user input
    await db.execute(
        f"UPDATE projects SET {column} = true WHERE id = %(pid)s",
        {"pid": project_id},
    )
    await db.commit()


async def _clear_generating_flag(
    db: Connection, project_id: uuid.UUID, column: str
) -> None:
    assert column in _GENERATING_COLUMNS
    await db.execute(
        f"UPDATE projects SET {column} = false WHERE id = %(pid)s",
        {"pid": project_id},
    )
    await db.commit()


async def _trigger_cloudnative_job(
    db: Connection,
    project_id: uuid.UUID,
    redis_pool: ArqRedis,
    *,
    function: str,
    job_id: str,
    generating_column: str,
) -> dict:
    """Set the generating flag, then enqueue. Roll back on failure.

    Ordering matters: the worker's ``finally`` clears the same flag, so a
    fast-exiting worker (e.g. ``source_missing`` skip) might fire its
    clear *before* we get a chance to set the flag, leaving the UI stuck
    on "Converting". Setting the flag first means there's nothing for the
    worker to clear prematurely - the flag is always true throughout the
    worker's lifetime, then cleared in its finally.

    Rollback: if the enqueue raises or ARQ refuses (None - deterministic
    job id is already queued / has a cached result), we clear the flag
    so the UI doesn't poll forever for a worker that isn't running.
    """
    await _set_generating_flag(db, project_id, generating_column)
    try:
        job = await redis_pool.enqueue_job(
            function,
            project_id=str(project_id),
            _job_id=job_id,
            _queue_name="default_queue",
        )
    except Exception:
        await _clear_generating_flag(db, project_id, generating_column)
        raise

    if job is None:
        await _clear_generating_flag(db, project_id, generating_column)
        return {"status": "already_generating"}
    return {"status": "enqueued"}


@router.post(
    "/{project_id}/cloudnative/orthophoto",
    tags=["Cloudnative"],
    status_code=HTTPStatus.ACCEPTED,
)
async def trigger_orthophoto_conversion(
    db: Annotated[Connection, Depends(database.get_db)],
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    redis_pool: ArqRedis = Depends(get_redis_pool),
):
    """Kick off COG generation for this project's orthophoto.

    Deterministic ``_job_id`` collapses double-clicks to one ARQ job. The
    worker's finally clears ``cloud_ortho_generating``; re-conversion
    overwrites the prior COG in place.
    """
    if project.image_processing_status != "SUCCESS":
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail="ODM processing must complete before converting outputs.",
        )
    if project.cloud_ortho_ready:
        return {"status": "already_ready"}
    if project.cloud_ortho_generating:
        # Worker is already running for this project; UI will catch the
        # flip via its polling refetchInterval.
        return {"status": "already_generating"}

    return await _trigger_cloudnative_job(
        db,
        project.id,
        redis_pool,
        function="generate_orthophoto_cog",
        job_id=f"cog:{project.id}",
        generating_column="cloud_ortho_generating",
    )


@router.post(
    "/{project_id}/cloudnative/mesh",
    tags=["Cloudnative"],
    status_code=HTTPStatus.ACCEPTED,
)
async def trigger_mesh_conversion(
    db: Annotated[Connection, Depends(database.get_db)],
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    redis_pool: ArqRedis = Depends(get_redis_pool),
):
    """Kick off 3D Tiles generation for this project's textured mesh.

    Same shape as ``trigger_orthophoto_conversion``. No ``final_output``
    gate - ODM always produces the textured mesh - and no source probe
    here either (the worker skips cleanly with ``source_missing`` and
    the UI already gates the button on ``mesh_source_available``).
    """
    if project.image_processing_status != "SUCCESS":
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT,
            detail="ODM processing must complete before converting outputs.",
        )
    if project.cloud_mesh_ready:
        return {"status": "already_ready"}
    if project.cloud_mesh_generating:
        return {"status": "already_generating"}

    return await _trigger_cloudnative_job(
        db,
        project.id,
        redis_pool,
        function="generate_3d_tiles",
        job_id=f"3dtiles:{project.id}",
        generating_column="cloud_mesh_generating",
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
