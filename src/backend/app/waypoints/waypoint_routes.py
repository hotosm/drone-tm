import os
import shutil
import uuid
import logging
import traceback
from typing import Annotated

import geojson
from drone_flightplan import (
    add_elevation_from_dem,
    calculate_parameters,
    create_flightplan,
    create_placemarks,
    terrain_following_waylines,
    create_waypoint,
)
from drone_flightplan.output.dji import create_wpml
from drone_flightplan.output.potensic import create_potensic_sqlite
from drone_flightplan.output.qgroundcontrol import create_qgroundcontrol_plan
from drone_flightplan.output.litchi import create_litchi_csv
from drone_flightplan.drone_type import DroneType, DRONE_PARAMS
from drone_flightplan.enums import GimbalAngle
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from psycopg import Connection
from shapely.geometry import shape

from app.config import settings
from app.db import database
from app.models.enums import FlightMode, HTTPStatus
from app.projects import project_deps
from app.s3 import get_file_from_bucket
from app.tasks.task_logic import (
    get_take_off_point_from_db,
    get_task_geojson,
    update_take_off_point_in_db,
)
from app.utils import merge_multipolygon, calculate_flight_time_from_placemarks
from app.waypoints import waypoint_schemas
from app.waypoints.waypoint_logic import (
    check_point_within_buffer,
)

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/waypoint",
    tags=["waypoint"],
    responses={404: {"description": "Not found"}},
)


@router.post("/task/{task_id}/")
async def get_task_waypoint(
    db: Annotated[Connection, Depends(database.get_db)],
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    download: bool = True,
    mode: FlightMode = FlightMode.WAYLINES,
    rotation_angle: float = 0,
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO,
    take_off_point: waypoint_schemas.PointField = None,
    gimbal_angle: GimbalAngle = GimbalAngle.OFF_NADIR,
):
    """Retrieve task waypoints and download a flight plan.

    FIXME why do we do all steps manually here, when we have create_flightplan
    FIXME helper available?

    Args:
        project_id (uuid.UUID): The UUID of the project.
        task_id (uuid.UUID): The UUID of the task.
        download (bool): Flag to determine if the output should be downloaded or returned as GeoJSON. Defaults to True.

    Returns:
        geojson or FileResponse: If `download` is False, returns waypoints as a GeoJSON object.
                                If `download` is True, returns a KMZ file as a download response.
    """
    rotation_angle = 360 - rotation_angle
    task_geojson = await get_task_geojson(db, task_id)
    features = task_geojson.get("features") or []
    # Prevent failure if cannot extract
    project_task_index = next(
        (
            f.get("properties", {}).get("project_task_id")
            for f in features
            if f.get("properties")
        ),
        "unknown",
    )
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
        drone_type,
    )

    # Common parameters for create_waypoint
    waypoint_params = {
        "project_area": task_geojson,
        "agl": altitude,
        "gsd": gsd,
        "forward_overlap": forward_overlap,
        "side_overlap": side_overlap,
        "rotation_angle": rotation_angle,
        "generate_3d": generate_3d,
        "take_off_point": take_off_point,
        "drone_type": drone_type,
        "gimbal_angle": gimbal_angle,
    }

    if project.is_terrain_follow:
        dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"

        # Terrain follow uses waypoints mode, waylines are generated later
        waypoint_params["mode"] = FlightMode.WAYPOINTS
        points = create_waypoint(**waypoint_params)

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

        except Exception as e:
            log.warning(traceback.format_exc())
            log.warning(f"Exception: {e}")
            log.warning("Error adding elevation to waypoints from DEM file!")
            log.warning("Continuing, but the flightplan will not follow terrain.")
            points_with_elevation = points

        placemarks = create_placemarks(geojson.loads(points_with_elevation), parameters)

        # Create a flight plan with terrain follow in waylines mode
        if mode == FlightMode.WAYLINES:
            placemarks = terrain_following_waylines.waypoints2waylines(placemarks, 5)

    else:
        waypoint_params["mode"] = mode
        points = create_waypoint(**waypoint_params)
        placemarks = create_placemarks(geojson.loads(points), parameters)

    if download:
        output_format = DRONE_PARAMS[drone_type].get("OUTPUT_FORMAT")
        outfile = outfile = f"/tmp/{uuid.uuid4()}"

        if output_format == "DJI_WMPL":
            outpath = create_wpml(placemarks, outfile)
            return FileResponse(
                outpath,
                media_type="application/vnd.google-earth.kmz",
                # Sets content-disposition header
                filename=f"task-{project_task_index}-{mode.name}-project-{project_id}.kmz",
            )
        elif output_format == "POTENSIC_SQLITE":
            outpath = create_potensic_sqlite(placemarks, outfile)
            return FileResponse(
                # NOTE potensic file is always named map.db
                outpath,
                media_type="application/vnd.sqlite3",
                filename="map.db",
            )
        elif output_format == "QGROUNDCONTROL":
            outpath = create_qgroundcontrol_plan(placemarks, outfile)
            return FileResponse(
                outpath,
                media_type="application/json",
                filename=f"task-{project_task_index}-{mode.name}-project-{project_id}.plan",
            )
        elif output_format == "LITCHI":
            outpath = create_litchi_csv(placemarks, outfile, flight_mode=mode)
            return FileResponse(
                outpath,
                media_type="text/csv",
                filename=f"task-{project_task_index}-{mode.name}-project-{project_id}.csv",
            )
        else:
            msg = f"Unsupported output format / drone type: {output_format}"
            log.error(msg)
            raise HTTPException(status_code=400, detail=msg)

    flight_data = calculate_flight_time_from_placemarks(placemarks)

    drones = list(DroneType.__members__.keys())
    return {"results": placemarks, "flight_data": flight_data, "drones": drones}


