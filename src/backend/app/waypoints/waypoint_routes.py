import uuid
import geojson
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from app.config import settings
from drone_flightplan import flightplan, waypoints
from app.models.enums import HTTPStatus
from app.tasks.task_crud import get_task_geojson
from app.db import database
from app.utils import merge_multipolygon
from app.s3 import get_file_from_bucket
from typing import Annotated
from psycopg import Connection
from app.projects import project_deps

# Constant to convert gsd to Altitude above ground level
GSD_to_AGL_CONST = 29.7  # For DJI Mini 4 Pro

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/waypoint",
    tags=["waypoint"],
    responses={404: {"description": "Not found"}},
)


@router.get("/task/{task_id}/")
async def get_task_waypoint(
    db: Annotated[Connection, Depends(database.get_db)],
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    download: bool = True,
):
    task_geojson = await get_task_geojson(db, task_id)
    features = task_geojson["features"][0]
    project = await project_deps.get_project_by_id(db, project_id)

    forward_overlap = project.front_overlap if project.front_overlap else 70
    side_overlap = project.side_overlap if project.side_overlap else 70
    generate_each_points = False
    generate_3d = False

    gsd = project.gsd_cm_px
    altitude = project.altitude_from_ground
    # TODO This should be fixed within the drone_flightplan (115 m altitude is static for now)
    if not altitude:
        altitude = gsd * GSD_to_AGL_CONST if gsd else 115

    if not download:
        return waypoints.create_waypoint(
            features,
            altitude,
            forward_overlap,
            side_overlap,
            generate_each_points,
            generate_3d,
        )
    else:
        if project.is_terrain_follow:
            dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"
            get_file_from_bucket(
                settings.S3_BUCKET_NAME, f"dem/{project_id}/dem.tif", dem_path
            )
        output_file = flightplan.generate_flightplan(
            features,
            altitude,
            gsd,
            forward_overlap,
            side_overlap,
            generate_each_points,
            generate_3d,
            project.is_terrain_follow,
            dem_path if project.is_terrain_follow else None,
            f"/tmp/{uuid.uuid4()}",
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
    features = boundary["features"][0]

    if not download:
        # TODO This should be fixed within the drone_flightplan
        if gsd:
            altitude = gsd * GSD_to_AGL_CONST

        return waypoints.create_waypoint(
            features,
            altitude,
            forward_overlap,
            side_overlap,
            generate_each_points,
            generate_3d,
        )
    else:
        output_file = flightplan.generate_flightplan(
            features,
            altitude,
            gsd,
            forward_overlap,
            side_overlap,
            generate_each_points,
            generate_3d,
            terrain_follow,
            dem_path if dem else None,
            f"/tmp/{uuid.uuid4()}",
        )

        return FileResponse(
            output_file, media_type="application/zip", filename="output.kmz"
        )
