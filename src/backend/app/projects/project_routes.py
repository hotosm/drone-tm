import json
import os
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
from geojson_pydantic import FeatureCollection
from loguru import logger as log
from psycopg import Connection
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from app.arq.tasks import get_redis_pool
from app.config import settings
from app.db import database
from app.jaxa.upload_dem import upload_dem_file
from app.models.enums import HTTPStatus, OAMUploadStatus, ProjectCompletionStatus, State
from app.projects import image_processing, project_deps, project_logic, project_schemas
from app.projects.oam import upload_to_oam
from app.s3 import (
    abort_multipart_upload,
    add_file_to_bucket,
    complete_multipart_upload,
    get_presigned_upload_part_url,
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
    prefix=f"{settings.API_PREFIX}/projects",
    responses={404: {"description": "Not found"}},
)


@router.get(
    "/centroids", tags=["Projects"], response_model=list[project_schemas.CentroidOut]
)
async def read_project_centroids(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
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
    project_id = await project_schemas.DbProject.create(db, project_info, user_data.id)

    # Upload DEM and Image to S3
    dem_url = (
        await project_logic.upload_file_to_s3(project_id, dem, "dem.tif")
        if dem
        else None
    )
    (
        await project_logic.upload_file_to_s3(project_id, image, "map_screenshot.png")
        if image
        else None
    )

    # Update DEM and Image URLs in the database
    await project_logic.update_url(db, project_id, dem_url)

    if not project_id:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project creation failed"
        )

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
        background_tasks.add_task(upload_dem_file, geometry, project_id)

    return {"message": "Project successfully created", "project_id": project_id}


