import os
from typing import Annotated, Optional
from uuid import UUID
import geojson
from datetime import timedelta
from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    Path,
    Query,
    UploadFile,
    File,
    Form,
    Response,
)
from geojson_pydantic import FeatureCollection
from loguru import logger as log
from psycopg import Connection
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

from app.projects import project_schemas, project_deps, project_logic
from app.db import database
from app.models.enums import HTTPStatus
from app.s3 import s3_client
from app.config import settings
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.tasks import task_schemas

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/projects",
    responses={404: {"description": "Not found"}},
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
):
    """Downloads the AOI or task boundaries for a project as a GeoJSON file.

    Args:
        project_id (UUID): The ID of the project in UUID format.
        db (Connection): The database connection, provided automatically.
        user_data (AuthUser): The authenticated user data, checks if the user has permission.
        task_id (Optional[UUID]): The task ID in UUID format. If not provided and split_area is True, all tasks will be downloaded.
        split_area (bool): Whether to split the area or not. Set to True to download task boundaries, otherwise AOI will be downloaded.

    Returns:
        Response: The HTTP response object containing the downloaded file.
    """
    try:
        out = await task_schemas.Task.get_task_geometry(
            db, project_id, task_id, split_area
        )

        if out is None:
            raise HTTPException(status_code=404, detail="Geometry not found.")

        filename = (
            (f"task_{task_id}.geojson" if task_id else "project_outline.geojson")
            if split_area
            else "project_aoi.geojson"
        )

        headers = {
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Type": "application/geo+json",
        }
        return Response(content=out, headers=headers)

    except HTTPException as e:
        log.error(f"Error during boundaries download: {e.detail}")
        raise e

    except Exception as e:
        log.error(f"Unexpected error during boundaries download: {e}")
        raise HTTPException(status_code=500, detail="Internal server error.")


# @router.get("/{project_id}/download-aoi", tags=["Projects"])
# async def download_project_aoi(
#     project_id: Annotated[
#         UUID,
#         Path(
#             description="The project ID in UUID format.",
#         ),
#     ],
#     db: Annotated[Connection, Depends(database.get_db)],
#     user_data: Annotated[AuthUser, Depends(login_required)],
# ):
#     """Downloads the Area of Interest (AOI) of a project as a GeoJSON file.

#     Args:
#         project_id (UUID): The ID of the project in UUID format.
#         db (Connection): The database connection, provided automatically.
#         user_data (AuthUser): The authenticated user data, checks if the user has permission.

#     Returns:
#         Response: The HTTP response object containing the downloaded AOI file.
#     """
#     try:
#         # Assuming there is a function `get_project_aoi_geometry` to get the AOI geometry
#         out = await task_schemas.Task.get_task_geometry(
#             db, project_id, split_area=False
#         )

#         if out is None:
#             raise HTTPException(
#                 status_code=404, detail="Project AOI geometry not found."
#             )

#         filename = "project_aoi.geojson"

#         headers = {
#             "Content-Disposition": f"attachment; filename={filename}",
#             "Content-Type": "application/geo+json",
#         }
#         return Response(content=out, headers=headers)

#     except HTTPException as e:
#         log.error(f"Error during AOI download: {e.detail}")
#         raise e

#     except Exception as e:
#         log.error(f"Unexpected error during AOI download: {e}")
#         raise HTTPException(status_code=500, detail="Internal server error.")


# @router.get("/{project_id}/download-tasks", tags=["Projects"])
# async def download_task_boundaries(
#     project_id: Annotated[
#         UUID,
#         Path(
#             description="The project ID in UUID format.",
#         ),
#     ],
#     db: Annotated[Connection, Depends(database.get_db)],
#     user_data: Annotated[AuthUser, Depends(login_required)],
#     task_id: Optional[UUID] = Query(
#         default=None,
#         description="The task ID in UUID format. If not provided, all tasks will be downloaded.",
#     ),
# ):
#     """Downloads the boundary of the tasks for a project as a GeoJSON file.

#     Args:
#         project_id (UUID): The ID of the project in UUID format.
#         db (Connection): The database connection, provided automatically.
#         user_data (AuthUser): The authenticated user data, checks if the user has permission.

#     Returns:
#         Response: The HTTP response object containing the downloaded file.
#     """
#     out = await task_schemas.Task.get_task_geometry(
#         db, project_id, task_id, split_area=True
#     )

#     if out is None:
#         raise HTTPException(
#             status_code=404, detail="Task or project geometry not found."
#         )

#     filename = f"task_{task_id}.geojson" if task_id else "project_outline.geojson"

#     headers = {
#         "Content-Disposition": f"attachment; filename={filename}",
#         "Content-Type": "application/geo+json",
#     }
#     return Response(content=out, headers=headers)


@router.delete("/{project_id}", tags=["Projects"])
async def delete_project_by_id(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """
    Delete a project by its ID, along with all associated tasks.

    Args:
        project_id (uuid.UUID): The ID of the project to delete.
        db (Database): The database session dependency.

    Returns:
        dict: A confirmation message.

    Raises:
        HTTPException: If the project is not found.
    """
    project_id = await project_schemas.DbProject.delete(db, project.id)
    return {"message": f"Project successfully deleted {project_id}"}


@router.post("/", tags=["Projects"])
async def create_project(
    project_info: project_schemas.ProjectIn,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    dem: UploadFile = File(None),
    image: UploadFile = File(None),
):
    """Create a project in the database."""
    project_id = await project_schemas.DbProject.create(db, project_info, user_data.id)

    # Upload DEM and Image to S3
    dem_url = (
        await project_logic.upload_file_to_s3(project_id, dem, "dem", "tif")
        if dem
        else None
    )
    await project_logic.upload_file_to_s3(
        project_id, image, "images", "png"
    ) if image else None

    # Update DEM and Image URLs in the database
    await project_logic.update_url(db, project_id, dem_url, "dem_url")

    if not project_id:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Project creation failed"
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
    await project_logic.create_tasks_from_geojson(db, project.id, task_featcol)
    return {"message": "Project Boundary Uploaded", "project_id": f"{project.id}"}


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
    data: project_schemas.PresignedUrlRequest,
    user: Annotated[AuthUser, Depends(login_required)],
):
    """
    Generate a pre-signed URL for uploading an image to S3 Bucket.

    This endpoint generates a pre-signed URL that allows users to upload an image to
    an S3 bucket. The URL expires after a specified duration.

    Args:

        image_name: The name of the image you want to upload
        expiry : Expiry time in hours

    Returns:

        str: The pre-signed URL to upload the image
    """
    try:
        # Generate a pre-signed URL for an object
        client = s3_client()
        urls = []
        for image in data.image_name:
            image_path = f"publicuploads/{data.project_id}/{data.task_id}/{image}"

            url = client.get_presigned_url(
                "PUT",
                settings.S3_BUCKET_NAME,
                image_path,
                expires=timedelta(hours=data.expiry),
            )
            urls.append({"image_name": image, "url": url})

        return urls
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=f"Failed to generate pre-signed URL. {e}",
        )


@router.get("/", tags=["Projects"], response_model=list[project_schemas.ProjectOut])
async def read_projects(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    skip: int = 0,
    limit: int = 100,
):
    "Get all projects with task count."
    try:
        return await project_schemas.DbProject.all(db, skip, limit)
    except KeyError as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND) from e


@router.get(
    "/{project_id}", tags=["Projects"], response_model=project_schemas.ProjectOut
)
async def read_project(
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Get a specific project and all associated tasks by ID."""
    return project
