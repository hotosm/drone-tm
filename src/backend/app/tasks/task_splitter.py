"""Class and helper methods for task splitting."""

import json
import logging
from pathlib import Path
from typing import Optional, Union
import geojson
import numpy as np
from geojson import Feature, FeatureCollection, GeoJSON
from shapely.geometry import Polygon, shape
from shapely.geometry.geo import mapping
from shapely.ops import unary_union

# Instantiate logger
log = logging.getLogger(__name__)


class TaskSplitter(object):
    """A class to split polygons."""

    def __init__(
        self,
        aoi_obj: Optional[Union[str, FeatureCollection, dict]] = None,
    ):
        """This class splits a polygon into tasks using a variety of algorithms.

        Args:
            aoi_obj (str, FeatureCollection): Input AOI, either a file path,
                or GeoJSON string.

        Returns:
            instance (TaskSplitter): An instance of this class
        """
        # Parse AOI, merge if multiple geometries
        if aoi_obj:
            geojson = self.input_to_geojson(aoi_obj)
            self.aoi = self.geojson_to_shapely_polygon(geojson)

        # Init split features
        self.split_features = None

    @staticmethod
    def input_to_geojson(
        input_data: Union[str, FeatureCollection, dict], merge: bool = False
    ) -> GeoJSON:
        """Parse input data consistently to a GeoJSON obj."""
        log.info(f"Parsing GeoJSON from type {type(input_data)}")
        if (
            isinstance(input_data, str)
            and len(input_data) < 250
            and Path(input_data).is_file()
        ):
            # Impose restriction for path lengths <250 chars
            with open(input_data, "r") as jsonfile:
                try:
                    parsed_geojson = geojson.load(jsonfile)
                except json.decoder.JSONDecodeError as e:
                    raise IOError(
                        f"File exists, but content is invalid JSON: {input_data}"
                    ) from e

        elif isinstance(input_data, FeatureCollection):
            parsed_geojson = input_data
        elif isinstance(input_data, dict):
            parsed_geojson = geojson.loads(geojson.dumps(input_data))
        elif isinstance(input_data, str):
            geojson_truncated = (
                input_data if len(input_data) < 250 else f"{input_data[:250]}..."
            )
            log.debug(f"GeoJSON string passed: {geojson_truncated}")
            parsed_geojson = geojson.loads(input_data)
        else:
            err = (
                f"The specified AOI is not valid (must be geojson or str): {input_data}"
            )
            log.error(err)
            raise ValueError(err)

        return parsed_geojson

    @staticmethod
    def geojson_to_featcol(
        geojson: Union[FeatureCollection, Feature, dict],
    ) -> FeatureCollection:
        """Standardise any geojson type to FeatureCollection."""
        # Parse and unparse geojson to extract type
        if isinstance(geojson, FeatureCollection):
            # Handle FeatureCollection nesting
            features = geojson.get("features", [])
        elif isinstance(geojson, Feature):
            # Must be a list
            features = [geojson]
        else:
            # A standard geometry type. Has coordinates, no properties
            features = [Feature(geometry=geojson)]
        return FeatureCollection(features)

    @staticmethod
    def geojson_to_shapely_polygon(
        geojson: Union[FeatureCollection, Feature, dict],
    ) -> Polygon:
        """Parse GeoJSON and return shapely Polygon.

        The GeoJSON may be of type FeatureCollection, Feature, or Polygon,
        but should only contain one Polygon geometry in total.
        """
        features = TaskSplitter.geojson_to_featcol(geojson).get("features", [])
        log.debug("Converting AOI to Shapely geometry")

        if len(features) == 0:
            msg = "The input AOI contains no geometries."
            log.error(msg)
            raise ValueError(msg)
        elif len(features) > 1:
            msg = "The input AOI cannot contain multiple geometries."
            log.error(msg)
            raise ValueError(msg)

        return shape(features[0].get("geometry"))

    def splitBySquare(self, meters: int) -> FeatureCollection:
        xmin, ymin, xmax, ymax = self.aoi.bounds

        meter = 0.0000114
        length = float(meters) * meter
        width = float(meters) * meter

        area_threshold = (length * width) / 3

        # Generate grid columns and rows based on AOI bounds
        cols = np.arange(xmin, xmax + width, width)
        rows = np.arange(ymin, ymax + length, length)
        polygons = []
        small_polygons = []
        for x in cols[:-1]:
            for y in rows[:-1]:
                # Create a square grid polygon
                grid_polygon = Polygon(
                    [(x, y), (x + width, y), (x + width, y + length), (x, y + length)]
                )
                # Clip the grid polygon to fit within the AOI
                clipped_polygon = grid_polygon.intersection(self.aoi)
                if not clipped_polygon.is_empty:
                    if clipped_polygon.area < area_threshold:
                        small_polygons.append(clipped_polygon)
                    else:
                        polygons.append(clipped_polygon)
                else:
                    polygons.append(clipped_polygon)

        for small_polygon in small_polygons:
            while True:
                adjacent_polygons = [
                    large_polygon
                    for large_polygon in polygons
                    if small_polygon.touches(large_polygon)
                ]
                if adjacent_polygons:
                    # Get the adjacent polygon with the maximum shared boundary length
                    nearest_polygon = max(
                        adjacent_polygons,
                        key=lambda p: small_polygon.intersection(p).length,
                    )

                    # Merge the small polygon with the nearest large polygon
                    merged_polygon = unary_union([small_polygon, nearest_polygon])

                    if merged_polygon.geom_type == "MultiPolygon":
                        # Handle MultiPolygon by adding the original small polygon back
                        log.warning(
                            "Found MultiPolygon, adding original small polygon..."
                        )
                        polygons.append(small_polygon)
                        break

                    # Remove both the small polygon and the nearest large polygon
                    polygons.remove(nearest_polygon)
                    small_polygon = merged_polygon

                    # Check if the merged polygon is greater than the area threshold
                    if small_polygon.area >= area_threshold:
                        polygons.append(small_polygon)
                        break
                else:
                    # If no adjacent polygon is found, add the small polygon as is
                    polygons.append(small_polygon)
                    break

        merged_geojson = FeatureCollection(
            [Feature(geometry=mapping(p)) for p in polygons]
        )

        # Store the result in the instance variable and return it
        self.split_features = merged_geojson
        return self.split_features


def split_by_square(
    aoi: Union[str, FeatureCollection],
    meters: int = 100,
) -> FeatureCollection:
    """Split an AOI by square, dividing into an even grid.

    Args:
        aoi(str, FeatureCollection): Input AOI, either a file path,
            GeoJSON string, or FeatureCollection object.
        meters(str, optional): Specify the square size for the grid.
            Defaults to 100m grid.

    Returns:
        features (FeatureCollection): A multipolygon of all the task boundaries.
    """
    # Parse AOI
    parsed_aoi = TaskSplitter.input_to_geojson(aoi)
    aoi_featcol = TaskSplitter.geojson_to_featcol(parsed_aoi)
    if not parsed_aoi:
        err = "A valid data extract must be provided."
        log.error(err)
        raise ValueError(err)

    splitter = TaskSplitter(aoi_featcol)
    split_features = splitter.splitBySquare(meters)
    if not split_features:
        msg = "Failed to generate split features."
        log.error(msg)
        raise ValueError(msg)
    return split_features
