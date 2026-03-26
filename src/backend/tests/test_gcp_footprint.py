"""Unit tests for GCP image footprint calculations.

These test the pure Python helpers in gcp_crud that don't need a database.
Test data is derived from real agung-1 project images.
"""

import math
import pytest

from app.gcp.gcp_crud import _image_footprint_radius_meters, _point_in_image_footprint

# Typical drone-tm defaults
FOV_DEGREE = 82.1  # DJI Mini 4 Pro
ALTITUDE = 120.0


@pytest.mark.asyncio
async def test_footprint_radius_reasonable():
    """Radius should be a reasonable distance for typical drone altitudes."""
    radius = await _image_footprint_radius_meters(ALTITUDE, FOV_DEGREE)
    # At 120m altitude with 82.1° FOV, half-diagonal should be ~120m
    assert 80 < radius < 200


@pytest.mark.asyncio
async def test_footprint_radius_scales_with_altitude():
    """Higher altitude = larger footprint."""
    r_low = await _image_footprint_radius_meters(60, FOV_DEGREE)
    r_high = await _image_footprint_radius_meters(120, FOV_DEGREE)
    assert r_high > r_low
    # Linear relationship: doubling altitude should double radius
    assert abs(r_high / r_low - 2.0) < 0.01


# --- Agung-1 test data ---
# Image center from source `DJI_20250216142518_0031_W.JPG`
IMG_LON = 115.46138413
IMG_LAT = -8.29951498


class TestPointInImageFootprint:
    """Test _point_in_image_footprint with agung-1 image data."""

    def test_center_point_is_inside(self):
        """A point at the image center should always be inside."""
        assert _point_in_image_footprint(
            IMG_LON, IMG_LAT, IMG_LON, IMG_LAT, ALTITUDE, FOV_DEGREE, None
        )

    def test_nearby_point_is_inside(self):
        """A point slightly offset from center should be inside."""
        # ~10m offset in lat (roughly 0.0001 degrees)
        assert _point_in_image_footprint(
            IMG_LON + 0.0001,
            IMG_LAT + 0.0001,
            IMG_LON,
            IMG_LAT,
            ALTITUDE,
            FOV_DEGREE,
            None,
        )

    def test_far_point_is_outside(self):
        """A point far away should be outside."""
        assert not _point_in_image_footprint(
            IMG_LON + 0.01,  # ~1km offset
            IMG_LAT,
            IMG_LON,
            IMG_LAT,
            ALTITUDE,
            FOV_DEGREE,
            None,
        )

    def test_edge_point_with_exif_aspect_ratio(self):
        """EXIF aspect ratio affects footprint shape."""
        # 4:3 aspect ratio from EXIF
        exif = {"ImageWidth": 4000, "ImageHeight": 3000}
        # Point near the edge in the wider dimension should still be inside
        # Calculate approximate edge
        fov_rad = math.radians(FOV_DEGREE)
        diagonal = 2 * ALTITUDE * math.tan(fov_rad / 2)
        ar = 4 / 3
        footprint_h = diagonal / math.sqrt(1 + ar**2)
        footprint_w = ar * footprint_h
        half_w_deg = (
            (footprint_w / 2)
            / (6378137.0 * math.cos(math.radians(IMG_LAT)))
            * (180 / math.pi)
        )

        # Just inside the edge
        assert _point_in_image_footprint(
            IMG_LON + half_w_deg * 0.9,
            IMG_LAT,
            IMG_LON,
            IMG_LAT,
            ALTITUDE,
            FOV_DEGREE,
            exif,
        )
        # Just outside the edge
        assert not _point_in_image_footprint(
            IMG_LON + half_w_deg * 1.1,
            IMG_LAT,
            IMG_LON,
            IMG_LAT,
            ALTITUDE,
            FOV_DEGREE,
            exif,
        )

    def test_low_altitude_smaller_footprint(self):
        """Lower altitude should produce a smaller footprint."""
        # At 30m altitude, a point 50m away should be outside
        offset_deg = 0.0005  # ~55m
        assert not _point_in_image_footprint(
            IMG_LON + offset_deg,
            IMG_LAT,
            IMG_LON,
            IMG_LAT,
            30.0,
            FOV_DEGREE,
            None,
        )
        # But at 120m altitude, same point should be inside
        assert _point_in_image_footprint(
            IMG_LON + offset_deg,
            IMG_LAT,
            IMG_LON,
            IMG_LAT,
            ALTITUDE,
            FOV_DEGREE,
            None,
        )

    def test_gcp_csv_points_intersect(self):
        """The sample-agung.csv GCP points should intersect with their target images."""
        # gcp1 targets task a73abcb9 cluster center
        assert _point_in_image_footprint(
            115.46100, -8.29960, IMG_LON, IMG_LAT, ALTITUDE, FOV_DEGREE, None
        )