@router.post("/{project_id}/upload-task-boundaries", tags=["Projects"])
async def upload_project_task_boundaries(
    background_tasks: BackgroundTasks,
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
    await project_logic.create_tasks_from_geojson(
        db, project.id, task_featcol, project, background_tasks
    )

    return {
        "message": "Project Boundary Upload Initiated",
        "project_id": f"{project.id}",
    }


@router.post("/preview-split-by-square/", tags=["Projects"])
async def preview_split_by_square(
    user: Annotated[AuthUser, Depends(login_required)],
    project_geojson: UploadFile = File(...),
    no_fly_zones: UploadFile = File(default=None),
    dimension: int = Form(100),
):
    """Preview splitting by square."""
    # Validating for .geojson File.
    file_name = os.path.splitext(project_geojson.filename)
    file_ext = file_name[1]
    allowed_extensions = [".geojson", ".json"]
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Provide a valid .geojson file")

    # read entire file
    content = await project_geojson.read()
    boundary = geojson.loads(content)
    project_shape = shape(boundary["features"][0]["geometry"])

    # If no_fly_zones is provided, read and parse it
    if no_fly_zones:
        no_fly_content = await no_fly_zones.read()
        no_fly_zones_geojson = geojson.loads(no_fly_content)
        no_fly_shapes = [
            shape(feature["geometry"]) for feature in no_fly_zones_geojson["features"]
        ]
        no_fly_union = unary_union(no_fly_shapes)

        # Calculate the difference between the project shape and no-fly zones
        new_outline = project_shape.difference(no_fly_union)
    else:
        new_outline = project_shape

    result_geojson = geojson.Feature(geometry=mapping(new_outline))

    result = await project_logic.preview_split_by_square(result_geojson, dimension)

    return result


@router.post("/generate-presigned-url/", tags=["Image Upload"])
async def generate_presigned_url(
    db: Annotated[Connection, Depends(database.get_db)],
    user: Annotated[AuthUser, Depends(login_required)],
    data: project_schemas.PresignedUrlRequest,
    replace_existing: bool = False,
):
    """Generate a pre-signed URL for uploading an image to S3 Bucket.

    This endpoint generates a pre-signed URL that allows users to upload an image to
    an S3 bucket. The URL expires after a specified duration.

    Args:
        image_name: The name of the image(s) you want to upload.
        expiry : Expiry time in hours.
        replace_existing: A boolean flag to indicate if the image should be replaced.

    Returns:
        list: A list of dictionaries with the image name and the pre-signed URL to upload.
    """
    try:
        # Initialize the S3 client
        client = s3_client()
        urls = []

        # Process each image in the request
        for image in data.image_name:
            image_path = (
                f"dtm-data/projects/{data.project_id}/{data.task_id}/images/{image}"
            )

            # If replace_existing is True, delete the image first
            if replace_existing:
                image_dir = (
                    f"dtm-data/projects/{data.project_id}/{data.task_id}/images/"
                )
                try:
                    # List objects to delete
                    paginator = client.get_paginator('list_objects_v2')
                    pages = paginator.paginate(
                        Bucket=settings.S3_BUCKET_NAME,
                        Prefix=image_dir.lstrip("/")
                    )

                    # Collect all objects to delete
                    objects_to_delete = []
                    for page in pages:
                        if 'Contents' in page:
                            for obj in page['Contents']:
                                objects_to_delete.append({'Key': obj['Key']})

                    # Delete objects if any exist
                    if objects_to_delete:
                        response = client.delete_objects(
                            Bucket=settings.S3_BUCKET_NAME,
                            Delete={
                                'Objects': objects_to_delete,
                                'Quiet': True
                            }
                        )

                        # Handle deletion errors, if any
                        if 'Errors' in response:
                            for error in response['Errors']:
                                log.error(f"Error occurred when deleting object: {error}")
                                raise HTTPException(
                                    status_code=HTTPStatus.BAD_REQUEST,
                                    detail=f"Failed to delete existing image: {error}",
                                )

                except Exception as e:
                    raise HTTPException(
                        status_code=HTTPStatus.BAD_REQUEST,
                        detail=f"Failed to delete existing image. {e}",
                    )

            # Generate a new pre-signed URL for the image upload
            # Use public endpoint for presigned URLs in local dev
            presigned_client = s3_client(use_public_endpoint=True)
            url = presigned_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': settings.S3_BUCKET_NAME,
                    'Key': image_path.lstrip("/")
                },
                ExpiresIn=data.expiry * 3600  # Convert hours to seconds
            )
            urls.append({"image_name": image, "url": url})

        return urls

    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to generate pre-signed URL. {e}",
        )


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
    user_data: Annotated[AuthUser, Depends(login_required)],
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
    redis_pool: ArqRedis = Depends(get_redis_pool),
):
    """Start an queue task to process drone imagery."""
    user_id = user_data.id
    job = await redis_pool.enqueue_job(
        "process_drone_images",
        project.id,
        task_id,
        user_id,
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
    gcp_file: UploadFile = File(None),
):
    """API endpoint to process all tasks associated with a project."""
    user_id = user_data.id
    if gcp_file:
        gcp_file_path = f"/tmp/{uuid.uuid4()}"
        with open(gcp_file_path, "wb") as f:
            f.write(await gcp_file.read())

        s3_path = f"dtm-data/projects/{project.id}/gcp/gcp_list.txt"
        add_file_to_bucket(settings.S3_BUCKET_NAME, gcp_file_path, s3_path)

    tasks = await project_logic.get_all_tasks_for_project(project.id, db)
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


@router.post("/odm/webhook/{dtm_user_id}/{dtm_project_id}/", tags=["Image Processing"])
async def odm_webhook_for_processing_whole_project(
    request: Request,
    dtm_project_id: uuid.UUID,
    dtm_user_id: str,
    background_tasks: BackgroundTasks,
):
    payload = await request.json()
    odm_task_id = payload.get("uuid")
    status = payload.get("status")

    if not odm_task_id or not status:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    if status["code"] in {30, 40}:
        log.info(f"Project {dtm_project_id}: Processing status {status['code']}")
        background_tasks.add_task(
            image_processing.process_assets_from_odm,
            node_odm_url=settings.NODE_ODM_URL,
            dtm_project_id=dtm_project_id,
            odm_task_id=odm_task_id,
            odm_status_code=status["code"],
        )

    return {"message": "Webhook received", "task_id": dtm_project_id}


