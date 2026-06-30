import geojson
import io
import logging
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from shapely.geometry import shape

from drone_flightplan import create_flightplan, create_waypoint

from app.models.enums import HTTPStatus
from app.projects import project_logic
from app.projects.flight_preview import (
    FlightPlanRequest,
    FlightPreviewRequest,
    FlightPreviewResponse,
    assign_grid_ids,
)
from app.s3 import maybe_presign_s3_key
from app.tasks.task_splitter import (
    GeometryTopologyError,
    GeometryValidationError,
)
from app.waypoints.flightplan_output import get_flightplan_output_config

log = logging.getLogger(__name__)

router = APIRouter(tags=["Public"])


class AllTaskFilesRequest(FlightPlanRequest):
    cell_size_meters: int = 100


def _extract_geometry(polygon: dict) -> dict | None:
    """Accept a GeoJSON Feature or bare geometry and return the geometry."""
    return polygon.get("geometry") if polygon.get("type") == "Feature" else polygon


def _generate_guide_html(tasks: list, drone_type: str, suffix: str) -> str:
    template_path = Path(__file__).parent / "templates" / "dronetm-guide.html"
    html = template_path.read_text(encoding="utf-8")

    file_list = ", ".join(f"task-{t.id}{suffix}" for t in tasks)
    drone_display = drone_type.replace("_", " ").title()
    total_km2 = sum(t.area_m2 for t in tasks) / 1_000_000

    html = html.replace(
        '<span class="placeholder">[PLACEHOLDER: list actual files once package is finalized]</span>',
        file_list,
    )
    html = html.replace(
        '<span class="placeholder">[PLACEHOLDER: confirm drone model(s) for this package]</span>',
        drone_display,
    )
    html = html.replace(
        '<span class="placeholder">[PLACEHOLDER: total km&sup2; and location name]</span>',
        f"{total_km2:.2f} km²",
    )

    cards = []
    for task in tasks:
        area_km2 = task.area_m2 / 1_000_000
        centroid = shape(task.geometry).centroid
        lat, lon = round(centroid.y, 6), round(centroid.x, 6)
        osm_url = f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}&zoom=15"
        nav_links = f'<a href="{osm_url}" target="_blank" rel="noopener" style="color:var(--blue);">{lat}, {lon}</a>'
        cards.append(
            f'    <div class="task-card">\n'
            f'      <div class="task-card-header">Task {task.id}</div>\n'
            f'      <div class="prose" style="margin-bottom:1rem;">\n'
            f"        <p>Grid cell {task.id} covering {area_km2:.3f} km².</p>\n"
            f"      </div>\n"
            f'      <div class="task-card-fields">\n'
            f'        <div class="task-field">\n'
            f'          <span class="task-field-label">Task ID</span>\n'
            f"          <span>{task.id}</span>\n"
            f"        </div>\n"
            f'        <div class="task-field">\n'
            f'          <span class="task-field-label">Takeoff point</span>\n'
            f"          <span>{nav_links}</span>\n"
            f"        </div>\n"
            f"      </div>\n"
            f"    </div>"
        )

    html = html.replace("<!-- TASK_CARDS_PLACEHOLDER -->", "\n".join(cards))
    return html


@router.get("/public/presigned-url")
async def get_public_presigned_url(
    key: str = Query(..., description="S3 object key (e.g. tutorials/Foo.mp4)"),
    expires_hours: int = Query(2, ge=1, le=24),
):
    """Return a presigned GET URL for a limited set of public-facing objects.

    This allows keeping the bucket private while still serving a few static resources
    (e.g. landing-page downloads, tutorial videos) without hardcoding bucket URLs in the frontend.
    """
    allowed_prefixes = ("tutorials/", "publicuploads/")
    if not key or not key.startswith(allowed_prefixes):
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Key is not allowed",
        )

    try:
        return {"url": maybe_presign_s3_key(key, expires_hours=expires_hours)}
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.post("/public/flight-preview/")
async def flight_preview(body: FlightPreviewRequest) -> FlightPreviewResponse:
    """Return a task grid for an AOI polygon without authentication or DB writes.

    Accepts a GeoJSON Feature (or bare Polygon geometry) and a cell size in
    metres, and responds with the same grid that the private preview endpoint
    computes, enriched with A1-style IDs and ellipsoidal area_m2 per cell.
    """
    geometry = _extract_geometry(body.polygon)
    if not geometry:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Request must contain a valid GeoJSON Feature or Polygon geometry.",
        )

    boundary = geojson.Feature(geometry=geometry)
    try:
        feature_col = await project_logic.preview_split_by_square(
            boundary, body.cell_size_meters
        )
    except HTTPException:
        raise
    except (GeometryValidationError, GeometryTopologyError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)
        ) from e

    tasks = assign_grid_ids(feature_col.get("features", []))
    return FlightPreviewResponse(tasks=tasks)


