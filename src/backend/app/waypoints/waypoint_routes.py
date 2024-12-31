import os
import uuid
import geojson
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from app.config import settings
from drone_flightplan import (
    create_flightplan,
    create_placemarks,
    calculate_parameters,
    add_elevation_from_dem,
    terrain_following_waylines,
    wpml,
    waypoints,
)
from app.models.enums import HTTPStatus, FlightMode
from app.tasks.task_logic import (
    get_task_geojson,
    get_take_off_point_from_db,
    update_take_off_point_in_db,
)
from app.waypoints.waypoint_logic import (
    check_point_within_buffer,
)
from app.db import database
from app.utils import merge_multipolygon
from app.s3 import get_file_from_bucket
from typing import Annotated
from psycopg import Connection
from app.projects import project_deps
from shapely.geometry import shape
from app.waypoints import waypoint_schemas


# Constant to convert gsd to Altitude above ground level
GSD_to_AGL_CONST = 29.7  # For DJI Mini 4 Pro

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/waypoint",
    tags=["waypoint"],
    responses={404: {"description": "Not found"}},
)


@router.post("/task/{task_id}/")
async def get_task_waypoint(
    db: Annotated[Connection, Depends(database.get_db)],
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    download: bool = True,
    mode: FlightMode = FlightMode.waylines,
    take_off_point: waypoint_schemas.PointField = None,
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
    project = await project_deps.get_project_by_id(project_id, db)

    # create a takeoff point in this format ["lon","lat"]
    if take_off_point:
        take_off_point = [take_off_point.longitude, take_off_point.latitude]

        # Validate that the take-off point is within a 1000 buffer of the task boundary
        if not check_point_within_buffer(take_off_point, task_geojson, 1000):
            raise HTTPException(
                status_code=400,
                detail="Take off point should be within 1km of the boundary",
            )

        # Update take_off_point in tasks table
        geojson_point = {"type": "Point", "coordinates": take_off_point}
        await update_take_off_point_in_db(db, task_id, geojson_point)

    else:
        # Retrieve the take-off point from the database if not explicitly provided
        take_off_point_from_db = await get_take_off_point_from_db(db, task_id)

        if take_off_point_from_db:
            take_off_point = take_off_point_from_db["coordinates"]
        else:
            # Use the centroid of the task polygon as the default take-off point
            task_polygon = shape(task_geojson["features"][0]["geometry"])
            task_centroid = task_polygon.centroid
            take_off_point = [task_centroid.x, task_centroid.y]

    forward_overlap = project.front_overlap if project.front_overlap else 70
    side_overlap = project.side_overlap if project.side_overlap else 70
    generate_3d = (
        False  # TODO: For 3d imageries drone_flightplan package needs to be updated.
    )

    gsd = project.gsd_cm_px
    altitude = project.altitude_from_ground

    parameters = calculate_parameters(
        forward_overlap,
        side_overlap,
        altitude,
        gsd,
        2,  # Image Interval is set to 2
    )

    # Common parameters for create_waypoint
    waypoint_params = {
        "project_area": task_geojson,
        "agl": altitude,
        "gsd": gsd,
        "forward_overlap": forward_overlap,
        "side_overlap": side_overlap,
        "rotation_angle": 0,
        "generate_3d": generate_3d,
        "take_off_point": take_off_point,
    }

    if project.is_terrain_follow:
        dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"

        # Terrain follow uses waypoints mode, waylines are generated later
        waypoint_params["mode"] = FlightMode.waypoints
        points = waypoints.create_waypoint(**waypoint_params)

        try:
            get_file_from_bucket(
                settings.S3_BUCKET_NAME,
                f"dtm-data/projects/{project_id}/dem.tif",
                dem_path,
            )
            # TODO: Do this with inmemory data
            outfile_with_elevation = "/tmp/output_file_with_elevation.geojson"
            add_elevation_from_dem(dem_path, points, outfile_with_elevation)

            inpointsfile = open(outfile_with_elevation, "r")
            points_with_elevation = inpointsfile.read()

        except Exception:
            points_with_elevation = points

        placemarks = create_placemarks(geojson.loads(points_with_elevation), parameters)

        # Create a flight plan with terrain follow in waylines mode
        if mode == FlightMode.waylines:
            placemarks = terrain_following_waylines.waypoints2waylines(placemarks, 5)

    else:
        waypoint_params["mode"] = mode
        points = waypoints.create_waypoint(**waypoint_params)
        placemarks = create_placemarks(geojson.loads(points), parameters)

    if download:
        outfile = outfile = f"/tmp/{uuid.uuid4()}"
        kmz_file = wpml.create_wpml(placemarks, outfile)
        return FileResponse(
            kmz_file,
            media_type="application/vnd.google-earth.kmz",
            filename=f"{task_id}_flight_plan.kmz",
        )
    return {"results": placemarks}


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
    take_off_point: waypoint_schemas.PointField = None,
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

    # create a takeoff point in this format ["lon","lat"]
    take_off_point = [take_off_point.longitude, take_off_point.latitude]
    if not check_point_within_buffer(take_off_point, boundary, 200):
        raise HTTPException(
            status_code=400,
            detail="Take off point should be within 200m of the boundary",
        )

    if not download:
        points = waypoints.create_waypoint(
            project_area=boundary,
            agl=altitude,
            gsd=gsd,
            forward_overlap=forward_overlap,
            side_overlap=side_overlap,
            generate_each_points=generate_each_points,
            generate_3d=generate_3d,
            take_off_point=take_off_point,
        )
        return geojson.loads(points)
    else:
        output_file = create_flightplan(
            aoi=boundary,
            forward_overlap=forward_overlap,
            side_overlap=side_overlap,
            agl=altitude,
            gsd=gsd,
            generate_each_points=generate_each_points,
            dem=dem_path if dem else None,
            outfile=f"/tmp/{uuid.uuid4()}",
            take_off_point=take_off_point,
        )

        return FileResponse(
            output_file, media_type="application/zip", filename="output.kmz"
        )


@router.post("/{task_id}/generate-kmz/")
async def generate_kmz_with_placemarks(
    task_id: uuid.UUID, data: waypoint_schemas.PlacemarksFeature
):
    try:
        outfile = f"/tmp/{task_id}_flight_plan.kmz"

        kmz_file = wpml.create_wpml(data.model_dump(), outfile)
        if not os.path.exists(kmz_file):
            raise HTTPException(status_code=500, detail="Failed to generate KMZ file.")
        return FileResponse(
            kmz_file,
            media_type="application/zip",
            filename=f"{task_id}_flight_plan.kmz",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating KMZ: {str(e)}")
