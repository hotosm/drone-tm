"""Unit tests for TaskSplitter geometry handling."""

import pytest
from geojson import Feature, FeatureCollection, Polygon

from app.tasks.task_splitter import TaskSplitter


SQUARE_A = Polygon([[(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]])
SQUARE_B = Polygon([[(1, 0), (2, 0), (2, 1), (1, 1), (1, 0)]])


def test_single_feature():
    """A single-feature FeatureCollection returns one polygon."""
    fc = FeatureCollection([Feature(geometry=SQUARE_A)])
    result = TaskSplitter.geojson_to_shapely_polygon(fc)
    assert result.geom_type == "Polygon"
    assert result.area == pytest.approx(1.0)


def test_multi_feature_merges():
    """Multiple adjacent features are merged into one polygon."""
    fc = FeatureCollection(
        [
            Feature(geometry=SQUARE_A),
            Feature(geometry=SQUARE_B),
        ]
    )
    result = TaskSplitter.geojson_to_shapely_polygon(fc)
    assert result.geom_type == "Polygon"
    # Two unit squares side-by-side = area 2
    assert result.area == pytest.approx(2.0)


def test_disjoint_features_uses_convex_hull():
    """Disjoint features fall back to convex hull."""
    far_square = Polygon([[(10, 10), (11, 10), (11, 11), (10, 11), (10, 10)]])
    fc = FeatureCollection(
        [
            Feature(geometry=SQUARE_A),
            Feature(geometry=far_square),
        ]
    )
    result = TaskSplitter.geojson_to_shapely_polygon(fc)
    # Convex hull of disjoint squares is a single polygon
    assert result.geom_type == "Polygon"
    assert result.area > 2.0


def test_empty_raises():
    """An empty FeatureCollection raises ValueError."""
    fc = FeatureCollection([])
    with pytest.raises(ValueError, match="no geometries"):
        TaskSplitter.geojson_to_shapely_polygon(fc)
