import os
import shutil
import tempfile

from drone_flightplan.drone_type import DRONE_PARAMS, DroneType
from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

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


def create_flightplan_workspace() -> tuple[str, str]:
    """Return a managed temporary directory and a writer output path inside it."""
    workspace = tempfile.mkdtemp(prefix="flightplan-")
    return workspace, os.path.join(workspace, "output")


def remove_flightplan_workspace(workspace: str) -> None:
    """Remove a generated flightplan workspace, including writer intermediates."""
    shutil.rmtree(workspace, ignore_errors=True)


def build_temporary_file_response(
    outpath: str,
    media_type: str,
    filename: str,
    cleanup_dir: str,
) -> FileResponse:
    """Stream a temporary file, then remove its complete workspace."""
    return FileResponse(
        outpath,
        media_type=media_type,
        filename=filename,
        background=BackgroundTask(remove_flightplan_workspace, cleanup_dir),
    )


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
    cleanup_dir: str | None = None,
):
    """Wrap a generated flightplan file in the correct download response.

    When ``cleanup_dir`` is provided, FastAPI removes the complete temporary
    workspace after the response body has been sent. This keeps files alive
    for streaming without leaving generated plans and writer intermediates on
    the server indefinitely.
    """
    config = get_flightplan_output_config(drone_type)
    if cleanup_dir:
        return build_temporary_file_response(
            outpath,
            media_type=config["media_type"],
            filename=f"{filename_stem}{config['suffix']}",
            cleanup_dir=cleanup_dir,
        )

    return FileResponse(
        outpath,
        media_type=config["media_type"],
        filename=f"{filename_stem}{config['suffix']}",
    )