@router.post("/public/flight-plan/")
async def flight_plan(body: FlightPlanRequest) -> dict:
    """Generate a drone flight plan (waylines/waypoints) for an AOI polygon.

    No authentication or DB access: the flight path is a pure function of the
    polygon and flight parameters, so the public "try-drone" sandbox can preview
    flight vectors without persisting a project or task. Returns the waypoint
    GeoJSON FeatureCollection.
    """
    geometry = _extract_geometry(body.polygon)
    if not geometry:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Request must contain a valid GeoJSON Feature or Polygon geometry.",
        )

    feature = geojson.Feature(geometry=geometry)
    take_off_point = body.take_off_point or list(shape(geometry).centroid.coords)[0]

    try:
        result = create_waypoint(
            project_area=feature,
            agl=body.altitude,
            gsd=None,
            forward_overlap=body.forward_overlap,
            side_overlap=body.side_overlap,
            mode=body.mode,
            take_off_point=take_off_point,
            drone_type=body.drone_type,
        )
    except (GeometryValidationError, GeometryTopologyError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)
        ) from e

    return geojson.loads(result["geojson"])


@router.post("/public/all-task-files/")
async def all_task_files(body: AllTaskFilesRequest) -> StreamingResponse:
    """Generate KMZ and GeoJSON waypoint files for every task in an AOI polygon.

    Splits the AOI into a grid of tasks (same logic as /public/flight-preview/),
    then for each task generates a KMZ flight plan and a GeoJSON waypoints file.
    All files are bundled into a single ZIP archive returned for download.
    No authentication or DB access required.
    """
    geometry = _extract_geometry(body.polygon)
    if not geometry:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Request must contain a valid GeoJSON Feature or Polygon geometry.",
        )

    boundary = geojson.Feature(geometry=geometry)
    try:
        feature_col = await project_logic.preview_split_by_square(
            boundary, body.cell_size_meters
        )
    except HTTPException:
        raise
    except (GeometryValidationError, GeometryTopologyError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)
        ) from e

    tasks = assign_grid_ids(feature_col.get("features", []))
    if not tasks:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="No tasks could be generated from the provided polygon.",
        )

    flightplan_config = get_flightplan_output_config(body.drone_type)
    tmpdir = tempfile.mkdtemp(prefix="all-task-files-")
    try:
        for task in tasks:
            task_feature = geojson.Feature(geometry=task.geometry)
            take_off_point = (
                body.take_off_point or list(shape(task.geometry).centroid.coords)[0]
            )

            try:
                kmz_path = create_flightplan(
                    aoi=task_feature,
                    forward_overlap=body.forward_overlap,
                    side_overlap=body.side_overlap,
                    agl=body.altitude,
                    gsd=None,
                    flight_mode=body.mode,
                    dem=None,
                    outfile=os.path.join(tmpdir, f"task-{task.id}"),
                    take_off_point=take_off_point,
                    drone_type=body.drone_type,
                )
                final_kmz = os.path.join(
                    tmpdir, f"task-{task.id}{flightplan_config['suffix']}"
                )
                if kmz_path != final_kmz and os.path.exists(kmz_path):
                    os.rename(kmz_path, final_kmz)
            except Exception:
                log.warning("KMZ generation failed for task %s", task.id, exc_info=True)

            try:
                waypoints = create_waypoint(
                    project_area=task_feature,
                    agl=body.altitude,
                    gsd=None,
                    forward_overlap=body.forward_overlap,
                    side_overlap=body.side_overlap,
                    mode=body.mode,
                    take_off_point=take_off_point,
                    drone_type=body.drone_type,
                )
                geojson_path = os.path.join(tmpdir, f"task-{task.id}.geojson")
                with open(geojson_path, "w") as f:
                    f.write(waypoints["geojson"])
            except Exception:
                log.warning(
                    "GeoJSON generation failed for task %s", task.id, exc_info=True
                )

        try:
            guide_html = _generate_guide_html(tasks, body.drone_type, flightplan_config["suffix"])
            guide_path = os.path.join(tmpdir, "dronetm-guide.html")
            with open(guide_path, "w", encoding="utf-8") as f:
                f.write(guide_html)
        except Exception:
            log.warning("Guide HTML generation failed", exc_info=True)

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename in os.listdir(tmpdir):
                filepath = os.path.join(tmpdir, filename)
                if os.path.isfile(filepath):
                    zf.write(filepath, filename)
        zip_buffer.seek(0)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=all-task-files.zip"},
    )