@router.post("/")
async def generate_wmpl_kmz(
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
    take_off_point: waypoint_schemas.PointField = Form(
        None,
        description="The coordinate that the drone will take off from (important for AGL calculations).",
    ),
    drone_type: DroneType = Form(
        DroneType.DJI_MINI_4_PRO,
        description="The model of drone to use parameters for.",
    ),
    flight_mode: FlightMode = Form(
        FlightMode.WAYLINES,
        description="Use 'waypoint' or 'wayline' mode for the flightplan.",
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

    # create a takeoff point in this format ["lon","lat"]
    take_off_point = [take_off_point.longitude, take_off_point.latitude]
    if not check_point_within_buffer(take_off_point, boundary, 200):
        raise HTTPException(
            status_code=400,
            detail="Take off point should be within 200m of the boundary",
        )

    if not download:
        points = create_waypoint(
            project_area=boundary,
            agl=altitude,
            gsd=gsd,
            forward_overlap=forward_overlap,
            side_overlap=side_overlap,
            flight_mode=flight_mode,
            generate_3d=generate_3d,
            take_off_point=take_off_point,
            drone_type=drone_type,
        )
        return geojson.loads(points)
    else:
        output_file = create_flightplan(
            aoi=boundary,
            forward_overlap=forward_overlap,
            side_overlap=side_overlap,
            agl=altitude,
            gsd=gsd,
            flight_mode=flight_mode,
            dem=dem_path if dem else None,
            outfile=f"/tmp/{uuid.uuid4()}",
            take_off_point=take_off_point,
            drone_type=drone_type,
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

        kmz_file = create_wpml(data.model_dump(), outfile)
        if not os.path.exists(kmz_file):
            raise HTTPException(status_code=500, detail="Failed to generate KMZ file.")
        return FileResponse(
            kmz_file,
            media_type="application/zip",
            filename=f"{task_id}_flight_plan.kmz",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating KMZ: {str(e)}")
