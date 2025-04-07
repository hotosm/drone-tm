#!/usr/bin/python3
"""Temporary utility to test the addElevationFromDEM module. It's a bit of a hassle reading and writing GeoJSON as in-memory objects using GDAL, so testing that from here.

I couldn't be bothered to create a proper unit test.
"""

import argparse

from addElevationFromDEM import add_elevation_from_dem as ae

if __name__ == "__main__":
    p = argparse.ArgumentParser()

    p.add_argument("inraster", help="input DEM GeoTIFF raster file")
    p.add_argument("inpoints", help="input points geojson file")
    p.add_argument("outfile", help="output GeoJSON file")

    a = p.parse_args()

    infile = open(a.inpoints, "r")
    inpointstring = infile.read()

    waypoints_with_elevation = ae(a.inraster, inpointstring)
    print(waypoints_with_elevation)
