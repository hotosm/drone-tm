#!/bin/python3
"""Creates a set of waypoints for drone mapping flight plans.

Arguments:
    Required:
        - A bounding box (see docstring on squaregrid function for details),
          should be in EPSG:3857 Pseudo Mercator coordinates (metres)
        - An output filepath
    Optional:
        - A Digital Elevation Model as a GDAL-readable GeoTIFF raster
          (--input_raster). If provided, the program will attempt to sample the
          DEM at each point, providing an elevation as well as x and y coords.

Returns:
    An output CSV file containing the columns:
    [index, x, y] where x and y are coordinates in EPSG:3857
    or, if a DEM is provided, and elevation column will be added:
    [index, x, y, elevation]. Elevation will be in whatever Coordinate
    Reference System that the DEM file is in: be careful!

Typical usage example:

With a DEM (creates points with sampled elevation):
./flightPlanWaypointGenerator.py -minx 12872498.8 -miny -936470.4 -maxx 12873345.9 -maxy -935840.1 -xspac 24 -yspac 36 -ir /path/to/DEM.tif /path/to/outfile.csv

Without a DEM (no elevation column):
./flightPlanWaypointGenerator.py -minx 12872498.8 -miny -936470.4 -maxx 12873345.9 -maxy -935840.1 -xspac 24 -yspac 36 /path/to/outfile.csv


"""

__version__ = "2024-07-31"

import argparse
import csv

# Moving this import to the relevant function because it'll fail if GDAL
# is not installed on the system; only needed if sampling elevation from a DEM
# import sampleRasterAtPoints as sr


def squaregrid(
    minx: float, miny: float, maxx: float, maxy: float, xspac: float, yspac: float
) -> list:
    """Create a set of waypoints
    Args: minx, miny, maxx, maxy: coordinates in metres using the
          EPSG:3857 Pseudo Mercator Coordinate Reference System

          xspac, yspac: spacing between forward (xspac) and lateral (yspac)

    Returns: A list, each item of which is a list of points as [index, x, y].
    """
    xlen = maxx - minx
    ylen = maxy - miny
    xpoints = int(xlen / xspac + 1)
    ypoints = int(ylen / yspac + 1)
    points = []
    # loop through lines
    idx = 1
    for yi in range(0, ypoints, 2):
        # points heading out
        for xi in range(xpoints):
            x = minx + (xi * xspac)
            y = miny + (yi * yspac)
            points.append([idx, x, y])
            idx += 1
        # points returning
        for xi in range(xpoints, 0, -1):
            x = minx + ((xi - 1) * xspac)
            y = miny + ((yi + 1) * yspac)
            points.append([idx, x, y])
            idx += 1
    return points


def grid2csv(grid, outfile):
    """Writes a CSV file from a grid without an elevation column"""
    with open(outfile, "w") as of:
        w = csv.writer(of)
        w.writerow(["idx", "x", "y"])
        w.writerows(grid)


def gridWithElevation2csv(grid, outfile):
    """Writes a CSV file from a grid with an elevation column"""
    with open(outfile, "w") as of:
        w = csv.writer(of)
        w.writerow(["idx", "x", "y", "elevation"])
        w.writerows(grid)


if __name__ == "__main__":
    """
    Call the module from the console. See module docstring for usage details.
    """
    p = argparse.ArgumentParser()

    p.add_argument("outfile", help="output csv file")
    p.add_argument("-minx", "--min-x", type=float, help="minimum x coord in EPSG:3857")
    p.add_argument("-maxx", "--max-x", type=float, help="maximum x coord in EPSG:3857")
    p.add_argument("-miny", "--min-y", type=float, help="minimum y coord in EPSG:3857")
    p.add_argument("-maxy", "--max-y", type=float, help="maximum y coord in EPSG:3857")
    p.add_argument("-xspac", "--x-spacing", type=float, help="Forward spacing")
    p.add_argument("-yspac", "--y-spacing", type=float, help="Lateral spacing")
    p.add_argument(
        "-ir", "--input_raster", type=str, help="Digital Elevation Model GeoTIFF file"
    )

    a = p.parse_args()
    print(a)

    # TODO generate the minx, miny, maxx, maxy coords from a bounding box of
    # a supplied Area of Interest (AOI) layer from a GIS file.
    # TODO Arbitrary rotation to any angle (currently only creates waypoints
    # oriented straight east-west
    # TODO clip waypoints by a polygon boundary
    grid = squaregrid(a.min_x, a.min_y, a.max_x, a.max_y, a.x_spacing, a.y_spacing)

    if a.input_raster:
        try:
            import sampleRasterAtPoints as sr

            grid_with_elevation = sr.sampleRasterFromPointsList(a.input_raster, grid)
            gridfile = gridWithElevation2csv(grid_with_elevation, a.outfile)
        except Exception as e:
            print(e)
            print("Maybe your DEM and AOI don't align or are incompatible?")

    else:
        gridfile = grid2csv(grid, a.outfile)
