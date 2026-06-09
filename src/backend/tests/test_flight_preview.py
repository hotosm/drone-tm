"""Unit tests for POST /api/public/flight-preview/.

All tests are pure-unit: no database, no HTTP server, no external services.
They call split_by_square and assign_grid_ids directly so the suite passes
in any environment where the Python dependencies are installed.
"""

import re


from app.projects.flight_preview import FlightPreviewResponse, assign_grid_ids
from app.tasks.task_splitter import split_by_square

# ---------------------------------------------------------------------------
# Fixed test polygon  ~400 m × 400 m near Santo Domingo (~0.16 km²).
# At 18.6 °N: Δlat 0.0036° ≈ 400 m,  Δlon 0.0038° ≈ 400 m.
# Expected grid at cell_size_meters=100: roughly 4 × 4 = 16 tasks.
# ---------------------------------------------------------------------------
_POLYGON_400M = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-69.5000, 18.6200],
                        [-69.5000, 18.6236],
                        [-69.4962, 18.6236],
                        [-69.4962, 18.6200],
                        [-69.5000, 18.6200],
                    ]
                ],
            },
        }
    ],
}

_ID_RE = re.compile(r"^[A-Z]{1,2}[0-9]+$")


# ---------------------------------------------------------------------------
# assign_grid_ids unit tests
# ---------------------------------------------------------------------------


def _make_feature(lng_min, lat_min, lng_max, lat_max):
    return {
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [lng_min, lat_min],
                    [lng_min, lat_max],
                    [lng_max, lat_max],
                    [lng_max, lat_min],
                    [lng_min, lat_min],
                ]
            ],
        },
    }


def test_assign_grid_ids_empty_returns_empty():
    assert assign_grid_ids([]) == []


def test_assign_grid_ids_single_feature():
    feat = _make_feature(-69.5, 18.62, -69.49, 18.63)
    tasks = assign_grid_ids([feat])
    assert len(tasks) == 1
    assert tasks[0].id == "A1"
    assert tasks[0].area_m2 > 0


def test_assign_grid_ids_2x2_grid():
    """Four features arranged in a 2×2 grid get distinct A1/A2/B1/B2 IDs."""
    # Two rows (lat), two cols (lng)
    features = [
        _make_feature(-69.50, 18.62, -69.49, 18.63),  # row A col 1
        _make_feature(-69.49, 18.62, -69.48, 18.63),  # row A col 2
        _make_feature(-69.50, 18.61, -69.49, 18.62),  # row B col 1
        _make_feature(-69.49, 18.61, -69.48, 18.62),  # row B col 2
    ]
    tasks = assign_grid_ids(features)
    ids = {t.id for t in tasks}
    assert ids == {"A1", "A2", "B1", "B2"}


def test_assign_grid_ids_ids_are_unique_and_valid():
    """All IDs match [A-Z]+[0-9]+ and are unique across a larger synthetic grid."""
    features = [
        _make_feature(
            -69.50 + j * 0.01, 18.62 - i * 0.01, -69.49 + j * 0.01, 18.63 - i * 0.01
        )
        for i in range(5)
        for j in range(6)
    ]
    tasks = assign_grid_ids(features)
    ids = [t.id for t in tasks]
    assert len(ids) == len(set(ids)), "IDs must be unique"
    for tid in ids:
        assert _ID_RE.match(tid), (
            f"ID '{tid}' does not match expected pattern [A-Z]+[0-9]+"
        )


def test_assign_grid_ids_area_m2_positive():
    feat = _make_feature(-69.5, 18.62, -69.49, 18.63)
    tasks = assign_grid_ids([feat])
    assert tasks[0].area_m2 > 0


# ---------------------------------------------------------------------------
# Full pipeline: split_by_square → assign_grid_ids
# ---------------------------------------------------------------------------


def test_split_and_label_400m_polygon_cell100():
    """~0.16 km² polygon at 100 m cell size produces roughly 16 tasks."""
    feature_col = split_by_square(_POLYGON_400M, meters=100)
    tasks = assign_grid_ids(feature_col.get("features", []))

    # Task count: generous range to avoid brittleness from edge clipping
    assert 9 <= len(tasks) <= 25, f"Expected ~16 tasks, got {len(tasks)}"

    for task in tasks:
        # Each cell should be meaningful (> 100 m²) and not absurdly large
        assert task.area_m2 > 100, f"Cell {task.id} area too small: {task.area_m2}"
        assert task.area_m2 < 20_000, f"Cell {task.id} area too large: {task.area_m2}"
        assert _ID_RE.match(task.id), f"Bad ID: {task.id}"

    ids = [t.id for t in tasks]
    assert len(ids) == len(set(ids)), "Duplicate task IDs"


def test_response_model_serialises():
    """FlightPreviewResponse validates and round-trips correctly."""
    feature_col = split_by_square(_POLYGON_400M, meters=100)
    tasks = assign_grid_ids(feature_col.get("features", []))
    resp = FlightPreviewResponse(tasks=tasks)
    data = resp.model_dump()
    assert "tasks" in data
    assert all("id" in t and "geometry" in t and "area_m2" in t for t in data["tasks"])
