import uuid
import geojson
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from app.config import settings
from drone_flightplan import create_flightplan, waypoints
from app.models.enums import HTTPStatus
from app.tasks.task_crud import get_task_geojson
from app.projects.project_crud import get_project_by_id
from app.db import database
from app.utils import merge_multipolygon
from app.s3 import get_file_from_bucket
from databases import Database


# Constant to convert gsd to Altitude above ground level
GSD_to_AGL_CONST = 29.7  # For DJI Mini 4 Pro

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/waypoint",
    tags=["waypoint"],
    responses={404: {"description": "Not found"}},
)


@router.get("/task/{task_id}/")
async def get_task_waypoint(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    download: bool = True,
    db: Database = Depends(database.get_db),
):
    """
    Retrieve task waypoints and download a flight plan.

    Args:
        project_id (uuid.UUID): The UUID of the project.
        task_id (uuid.UUID): The UUID of the task.
        download (bool): Flag to determine if the output should be downloaded or returned as GeoJSON. Defaults to True.

    Returns:
        geojson or FileResponse: If `download` is False, returns waypoints as a GeoJSON object.
                                If `download` is True, returns a KMZ file as a download response.
    """

    task_geojson = await get_task_geojson(db, task_id)
    project = await get_project_by_id(db, project_id)

    forward_overlap = project.front_overlap if project.front_overlap else 70
    side_overlap = project.side_overlap if project.side_overlap else 70
    generate_each_points = False
    generate_3d = False

    gsd = project.gsd_cm_px
    altitude = project.altitude_from_ground

    if not download:
        points = waypoints.create_waypoint(
            task_geojson,
            altitude,
            gsd,
            forward_overlap,
            side_overlap,
            generate_each_points,
            generate_3d,
        )
        return geojson.loads(points)

    else:
        if project.is_terrain_follow:
            dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"
            get_file_from_bucket(
                settings.S3_BUCKET_NAME, f"dem/{project_id}/dem.tif", dem_path
            )
        output_file = create_flightplan.create_flightplan(
            aoi=task_geojson,
            forward_overlap=forward_overlap,
            side_overlap=side_overlap,
            agl=altitude,
            gsd=gsd,
            generate_each_points=generate_each_points,
            dem=dem_path if project.is_terrain_follow else None,
            outfile=f"/tmp/{uuid.uuid4()}",
        )

        return FileResponse(
            output_file, media_type="application/zip", filename="output.kmz"
        )


@router.post("/")
async def generate_kmz(
    project_geojson: UploadFile = File(
        ...,
        description="The GeoJSON file representing the project area. This file will be used to define the boundaries and paths for the flight plan.",
    ),
    altitude: float = Form(
        None,
        description="The altitude at which the drone should fly during the mission, in meters.",
    ),
    gsd: float = Form(
        None,
        description="Excepted gsd value",
    ),
    download: bool = Form(
        True,
        description="A flag indicating weather you want to download the kmz file or view the waypoint coordinates first. If True, file will be downloaded directly",
    ),
    forward_overlap: float = Form(
        75,
        description="The percentage of overlap between images taken during the mission.",
    ),
    side_overlap: float = Form(
        70,
        description="The percentage of overlap between images taken during the mission.",
    ),
    generate_each_points: bool = Form(
        False,
        description="A flag indicating weather you want to generate waypoints for each point in the boundary and capture image at each point or just at the end of the waylines",
    ),
    generate_3d: bool = Form(
        False,
        description="A flag indicating weather you want to generate 3D imageries or not (To generate 3D imagery, we need to click images at 3 different angles -90, -45 and lateral 45 degree angle)",
    ),
    terrain_follow: bool = Form(
        False,
        description="A flag indicating weather you want to generate flight plan with terrain follow.",
    ),
    dem: UploadFile = File(
        None,
        description="The Digital Elevation Model (DEM) file that will be used to generate the terrain follow flight plan. This file should be in GeoTIFF format",
    ),
):
    if not (altitude or gsd):
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Either altitude or gsd is required",
        )

    if terrain_follow:
        if not dem:
            raise HTTPException(
                status_code=400,
                detail="DEM file is required for terrain follow",
            )
        if dem.content_type != "image/tiff":
            raise HTTPException(
                status_code=400,
                detail="DEM file should be in GeoTIFF format",
            )

        dem_path = f"/tmp/{dem.filename}"
        with open(dem_path, "wb") as buffer:
            shutil.copyfileobj(dem.file, buffer)

    boundary = merge_multipolygon(geojson.loads(await project_geojson.read()))

    if not download:
        points = waypoints.create_waypoint(
            boundary,
            altitude,
            gsd,
            forward_overlap,
            side_overlap,
            generate_each_points,
            generate_3d,
        )
        return geojson.loads(points)
    else:
        output_file = create_flightplan.create_flightplan(
            aoi=boundary,
            forward_overlap=forward_overlap,
            side_overlap=side_overlap,
            agl=altitude,
            gsd=gsd,
            generate_each_points=generate_each_points,
            dem=dem_path if dem else None,
            outfile=f"/tmp/{uuid.uuid4()}",
        )

        return FileResponse(
            output_file, media_type="application/zip", filename="output.kmz"
        )
