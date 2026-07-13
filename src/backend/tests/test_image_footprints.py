from shapely.geometry import mapping
from shapely.ops import transform

from app.images.image_footprints import (
    coverage_percentage_from_footprints,
    image_footprint_polygon,
    image_footprints_feature_collection,
    inverse_projector,
)


def test_image_footprint_feature_collection_contains_polygon():
    # A tiny fake image where GSD makes the footprint exactly 10m x 10m.
    image = {
        "id": "image-1",
        "location": {"type": "Point", "coordinates": [0, 0]},
        "gsd_cm_px": 100,
        "image_width": 10,
        "image_height": 10,
        "altitude_m": None,
        "yaw_deg": 0,
    }

    footprints = image_footprints_feature_collection([image])
    # The frontend expects a GeoJSON FeatureCollection with polygon features.

    assert footprints["type"] == "FeatureCollection"
    assert len(footprints["features"]) == 1
    assert footprints["features"][0]["geometry"]["type"] == "Polygon"
    assert footprints["features"][0]["properties"]["image_id"] == "image-1"


def test_coverage_percentage_from_footprints_counts_overlap_once():
    # Two identical image footprints should still cover only one footprint area.
    image = {
        "id": "image-1",
        "location": {"type": "Point", "coordinates": [0, 0]},
        "gsd_cm_px": 100,
        "image_width": 10,
        "image_height": 10,
        "altitude_m": None,
        "yaw_deg": 0,
    }
    footprint_m = image_footprint_polygon(image)
    # Use the first image footprint itself as the target area.
    target_wgs84 = transform(inverse_projector.transform, footprint_m)

    coverage = coverage_percentage_from_footprints(
        mapping(target_wgs84),
        [image, {**image, "id": "image-2"}],
    )
    # If overlap is counted twice this would be wrong, but union keeps it at 100%.

    assert coverage == 100.0
