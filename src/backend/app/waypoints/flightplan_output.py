from fastapi import HTTPException
from fastapi.responses import FileResponse

from drone_flightplan.drone_type import DRONE_PARAMS, DroneType


FLIGHTPLAN_OUTPUTS = {
    "DJI_WMPL": {
        "suffix": ".kmz",
        "media_type": "application/vnd.google-earth.kmz",
    },
    "POTENSIC_SQLITE": {
        "suffix": ".db",
        "media_type": "application/vnd.sqlite3",
    },
    "POTENSIC_JSON": {
        "suffix": ".zip",
        "media_type": "application/zip",
    },
    "QGROUNDCONTROL": {
        "suffix": ".plan",
        "media_type": "application/json",
    },
    "LITCHI": {
        "suffix": ".csv",
        "media_type": "text/csv",
    },
}


def get_flightplan_output_config(drone_type: DroneType) -> dict:
    """Look up the output file metadata for a drone type."""
    output_format = DRONE_PARAMS[drone_type].get("OUTPUT_FORMAT")
    config = FLIGHTPLAN_OUTPUTS.get(output_format)
    if config is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported output format / drone type: {output_format}",
        )
    return config


def build_flightplan_download_response(
    outpath: str,
    drone_type: DroneType,
    filename_stem: str,
):
    """Wrap a generated flightplan file in the correct download response."""
    config = get_flightplan_output_config(drone_type)
    return FileResponse(
        outpath,
        media_type=config["media_type"],
        filename=f"{filename_stem}{config['suffix']}",
    )