@router.post(
    "/odm/webhook/{dtm_user_id}/{dtm_project_id}/{dtm_task_id}/",
    tags=["Image Processing"],
)
async def odm_webhook_for_processing_a_single_task(
    request: Request,
    db: Annotated[Connection, Depends(database.get_db)],
    dtm_project_id: uuid.UUID,
    dtm_task_id: uuid.UUID,
    dtm_user_id: str,
    background_tasks: BackgroundTasks,
):
    payload = await request.json()
    odm_task_id = payload.get("uuid")
    status = payload.get("status")

    if not odm_task_id or not status:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    current_state = await task_logic.get_task_state(db, dtm_project_id, dtm_task_id)
    state_value = State[current_state.get("state")]

    if status["code"] == 40:
        background_tasks.add_task(
            image_processing.process_assets_from_odm,
            node_odm_url=settings.NODE_ODM_URL,
            dtm_project_id=dtm_project_id,
            odm_task_id=odm_task_id,
            state=state_value,
            message="Task completed.",
            dtm_task_id=dtm_task_id,
            dtm_user_id=dtm_user_id,
            odm_status_code=40,
        )

    elif status["code"] == 30 and state_value != State.IMAGE_PROCESSING_FAILED:
        await task_logic.update_task_state(
            db,
            dtm_project_id,
            dtm_task_id,
            dtm_user_id,
            "Image processing failed.",
            state_value,
            State.IMAGE_PROCESSING_FAILED,
            timestamp(),
        )
        background_tasks.add_task(
            image_processing.process_assets_from_odm,
            node_odm_url=settings.NODE_ODM_URL,
            dtm_project_id=dtm_project_id,
            odm_task_id=odm_task_id,
            state=state_value,
            message="Image processing failed.",
            dtm_task_id=dtm_task_id,
            dtm_user_id=dtm_user_id,
            odm_status_code=30,
        )

    return {"message": "Webhook received", "task_id": odm_task_id}


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
    meters: float = 100,
    project_geojson: UploadFile = File(...),
    is_terrain_follow: bool = False,
    dem: UploadFile = File(None),
    user_data: AuthUser = Depends(login_required),
):
    """Count waypoints and waylines within AOI."""
    return await project_logic.process_waypoints_and_waylines(
        side_overlap,
        front_overlap,
        altitude_from_ground,
        gsd_cm_px,
        meters,
        project_geojson,
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
        # Fetch all tasks associated with the project
        tasks = await project_deps.get_tasks_by_project_id(project.id, db)
        results = []

        for task in tasks:
            task_info = project_logic.get_project_info_from_s3(
                project.id, task.get("id")
            )
            results.append(task_info)

        return results
    else:
        current_state = await task_logic.get_task_state(db, project.id, task_id)
        project_info = project_logic.get_project_info_from_s3(project.id, task_id)
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


@router.post("/initiate-multipart-upload/", tags=["Image Upload"])
async def initiate_upload(
    user: Annotated[AuthUser, Depends(login_required)],
    data: project_schemas.MultipartUploadRequest,
):
    """Initiate a multipart upload for large files.

    Args:
        data: Contains project_id, task_id, and file_name.

    Returns:
        dict: Upload ID and file key for the multipart upload session.
    """
    try:
        file_key = f"dtm-data/projects/{data.project_id}/{data.task_id}/images/{data.file_name}"
        upload_id = initiate_multipart_upload(settings.S3_BUCKET_NAME, file_key)

        return {
            "upload_id": upload_id,
            "file_key": file_key,
        }
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
        url = get_presigned_upload_part_url(
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
    data: project_schemas.CompleteMultipartUploadRequest,
):
    """Complete a multipart upload by combining all parts.

    Args:
        data: Contains upload_id, file_key, and list of parts.

    Returns:
        dict: Success message.
    """
    try:
        complete_multipart_upload(
            settings.S3_BUCKET_NAME,
            data.file_key,
            data.upload_id,
            data.parts,
        )

        return {
            "message": "Multipart upload completed successfully",
            "file_key": data.file_key,
        }
    except Exception as e:
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


@router.post("/projects/{project_id}/count-tasks")
async def start_task_count(
    project_id: uuid.UUID, redis: ArqRedis = Depends(get_redis_pool)
):
    """Start an async task to count project tasks"""
    job = await redis.enqueue_job(
        "count_project_tasks",
        str(project_id),
        _queue_name="default_queue",
    )
    return {"job_id": job.job_id}
