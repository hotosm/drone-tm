import geojson
from fastapi import APIRouter, HTTPException, Query
from shapely.geometry import shape

from drone_flightplan import create_waypoint

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

router = APIRouter(tags=["Public"])


def _extract_geometry(polygon: dict) -> dict | None:
    """Accept a GeoJSON Feature or bare geometry and return the geometry."""
    return polygon.get("geometry") if polygon.get("type") == "Feature" else polygon


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
