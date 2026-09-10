import json

import numpy as np
from drone_flightplan.add_elevation_from_dem import add_elevation_from_dem
from osgeo import gdal, osr

# A point in Kathmandu, used as the single test point (WGS84 lon/lat, as a
# GeoJSON file would normally provide).
POINT_LON, POINT_LAT = 84.5, 27.5

# Raster: 10 columns x 4 rows, UTM zone 44N (EPSG:32644) -- a projected CRS,
# representative of a "user-uploaded" DEM rather than the app's default
# geographic (WGS84) DEM. Pixel value = column index, constant down each
# column, so a wrong pixel lookup reads back the wrong (or out-of-bounds,
# hence 0) value instead of the real one.
RASTER_WIDTH, RASTER_HEIGHT = 10, 4
PIXEL_SIZE_M = 1000.0
TARGET_COLUMN = 6  # deliberately non-zero/non-edge, and != the OOB fallback value (0)
TARGET_ROW = 1


def _project_point_to_utm(lon: float, lat: float) -> tuple[float, float]:
    """Ground truth: where this WGS84 point actually lands in UTM 44N,
    computed independently of add_elevation_from_dem's own (buggy or fixed)
    transform logic, so the raster can be built to align with it exactly.
    """
    wgs84 = osr.SpatialReference()
    wgs84.ImportFromEPSG(4326)
    wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(32644)
    utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(wgs84, utm)
    easting, northing, _ = transform.TransformPoint(lon, lat)
    return easting, northing


def _make_test_dem(path: str, easting: float, northing: float):
    # Position the raster so (easting, northing) falls in the middle of
    # pixel (TARGET_COLUMN, TARGET_ROW).
    origin_easting = easting - (TARGET_COLUMN + 0.5) * PIXEL_SIZE_M
    origin_northing = northing + (RASTER_HEIGHT - TARGET_ROW - 0.5) * PIXEL_SIZE_M

    driver = gdal.GetDriverByName("GTiff")
    ds = driver.Create(path, RASTER_WIDTH, RASTER_HEIGHT, 1, gdal.GDT_Float32)
    ds.SetGeoTransform(
        (origin_easting, PIXEL_SIZE_M, 0, origin_northing, 0, -PIXEL_SIZE_M)
    )
    utm_srs = osr.SpatialReference()
    utm_srs.ImportFromEPSG(32644)
    ds.SetProjection(utm_srs.ExportToWkt())

    band = ds.GetRasterBand(1)
    data = [[col for col in range(RASTER_WIDTH)] for _ in range(RASTER_HEIGHT)]
    band.WriteArray(np.array(data, dtype="float32"))
    band.FlushCache()
    ds = None


def _make_test_points(lon: float, lat: float) -> str:
    return json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {},
                }
            ],
        }
    )


def test_elevation_lookup_on_projected_crs_dem(tmp_path):
    """Regression test for the axis-order bug (issue #718).

    Uses a UTM (projected CRS) DEM rather than a plain WGS84 one, since
    that's the combination where the old hardcoded axis swap actually
    produces a wrong result: for a projected CRS, GDAL's authority-compliant
    axis order already matches (x, y)/(easting, northing), so swapping it
    corrupts an otherwise-correct transform instead of fixing a swapped one.
    """
    easting, northing = _project_point_to_utm(POINT_LON, POINT_LAT)

    raster_path = str(tmp_path / "test_dem_utm.tif")
    outfile = str(tmp_path / "out.geojson")
    _make_test_dem(raster_path, easting, northing)

    points = _make_test_points(POINT_LON, POINT_LAT)
    result = add_elevation_from_dem(raster_path, points, outfile)
    assert result == 0

    with open(outfile) as f:
        out_data = json.load(f)

    elevation = out_data["features"][0]["properties"]["elevation"]
    assert elevation == float(TARGET_COLUMN), (
        f"Expected elevation {TARGET_COLUMN}.0 (correct axis order for a "
        f"projected-CRS DEM), got {elevation} -- the easting/northing swap "
        "bug is back."
    )
