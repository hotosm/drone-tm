import math

import pytest
from app.config import settings
from app.dem.glo30 import (
    MAX_DIMENSION_PX,
    PIXEL_DEG,
    dem_crop_url,
    snap_bbox,
)
from app.models.enums import DEMSource
from app.projects.project_schemas import enum_to_str

# These expected bounds were verified against direct GDAL reads of the source COGs.
KATHMANDU = (85.28, 27.68, 85.32, 27.72)
KATHMANDU_SNAPPED = (85.2798611111, 27.6798611111, 85.3201388889, 27.7201388889)
TILE_SEAM = (85.94, 27.60, 86.06, 27.70)
TILE_SEAM_SNAPPED = (85.9398611111, 27.5998611111, 86.0601388889, 27.7001388889)


def on_grid(value: float) -> bool:
    edges = (value + 0.5 * PIXEL_DEG) / PIXEL_DEG
    return math.isclose(edges, round(edges), abs_tol=1e-6)


@pytest.mark.parametrize(
    ("bbox", "expected", "size"),
    [
        (KATHMANDU, KATHMANDU_SNAPPED, (145, 145)),
        (TILE_SEAM, TILE_SEAM_SNAPPED, (433, 361)),
    ],
)
def test_snap_bbox_reproduces_the_verified_source_grid(bbox, expected, size):
    snapped, width, height = snap_bbox(bbox, buffer_px=0)

    assert tuple(round(v, 10) for v in snapped) == expected
    assert (width, height) == size


def test_snap_bbox_lands_every_edge_on_the_source_grid():
    snapped, _, _ = snap_bbox((12.3456, -7.6543, 12.5432, -7.4321))

    assert all(on_grid(v) for v in snapped)


def test_snap_bbox_only_ever_grows_the_area():
    minx, miny, maxx, maxy = snap_bbox(KATHMANDU)[0]

    assert minx <= KATHMANDU[0]
    assert miny <= KATHMANDU[1]
    assert maxx >= KATHMANDU[2]
    assert maxy >= KATHMANDU[3]


def test_snap_bbox_buffers_by_whole_pixels():
    _, plain_w, plain_h = snap_bbox(KATHMANDU, buffer_px=0)
    _, buffered_w, buffered_h = snap_bbox(KATHMANDU, buffer_px=1)

    assert (buffered_w, buffered_h) == (plain_w + 2, plain_h + 2)


def test_snap_bbox_survives_extreme_coordinates():
    # Near the pole and the dateline, but not across it.
    snapped, width, height = snap_bbox((179.9, -89.9, 179.95, -89.85))

    assert all(on_grid(v) for v in snapped)
    assert width > 0 and height > 0


def test_an_antimeridian_crossing_aoi_is_refused_not_mirrored():
    # A crossing polygon's bounds span the globe. Known limitation: refused
    # rather than split, which fails loudly instead of quietly cropping the
    # wrong side of the planet.
    with pytest.raises(ValueError, match=str(MAX_DIMENSION_PX)):
        snap_bbox((-179.99, 27.6, 179.99, 27.7))


def test_snap_bbox_rejects_a_degenerate_bbox():
    with pytest.raises(ValueError, match="Degenerate bbox"):
        snap_bbox((85.3, 27.7, 85.3, 27.7))


def test_snap_bbox_rejects_an_aoi_too_large_to_serve():
    with pytest.raises(ValueError, match=str(MAX_DIMENSION_PX)):
        snap_bbox((0.0, 0.0, 20.0, 20.0))


def test_dem_crop_url_asks_for_a_single_band_crop_at_native_size():
    url = dem_crop_url(TILE_SEAM)
    snapped, width, height = snap_bbox(TILE_SEAM)

    assert url.startswith(
        f"{settings.OAM_RASTER_API_URL}/collections/"
        f"{settings.DEM_STAC_COLLECTION}/bbox/"
    )
    assert f"width={width}&height={height}" in url
    assert "return_mask=false" in url
    assert "assets=data" in url
    assert f"{snapped[0]:.10f},{snapped[1]:.10f}" in url


def test_dem_source_values_match_their_names():
    assert [source.value for source in DEMSource] == [
        source.name for source in DEMSource
    ]


def test_dem_source_serialises_to_a_bare_string_for_the_insert():
    dumped = enum_to_str(DEMSource.GLO30)

    assert dumped == "GLO30"
    assert type(dumped) is str
