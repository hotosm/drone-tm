import json

import numpy as np
import pytest
from drone_flightplan.add_elevation_from_dem import add_elevation_from_dem
from osgeo import gdal, osr

POINT_LON, POINT_LAT = 84.5, 27.5
RASTER_WIDTH, RASTER_HEIGHT = 10, 4
TARGET_COLUMN, TARGET_ROW = 6, 1


def _make_dem(path: str, epsg: int, pixel_size: float):
    """Write a DEM where each pixel's value is row * 100 + column.

    The test point lands in the centre of (TARGET_COLUMN, TARGET_ROW).
    """
    wgs84 = osr.SpatialReference()
    wgs84.ImportFromEPSG(4326)
    wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_dem_crs = osr.CoordinateTransformation(wgs84, srs)
    x, y, _ = to_dem_crs.TransformPoint(POINT_LON, POINT_LAT)

    origin_x = x - (TARGET_COLUMN + 0.5) * pixel_size
    origin_y = y + (TARGET_ROW + 0.5) * pixel_size
    values = [
        [row * 100 + col for col in range(RASTER_WIDTH)] for row in range(RASTER_HEIGHT)
    ]

    driver = gdal.GetDriverByName("GTiff")
    ds = driver.Create(path, RASTER_WIDTH, RASTER_HEIGHT, 1, gdal.GDT_Float32)
    ds.SetGeoTransform((origin_x, pixel_size, 0, origin_y, 0, -pixel_size))
    ds.SetProjection(srs.ExportToWkt())
    ds.GetRasterBand(1).WriteArray(np.array(values, dtype="float32"))
    ds = None  # flushes the file to disk


@pytest.mark.parametrize(
    ("epsg", "pixel_size"),
    [
        (4326, 0.01),  # geographic, like the app's default DEM
        (32644, 1000.0),  # projected (UTM 44N), like a user upload (#718)
    ],
)
def test_elevation_is_sampled_from_the_matching_pixel(tmp_path, epsg, pixel_size):
    dem_path = str(tmp_path / "dem.tif")
    outfile = str(tmp_path / "out.geojson")
    _make_dem(dem_path, epsg, pixel_size)
    point = {"type": "Point", "coordinates": [POINT_LON, POINT_LAT]}
    points = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": point, "properties": {}}],
        }
    )

    add_elevation_from_dem(dem_path, points, outfile)

    with open(outfile) as f:
        elevation = json.load(f)["features"][0]["properties"]["elevation"]
    assert elevation == TARGET_ROW * 100 + TARGET_COLUMN
