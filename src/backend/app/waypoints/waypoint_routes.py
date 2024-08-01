import uuid
import geojson
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from app.config import settings
from app.drone_flightplan import flightplan, waypoints


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/waypoint",
    tags=["waypoint"],
    responses={404: {"description": "Not found"}},
)


@router.post("/")
async def generate_kmz(
    project_geojson: UploadFile = File(
        ...,
        description="The GeoJSON file representing the project area. This file will be used to define the boundaries and paths for the flight plan.",
    ),
    altitude: float = Form(
        80,
        description="The altitude at which the drone should fly during the mission, in meters.",
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
):
    try:
        boundary = geojson.loads(await project_geojson.read())

        features = boundary["features"][0]

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
            output_file = flightplan.generate_flightplan(
                features,
                altitude,
                forward_overlap,
                side_overlap,
                generate_each_points,
                generate_3d,
                f"/tmp/{uuid.uuid4()}",
            )

            return FileResponse(
                output_file, media_type="application/zip", filename="output.kmz"
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
