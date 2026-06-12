"""Pure-computation helpers for the public flight-preview endpoint.

This module has no database, HTTP client, or heavy framework imports so it
can be imported directly in unit tests without spinning up the full app.
"""

from pyproj import Geod
from pydantic import BaseModel
from shapely.geometry import shape as shapely_shape

from drone_flightplan.drone_type import DroneType
from drone_flightplan.enums import FlightMode

_GEOD = Geod(ellps="WGS84")
# Rounding precision for grouping centroids into grid rows/cols (~11 m at
# equator, well below the 100 m default cell size).
_GRID_PRECISION = 4


class FlightPreviewRequest(BaseModel):
    polygon: dict
    cell_size_meters: int = 100


class TaskPreview(BaseModel):
    id: str
    geometry: dict
    area_m2: float


class FlightPreviewResponse(BaseModel):
    tasks: list[TaskPreview]


class FlightPlanRequest(BaseModel):
    polygon: dict
    altitude: float = 70
    forward_overlap: float = 75
    side_overlap: float = 70
    drone_type: DroneType = DroneType.DJI_MINI_4_PRO
    mode: FlightMode = FlightMode.WAYLINES
    take_off_point: list[float] | None = None


def assign_grid_ids(features: list) -> list[TaskPreview]:
    """Sort features into a north→south, west→east grid and assign A1-style IDs.

    Each feature also gets an ellipsoidal area_m2 (via pyproj.Geod) so the
    result is independent of the caller's CRS assumptions.
    """
    if not features:
        return []

    centroids = []
    for feat in features:
        geom = shapely_shape(feat["geometry"])
        centroids.append((geom.centroid.x, geom.centroid.y))

    unique_ys = sorted(
        {round(cy, _GRID_PRECISION) for _, cy in centroids}, reverse=True
    )
    unique_xs = sorted({round(cx, _GRID_PRECISION) for cx, _ in centroids})
    row_of = {y: i for i, y in enumerate(unique_ys)}
    col_of = {x: i for i, x in enumerate(unique_xs)}

    tasks = []
    for feat, (cx, cy) in zip(features, centroids):
        row = row_of[round(cy, _GRID_PRECISION)]
        col = col_of[round(cx, _GRID_PRECISION)]

        if row < 26:
            row_label = chr(65 + row)
        else:
            row_label = chr(65 + (row - 26) // 26) + chr(65 + (row - 26) % 26)
        task_id = f"{row_label}{col + 1}"

        geom = shapely_shape(feat["geometry"])
        area_m2 = round(abs(_GEOD.geometry_area_perimeter(geom)[0]), 2)

        tasks.append(
            TaskPreview(id=task_id, geometry=feat["geometry"], area_m2=area_m2)
        )

    return tasks
