"""Class and helper methods for task splitting."""

import json
import logging
import time
from pathlib import Path
from typing import Optional, Union

from area_splitter.splitter import split_by_square as _area_split_by_square
import geojson
from geojson import Feature, FeatureCollection, GeoJSON
from shapely.errors import GEOSException
from shapely.geometry import mapping, Polygon, shape
from shapely.ops import transform as shapely_transform, unary_union
from pyproj import Transformer

try:
    from shapely.validation import make_valid
except ImportError:
    make_valid = None

# Instantiate logger
log = logging.getLogger(__name__)


class GeometryValidationError(ValueError):
    """Raised when input geometry is invalid and cannot be repaired."""


class GeometryTopologyError(ValueError):
    """Raised when geometry operations fail due to topology issues."""


class TaskSplitter:
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
            with open(input_data) as jsonfile:
                try:
                    parsed_geojson = geojson.load(jsonfile)
                except json.decoder.JSONDecodeError as e:
                    raise OSError(
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

        The GeoJSON may be of type FeatureCollection, Feature, or Polygon.
        If multiple geometries are present they are merged via unary_union
        so that FeatureCollections exported by QGIS (or similar) work
        without requiring the caller to pre-merge.
        """
        features = TaskSplitter.geojson_to_featcol(geojson).get("features", [])
        log.debug("Converting AOI to Shapely geometry")

        if len(features) == 0:
            msg = "The input AOI contains no geometries."
            log.error(msg)
            raise ValueError(msg)

        if len(features) == 1:
            return TaskSplitter._ensure_valid_polygonal_geometry(
                shape(features[0].get("geometry"))
            )

        log.info(f"AOI contains {len(features)} geometries, merging into one polygon")
        polygons = [
            TaskSplitter._ensure_valid_polygonal_geometry(shape(f.get("geometry")))
            for f in features
        ]
        try:
            merged = unary_union(polygons)
        except GEOSException as e:
            raise GeometryTopologyError(
                "Failed to merge AOI geometries due to topology issues"
            ) from e
        if merged.geom_type == "MultiPolygon":
            merged = merged.convex_hull
        return TaskSplitter._ensure_valid_polygonal_geometry(merged)

    @staticmethod
    def _repair_geometry(geom):
        """Attempt to repair invalid geometry using make_valid or buffer(0)."""
        if make_valid is not None:
            try:
                repaired = make_valid(geom)
                if not repaired.is_empty:
                    return repaired
            except Exception:
                pass

        try:
            repaired = geom.buffer(0)
            if not repaired.is_empty:
                return repaired
        except Exception:
            pass

        return geom

    @staticmethod
    def _ensure_valid_polygonal_geometry(geom):
        """Ensure geometry is valid, non-empty and polygonal."""
        if geom.is_empty:
            raise GeometryValidationError("Geometry is empty")

        candidate = geom
        if not candidate.is_valid:
            candidate = TaskSplitter._repair_geometry(candidate)

        if candidate.is_empty or not candidate.is_valid:
            raise GeometryValidationError(
                "Geometry is invalid and could not be repaired"
            )

        if candidate.geom_type in {"Polygon", "MultiPolygon"}:
            return candidate

        if hasattr(candidate, "geoms"):
            polygon_parts = [
                g for g in candidate.geoms if g.geom_type in {"Polygon", "MultiPolygon"}
            ]
            if polygon_parts:
                merged = unary_union(polygon_parts)
                if merged.is_empty or not merged.is_valid:
                    raise GeometryValidationError(
                        "Geometry repair did not produce a valid polygon"
                    )
                return merged

        raise GeometryValidationError(
            f"Geometry must be polygonal, got {candidate.geom_type}"
        )

    def splitBySquare(self, meters: int) -> FeatureCollection:
        # Set up transformations: WGS84 (EPSG:4326) <-> Web Mercator (EPSG:3857)
        transformer_to_mercator = Transformer.from_crs(
            "EPSG:4326", "EPSG:3857", always_xy=True
        )
        transformer_to_wgs84 = Transformer.from_crs(
            "EPSG:3857", "EPSG:4326", always_xy=True
        )

        # Transform AOI to Web Mercator for accurate grid calculations in meters
        aoi_mercator = TaskSplitter._ensure_valid_polygonal_geometry(
            shapely_transform(transformer_to_mercator.transform, self.aoi)
        )
        xmin, ymin, xmax, ymax = aoi_mercator.bounds
        est_cols = int((xmax - xmin) / meters) + 1
        est_rows = int((ymax - ymin) / meters) + 1
        log.debug(
            f"splitBySquare: AOI bounds {xmin:.0f},{ymin:.0f} → {xmax:.0f},{ymax:.0f} (~{est_cols}×{est_rows} grid)"
        )
        _MAX_CELLS = 50_000
        if est_cols * est_rows > _MAX_CELLS:
            raise GeometryValidationError(
                f"AOI grid would require {est_cols * est_rows:,} cells at {meters}m - "
                "this is almost certainly caused by invalid GPS coordinates in the imagery. "
                f"AOI spans {(xmax - xmin) / 1000:.1f} km × {(ymax - ymin) / 1000:.1f} km."
            )

        # Generate grid columns and rows based on AOI bounds and specified square length in meters
        def frange(start: float, stop: float, step: float):
            """Range function that works with floats."""
            x = start
            while x <= stop:
                yield x
                x += step

        # Create grid columns and rows based on the AOI bounds
        cols = list(frange(xmin, xmax + meters, meters))
        rows = list(frange(ymin, ymax + meters, meters))

        polygons = []
        small_polygons = []

        area_threshold = (meters**2) / 3
        _t0 = time.perf_counter()

        # Create a grid of square cells in Web Mercator
        for x in cols[:-1]:
            for y in rows[:-1]:
                grid_polygon = Polygon(
                    [(x, y), (x + meters, y), (x + meters, y + meters), (x, y + meters)]
                )

                # Clip the grid polygon to fit within the AOI
                try:
                    clipped_polygon = grid_polygon.intersection(aoi_mercator)
                except GEOSException as e:
                    raise GeometryTopologyError(
                        "Failed to intersect AOI with split grid"
                    ) from e

                if not clipped_polygon.is_empty:
                    if clipped_polygon.area < area_threshold:
                        small_polygons.append(clipped_polygon)
                    else:
                        polygons.append(clipped_polygon)
                else:
                    polygons.append(clipped_polygon)

        log.debug(
            f"splitBySquare: grid intersections done in {time.perf_counter() - _t0:.2f}s "
            f"({len(polygons)} full cells, {len(small_polygons)} slivers to merge)"
        )
        _t1 = time.perf_counter()

        for small_polygon in small_polygons:
            while True:
                adjacent_polygons = [
                    large_polygon
                    for large_polygon in polygons
                    if small_polygon.touches(large_polygon)
                ]
                if adjacent_polygons:
                    # Get the adjacent polygon with the maximum shared boundary length
                    try:
                        nearest_polygon = max(
                            adjacent_polygons,
                            key=lambda p: small_polygon.intersection(p).length,
                        )
                    except GEOSException as e:
                        raise GeometryTopologyError(
                            "Failed while evaluating adjacent split polygons"
                        ) from e

                    # Merge the small polygon with the nearest large polygon
                    try:
                        merged_polygon = unary_union([small_polygon, nearest_polygon])
                    except GEOSException as e:
                        raise GeometryTopologyError(
                            "Failed to merge adjacent split polygons"
                        ) from e

                    # if merged_polygon.geom_type == "MultiPolygon":
                    #     # Handle MultiPolygon by adding the original small polygon back
                    #     log.warning(
                    #         "Found MultiPolygon, adding original small polygon..."
                    #     )
                    #     polygons.append(small_polygon)
                    #     break

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

        log.debug(
            f"splitBySquare: sliver merge done in {time.perf_counter() - _t1:.2f}s; "
            f"total {time.perf_counter() - _t0:.2f}s → {len(polygons)} final polygons"
        )

        # Transform all polygons back to WGS84 for final output
        polygons_wgs84 = [
            shapely_transform(transformer_to_wgs84.transform, p)
            for p in polygons
            if p.area > 0
        ]

        # Convert polygons to GeoJSON FeatureCollection
        merged_geojson = FeatureCollection(
            [Feature(geometry=mapping(p)) for p in polygons_wgs84]
        )

        # Store the result in the instance variable and return it
        self.split_features = merged_geojson
        return self.split_features


def split_by_square(
    aoi: Union[str, FeatureCollection],
    db: Union[str, object],
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
        raise ValueError("A valid data extract must be provided.")

    # Pre-validate: raises GeometryValidationError for non-polygonal input
    TaskSplitter.geojson_to_shapely_polygon(aoi_featcol)

    split_features = _area_split_by_square(aoi_featcol, db, meters=meters)
    if not split_features:
        raise ValueError("Failed to generate split features.")
    return split_features
