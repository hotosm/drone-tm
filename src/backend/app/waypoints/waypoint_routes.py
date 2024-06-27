import geojson
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Literal
from fastapi.responses import FileResponse
from app.models.enums import DroneType
from math import ceil
from app.waypoints.waypoint_crud import (
    generate_waypoints_within_polygon,
    create_xml,
    calculate_drone_flying_speed,
    haversine_distance,
    calculate_distance_between_2_lines,
)
from app.config import settings

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/waypoint",
    tags=["waypoint"],
    responses={404: {"description": "Not found"}},
)


@router.post("/")
async def generate_kmz_file(
    project_geojson: UploadFile = File(
        ...,
        description="The GeoJSON file representing the project area. This file will be used to define the boundaries and paths for the flight plan.",
    ),
    altitude: float = Form(
        80,
        description="The altitude at which the drone should fly during the mission, in meters.",
    ),
    gimble_angle: float = Form(
        -90,
        description="The angle of the gimbal during the mission. -90 degrees typically means the camera is pointing straight down.",
    ),
    image_interval: int = Form(
        3, description="The interval between images taken by the drone, in seconds"
    ),
    finish_action: Literal["goHome", "hover", "noAction"] = Form(
        ...,
        description="The action the drone should take once the mission is complete.",
    ),
    download: bool = Form(
        True,
        description="A flag indicating weather you want to download the kmz file or view the waypoint coordinates first. If True, file will be downloaded directly",
    ),
    overlap: float = Form(
        70,
        description="The percentage of overlap between images taken during the mission.",
    ),
    generate_each_points: bool = Form(
        False,
        description="A flag indicating weather you want to generate waypoints for each point in the boundary and capture image at each point or just at the end of the waylines",
    ),
):
    try:
        boundary = geojson.loads(await project_geojson.read())

        # Drone type
        # TODO: for other drones
        drone_type = DroneType.DJI_MINI_4_PRO

        # calculate distance between 2 lines
        distance_between_lines = await calculate_distance_between_2_lines(
            overlap, drone_type, altitude
        )

        waypoints = await generate_waypoints_within_polygon(
            boundary, distance_between_lines, generate_each_points
        )

        # Calculate the total distance using Haversine formula
        total_haversine_distance = sum(
            haversine_distance(
                waypoints[i]["coordinates"], waypoints[i + 1]["coordinates"]
            )
            for i in range(len(waypoints) - 1)
        )

        # update drone flying speed according to the image interval
        speed = await calculate_drone_flying_speed(
            altitude, drone_type, image_interval, overlap
        )

        if not download:
            return {
                "total_distance": ceil(total_haversine_distance * 1000),
                "total_flight_time": ceil(
                    total_haversine_distance * 1000 / (speed * 60)
                ),
                "drone_speed": speed,
                "distance_between_lines": distance_between_lines,
                "waypoints": waypoints,
            }

        placemark_data = []

        for x in waypoints:
            placemark_data.append(
                (
                    f"{x['coordinates'][0]},{x['coordinates'][1]}",
                    altitude,
                    speed,
                    int(x["angle"]),
                    gimble_angle,
                )
            )
        output_file_name = create_xml(
            placemark_data, finish_action, generate_each_points
        )
        return FileResponse(
            output_file_name, media_type="application/zip", filename="output.kmz"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
