import os
import re

import numpy as np
import pyproj
import geojson
import tempfile

from uuid import UUID
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiPolygon,
    Point,
    Polygon,
    shape,
    mapping,
)

from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

from app.models.enums import ImageStatus
from app.s3 import maybe_presign_s3_key

from app.utils import (
    calculate_angular_difference,
    circular_mean_pair,
    circular_mean_list,
)

from drone_flightplan import create_flightplan
from drone_flightplan.drone_type import DRONE_PARAMS, DroneType
from drone_flightplan.enums import FlightMode

from shapely.ops import transform, unary_union


projector = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
inverse_projector = pyproj.Transformer.from_crs(
    "EPSG:3857", "EPSG:4326", always_xy=True
)


def _geometry_to_feature(geom) -> dict:
    """Wrap a Shapely geometry as a GeoJSON Feature."""
    return {"type": "Feature", "properties": {}, "geometry": mapping(geom)}


def _geometry_to_feature_collection(geom) -> dict:
    """Wrap a Shapely geometry as a GeoJSON FeatureCollection."""
    if geom is None:
        return {"type": "FeatureCollection", "features": []}
    return {"type": "FeatureCollection", "features": [_geometry_to_feature(geom)]}


def _coerce_drone_type(drone_model: str | None) -> DroneType | None:
    """Normalize drone model strings from DB/EXIF into supported DroneType values."""
    if not drone_model:
        return None

    normalized = re.sub(r"[^A-Z0-9]+", "_", drone_model.upper()).strip("_")
    if not normalized:
        return None

    try:
        return DroneType(normalized)
    except ValueError:
        pass

    aliases = {
        "DJI_AIR3": DroneType.DJI_AIR_3,
        "DJI_MINI4_PRO": DroneType.DJI_MINI_4_PRO,
        "DJI_MINI_4": DroneType.DJI_MINI_4_PRO,
        "DJI_MINI5_PRO": DroneType.DJI_MINI_5_PRO,
        "POTENSIC_ATOM": DroneType.POTENSIC_ATOM_1,
        "POTENSIC_ATOM_SE": DroneType.POTENSIC_ATOM_1,
    }
    return aliases.get(normalized)


def point_to_meters(location: dict) -> Point:
    """
    Converts GeoJSON [Lon, Lat] to EPSG:3857 (Web Mercator) meters.

    Args:
        location (dict): GeoJSON point dictionary (e.g., {'coordinates': [lon, lat]})

    Returns:
        Point: A Shapely Point object in meters, or None if input is invalid.
    """
    if not location or "coordinates" not in location:
        return None

    coordinates = location["coordinates"]
    if len(coordinates) < 2:
        return None

    lon, lat = coordinates[0], coordinates[1]

    x, y = projector.transform(lon, lat)

    return Point(x, y)


def _project_geometry_to_meters(geom):
    """Project a geometry from EPSG:4326 to EPSG:3857."""
    return transform(projector.transform, geom)


def _project_geometry_to_wgs84(geom):
    """Project a geometry from EPSG:3857 back to EPSG:4326."""
    return transform(inverse_projector.transform, geom)


def _filter_polygonal_geometry_by_area(geom, min_area_m2: float):
    """Drop tiny polygonal fragments created by geometric difference operations."""
    if geom is None or geom.is_empty:
        return None

    if isinstance(geom, Polygon):
        return geom if geom.area >= min_area_m2 else None

    if isinstance(geom, MultiPolygon):
        polygons = [polygon for polygon in geom.geoms if polygon.area >= min_area_m2]
        if not polygons:
            return None
        if len(polygons) == 1:
            return polygons[0]
        return MultiPolygon(polygons)

    if isinstance(geom, GeometryCollection):
        polygons = [
            polygon
            for polygon in geom.geoms
            if isinstance(polygon, Polygon) and polygon.area >= min_area_m2
        ]
        if not polygons:
            return None
        if len(polygons) == 1:
            return polygons[0]
        return MultiPolygon(polygons)

    return None


def _generate_flightplan_for_geometry(
    reconstruction_aoi,
    drone_type: DroneType,
    average_altitude: float,
    rotation_angle: float | None = None,
    front_overlap: float = 70,
    side_overlap: float = 70,
    flight_mode: FlightMode = FlightMode.WAYPOINTS,
):
    """Generate a reflight plan for an already-derived reconstruction AOI."""
    if reconstruction_aoi is None or reconstruction_aoi.is_empty:
        return None

    # Library fix
    original_loads = geojson.loads

    def unwrap_geojson_loads(obj, **kwargs):
        if isinstance(obj, dict) and "geojson" in obj:
            return original_loads(obj["geojson"], **kwargs)

        if isinstance(obj, dict):
            return obj

        return original_loads(obj, **kwargs)

    geojson.loads = unwrap_geojson_loads

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_outfile = os.path.join(tmp_dir, "reconstruction")

            result_path = create_flightplan(
                aoi=mapping(reconstruction_aoi),
                forward_overlap=max(50, min(90, front_overlap)),
                side_overlap=max(50, min(90, side_overlap)),
                agl=average_altitude,
                flight_mode=flight_mode,
                drone_type=drone_type,
                rotation_angle=rotation_angle or 0,
                outfile=temp_outfile,
            )

            if result_path and os.path.exists(result_path):
                with open(result_path, "rb") as f:
                    return {"kmz_bytes": f.read(), "geometry": reconstruction_aoi}
            return None

    finally:
        geojson.loads = original_loads


def _detect_sparse_coverage_gap(
    task_aoi: Polygon,
    images: list[dict],
    drone_type: DroneType,
    average_altitude: float,
):
    """
    Estimate uncovered task AOI for very small image sets where trajectory baselines
    cannot be derived reliably from neighboring images.
    """
    if not images or average_altitude <= 0:
        return None

    specs = DRONE_PARAMS[drone_type]
    forward_footprint = average_altitude * specs["VERTICAL_FOV"]
    horizontal_footprint = average_altitude * specs["HORIZONTAL_FOV"]
    coverage_radius = min(forward_footprint, horizontal_footprint) / 2

    if coverage_radius <= 0:
        return None

    task_aoi_m = _project_geometry_to_meters(task_aoi)
    coverage_buffers = []

    for image in images:
        point_m = point_to_meters(image["image_location_json"])
        if point_m is None:
            continue
        coverage_buffers.append(point_m.buffer(coverage_radius))

    if not coverage_buffers:
        return None

    covered_area_m = unary_union(coverage_buffers)
    uncovered_area_m = task_aoi_m.difference(covered_area_m)
    image_footprint_area = forward_footprint * horizontal_footprint
    min_gap_area = max(image_footprint_area * 0.5, 100.0)
    uncovered_area_m = _filter_polygonal_geometry_by_area(
        uncovered_area_m, min_gap_area
    )

    if uncovered_area_m is None or uncovered_area_m.is_empty:
        return None

    if uncovered_area_m.area < max(task_aoi_m.area * 0.15, min_gap_area):
        return None

    return _project_geometry_to_wgs84(uncovered_area_m)


def _calculate_side_overlap_distance(
    previous_leg: list[dict], current_leg: list[dict]
) -> tuple[float, dict, dict]:
    """
    Finds the lateral distance between two legs by measuring the distance from
    the midpoint of the shorter leg to its nearest neighbor in the longer leg.

    Args:
        previous_leg (list[dict]): List of image data for the previous leg.
        current_leg (list[dict]): List of image data for the current leg.

    Returns:
        float: Minimum distance found between shortest and longest leg
        dict:  Starting/reference location
        dict:  Nearest neighbor location
    """
    min_distance = float("inf")
    nearest_neighbor_loc = None

    # Identify shortest and longest legs
    if len(previous_leg) < len(current_leg):
        shortest_leg, longer_leg = previous_leg, current_leg
    else:
        shortest_leg, longer_leg = current_leg, previous_leg

    # Establish the reference point (midpoint of the short leg)
    reference_point_idx = len(shortest_leg) // 2
    reference_loc = shortest_leg[reference_point_idx]["image_location_json"]
    reference_point_m = point_to_meters(reference_loc)

    for image in longer_leg:
        current_point_m = point_to_meters(image["image_location_json"])

        distance = reference_point_m.distance(current_point_m)

        if distance < min_distance:
            min_distance = distance
            nearest_neighbor_loc = image["image_location_json"]

    return min_distance, reference_loc, nearest_neighbor_loc


def _validate_gaps_in_task_aoi(
    task_aoi_outline: Polygon, potential_gap_images: list[dict]
):
    """
    Filters detected gaps to only those that physically intersect the target AOI.

    Args:
        task_aoi_outline (Polygon): The bounding area of the mission.
        potential_gap_images (list[dict]): List of gap dictionaries found in flight trajectory.

    Returns:
        list[dict]: A list of gap dictionaries that fall within the AOI.
    """
    confirmed_gaps = []

    for potential_gap in potential_gap_images:
        potential_gap_line = LineString(
            [
                potential_gap["start_loc"]["coordinates"],
                potential_gap["end_loc"]["coordinates"],
            ]
        )

        if potential_gap_line.intersects(task_aoi_outline):
            confirmed_gaps.append(potential_gap)

    return confirmed_gaps


def _generate_reconstruction_flightplan(
    confirmed_gaps: list[dict],
    task_aoi: Polygon,
    global_side_median: float,
    drone_type: DroneType,
    average_altitude,
):
    """
    Generates a kmz flight plan to cover detected missing imagery gaps.

    Args:
        confirmed_gaps (list[dict]): Validated gaps within the AOI.
        task_aoi (Polygon): The task AOI.
        global_side_median (float): The measured side-lap distance (in meters).
        drone_type (DroneType): The drone model to optimize parameters for.
    """
    if not confirmed_gaps:
        return None

    specs = DRONE_PARAMS[drone_type]

    avg_alt = average_altitude

    avg_azi = circular_mean_list([gap["azimuth"] for gap in confirmed_gaps])

    log.info(
        f"Reconstructing for {drone_type.value}: Alt={avg_alt}m, Azimuth={avg_azi}deg"
    )

    vertical_footprint = 2 * avg_alt * specs["VERTICAL_FOV"]
    horizontal_footprint = 2 * avg_alt * specs["HORIZONTAL_FOV"]

    front_overlap = 100 * (1 - (confirmed_gaps[0]["expected"] / vertical_footprint))
    side_overlap = 100 * (1 - (global_side_median / horizontal_footprint))

    estimated_points = sum([(g["dist"] / g["expected"]) for g in confirmed_gaps])
    has_side_overlap_gap = any(
        g.get("type") == "side_overlap_gap" for g in confirmed_gaps
    )

    if estimated_points < 100 and not has_side_overlap_gap:
        mode = FlightMode.WAYPOINTS
    else:
        mode = FlightMode.WAYLINES

    gap_polygons = []
    for gap in confirmed_gaps:
        line = LineString(
            [gap["start_loc"]["coordinates"], gap["end_loc"]["coordinates"]]
        )
        polygon = line.buffer((horizontal_footprint / 2) / 111320)
        gap_polygons.append(polygon)

    combined_gaps = unary_union(gap_polygons)
    reconstruction_aoi = combined_gaps.intersection(task_aoi)

    if reconstruction_aoi.is_empty:
        log.warning("Reconstruction AOI is empty after intersection with Task AOI.")
        return None

    log.info(
        f"Confirmed Gaps: {len(confirmed_gaps)}, "
        f"Est. Missing Images: {estimated_points:.2f}, "
        f"Side Gap Detected: {has_side_overlap_gap}, "
        f"Selected Flight Mode: {mode.value}"
    )
    return _generate_flightplan_for_geometry(
        reconstruction_aoi,
        drone_type=drone_type,
        average_altitude=avg_alt,
        rotation_angle=avg_azi,
        front_overlap=front_overlap,
        side_overlap=side_overlap,
        flight_mode=mode,
    )


def _build_gap_geometry(
    confirmed_gaps: list[dict],
    task_aoi: Polygon,
    horizontal_footprint: float,
):
    """Create buffered gap polygons intersected with the task AOI."""
    if not confirmed_gaps or horizontal_footprint <= 0:
        return None

    gap_polygons = []
    for gap in confirmed_gaps:
        line = LineString(
            [gap["start_loc"]["coordinates"], gap["end_loc"]["coordinates"]]
        )
        polygon = line.buffer((horizontal_footprint / 2) / 111320)
        gap_polygons.append(polygon)

    combined_gaps = unary_union(gap_polygons)
    reconstruction_aoi = combined_gaps.intersection(task_aoi)

    if reconstruction_aoi.is_empty:
        log.warning("Reconstruction AOI is empty after intersection with Task AOI.")
        return None

    return reconstruction_aoi


async def identify_flight_gaps(
    db: Connection,
    project_id: UUID,
    task_id: UUID,
    manual_gaps=None,
    drone_type_override: DroneType | None = None,
):
    """
    Analyzes drone image metadata to detect front and side overlap gaps in a flight trajectory.

    Args:
        db (Connection): The database connection.
        project_id (UUID): Project ID.
        task_id (UUID): Task ID.

    Returns:
        Dict: A dictionary containing a message if analysis was successful, task ID, the original task aoi,
        gap polygons identified or manually inputted by user, drone type, reconstructed flight plan bytes, and
        image points of the current project task.
    """

    params = {
        "project_id": project_id,
        "task_id": task_id,
        "status": ImageStatus.ASSIGNED.value,
    }

    sql = """
        WITH ordered AS (
            SELECT
                i.id,
                i.filename,
                i.status,
                i.thumbnail_url,
                i.s3_key,
                ST_AsGeoJSON(i.location)::json AS image_location_json,
                i.location AS geom,
                d.model AS drone_model_name,
                NULLIF(i.exif->>'Model', '') AS exif_drone_model_name,
                COALESCE(
                    to_timestamp(i.exif->>'DateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')::timestamptz,
                    i.uploaded_at
                ) AS sort_ts,
                NULLIF(i.exif->>'FlightYawDegree', '')::double precision AS yaw_deg,
                NULLIF(regexp_replace(COALESCE(i.exif->>'AbsoluteAltitude',''), '[^0-9+\\-.]+', '', 'g'), '')::double precision AS altitude_m
            FROM project_images i
            INNER JOIN tasks t ON i.task_id = t.id
            LEFT JOIN drone_flights df ON t.id = df.task_id
            LEFT JOIN drones d ON df.drone_id = d.id
            WHERE i.project_id = %(project_id)s
                AND i.task_id = %(task_id)s
                AND i.status = %(status)s
                AND i.rejection_reason IS NULL
                AND i.location IS NOT NULL
        ),
        base AS (
            SELECT
                *,
                LAG(sort_ts, 1, sort_ts) OVER (ORDER BY sort_ts ASC) AS prev_sort_ts,
                LAG(geom, 1, geom) OVER (ORDER BY sort_ts ASC) AS prev_geom
            FROM ordered
        ),
        segmented AS (
            SELECT
                *,
                SUM(
                    CASE
                        WHEN EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)) > 600 THEN 1
                        WHEN ST_Distance(prev_geom::geography, geom::geography) > 1000 THEN 1
                        WHEN GREATEST(EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)), 0) > 0
                             AND (ST_Distance(prev_geom::geography, geom::geography) /
                                  GREATEST(EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)), 0)) > 50
                          THEN 1
                        ELSE 0
                    END
                ) OVER (ORDER BY sort_ts ASC) AS segment_id
            FROM base
        ),
        trajectory_data AS (
            SELECT
                *,
                LAG(geom, 1, geom) OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) AS previous_geom,
                ROW_NUMBER() OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) as row_num
            FROM segmented
        )
        SELECT
            id,
            status,
            filename,
            thumbnail_url,
            s3_key,
            sort_ts,
            segment_id,
            drone_model_name,
            exif_drone_model_name,
            altitude_m,
            yaw_deg,
            row_num,
            image_location_json,
            CASE
                WHEN row_num = 1 THEN NULL
                ELSE mod(
                    (degrees(ST_Azimuth(previous_geom::geometry, geom::geometry)) + 360.0)::numeric,
                    360::numeric
                )::double precision
            END AS azimuth,
            CASE
                WHEN row_num = 1 THEN NULL
                ELSE ST_Distance(previous_geom::geography, geom::geography)
            END AS distance_moved
        FROM trajectory_data
        ORDER BY sort_ts ASC;
    """
    # Setting all tracking variables
    all_potential_gaps = []
    flight_drone_type = drone_type_override
    all_side_overlap_medians = []
    all_altitudes = []

    # Fetch project images
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        project_image_results = await cur.fetchall()

    log.info(
        f"Image gap detection for task {task_id}: "
        f"Found {len(project_image_results)} assigned images with valid GPS"
    )

    # Fetch the task aoi
    task_outline_query = """
                    SELECT
                        ST_AsGeoJSON(outline)::json as geometry
                    FROM tasks
                    WHERE id = %(task_id)s
                """
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(task_outline_query, {"task_id": task_id})
        task_row = await cur.fetchone()

    if task_row and task_row["geometry"]:
        task_aoi_outline = shape(task_row["geometry"])

    # Getting drone type
    db_drone_model = None
    for row in project_image_results:
        db_drone_model = row.get("drone_model_name") or row.get("exif_drone_model_name")
        if db_drone_model is not None:
            break

    if db_drone_model and flight_drone_type is None:
        flight_drone_type = _coerce_drone_type(db_drone_model)
        if flight_drone_type is None:
            log.error(f"Could not find drone type {db_drone_model}")
    elif not db_drone_model and flight_drone_type is None:
        log.error("No drone model found in image metadata")

    MIN_DISTANCE_METERS = 5.0
    LEG_SAMPLE_COUNT = 3  # Ensures enough into the trajectory to compare azimuths'
    # Minimum missing imagery to create a suggested flightplan
    MIN_GAP_IMAGES = 3
    GAP_EXCEED_BASELINE = 1.5  # Threshold when to detect a missing 'gap'
    MIN_SEGMENT_SIZE = 20
    SPARSE_SEGMENT_MAX_IMAGES = 5
    # Fallback values
    MINIMUM_ALTITUDE = 60

    # Manual gaps overrides analysis calculations and skips to reconstruction
    if manual_gaps:
        all_potential_gaps = manual_gaps

    else:
        # Group by segment
        segments_map: dict[int, list[dict]] = {}
        for row in project_image_results:
            seg_id = int(row.get("segment_id") or 0)
            segments_map.setdefault(seg_id, []).append(row)
        segments = list(segments_map.values())

        log.info(
            f"Image gap detection for task {task_id}: "
            f"Split into {len(segments)} time-contiguous segments"
        )

        # Iterate through each flight segment
        for idx, segment in enumerate(segments):
            log.debug(
                f"Segment {idx}: {len(segment)} images, "
                f"time range: {segment[0]['sort_ts']} to {segment[-1]['sort_ts']}"
            )
            segment_length = len(segment)

            # Skip small segments entirely
            if segment_length < MIN_SEGMENT_SIZE:
                log.debug(
                    f"Skipping image gap detection for segment with {segment_length} images "
                    f"(minimum required: {MIN_SEGMENT_SIZE})"
                )
                continue

            # Add altitudes into all_atltidues list
            for images in segment:
                if images["altitude_m"] is not None:
                    all_altitudes.append(images["altitude_m"])
                else:
                    log.error("No altitiude_m found for image")

            # Determine the legs in each segment's drone trajectory
            leg_count = 0  # Current leg
            leg_index_list = []  # List of indices belonging to the current leg

            leg_average_baseline = None

            sample_legs_azimuth = []  # Beginning images used to calculate initial mean
            sample_legs_indices = []  # Tracking those specific indices
            for i in range(len(segment)):
                if i == 0:
                    continue
                if segment[i]["distance_moved"] < MIN_DISTANCE_METERS:
                    continue
                if segment[i]["azimuth"] is None:
                    continue

                # No baseline has been established
                if leg_average_baseline is None:
                    sample_legs_azimuth.append(segment[i]["azimuth"])
                    sample_legs_indices.append(i)

                    if len(sample_legs_azimuth) >= LEG_SAMPLE_COUNT:
                        leg_average_baseline = circular_mean_list(sample_legs_azimuth)
                        leg_index_list.extend(sample_legs_indices)

                        # Clear count
                        sample_legs_azimuth = []
                        sample_legs_indices = []

                # Baseline has been established to check for deviations
                else:
                    current_image_azimuth = segment[i]["azimuth"]
                    azimuth_difference = calculate_angular_difference(
                        leg_average_baseline, current_image_azimuth
                    )

                    if azimuth_difference < 45:
                        # Still in baseline trajectory
                        leg_index_list.append(i)

                        leg_average_baseline = circular_mean_pair(
                            leg_average_baseline, current_image_azimuth
                        )

                    elif azimuth_difference > 45:
                        # Turn detected
                        leg_count += 1

                        for leg_index in leg_index_list:
                            segment[leg_index]["leg_id"] = leg_count

                        # Clear for next leg
                        leg_average_baseline = None
                        leg_index_list = []
                        sample_legs_azimuth = []
                        sample_legs_indices = []

            # Ensuring last leg has a 'leg_id' if no turn happens at the end of the flight
            if len(leg_index_list) >= LEG_SAMPLE_COUNT:
                leg_count += 1
                for leg_index in leg_index_list:
                    segment[leg_index]["leg_id"] = leg_count

            # Group by leg_id
            legs_map: dict[int, list[dict]] = {}
            for images in segment:
                if images.get("leg_id") is None:
                    continue
                else:
                    image_leg_id = int(images.get("leg_id") or 0)
                    legs_map.setdefault(image_leg_id, []).append(images)
            segment_legs = list(legs_map.values())

            # Establishing side overlap median baseline for all legs
            segment_side_overlap_median = None
            side_dist_moved_legs_list = []
            for i in range(1, len(segment_legs)):
                side_leg_distance, _, _ = _calculate_side_overlap_distance(
                    segment_legs[i], segment_legs[i - 1]
                )
                side_dist_moved_legs_list.append(side_leg_distance)

            if side_dist_moved_legs_list:
                segment_side_overlap_median = np.median(side_dist_moved_legs_list)
                all_side_overlap_medians.append(segment_side_overlap_median)

            elif flight_drone_type:
                # If only one leg exists then there isn't sufficient data for a side overlap to be found
                # Calculate what the spacing SHOULD look like based on the drone's FOV
                # at its current altitude, assuming a standard 70% side overlap.
                specs = DRONE_PARAMS[flight_drone_type]
                avg_alt = np.median(
                    [
                        images["altitude_m"]
                        for images in segment
                        if images.get("altitude_m")
                    ]
                )
                horizontal_footprint = avg_alt * specs["HORIZONTAL_FOV"]

                segment_side_overlap_median = horizontal_footprint * 0.30
            else:
                log.warning(
                    "Unable to estimate side overlap baseline without a drone type."
                )

            log.debug(
                f"Segment side overlap median for all legs: {segment_side_overlap_median}"
            )

            previous_leg = None
            for idx, leg in enumerate(segment_legs):
                # Calculate valid values for this specific leg
                front_overlap_leg_median = None
                front_dist_moved_leg_list = []
                leg_alt_list = []
                leg_azi_list = []
                for i in range(len(leg)):
                    # FRONT OVERLAP PER LEG
                    if i == 0:
                        continue
                    if leg[i]["distance_moved"] < MIN_DISTANCE_METERS:
                        continue
                    front_dist_moved_leg_list.append(leg[i]["distance_moved"])

                    # Tracking altitude
                    if leg[i].get("altitude_m") is not None:
                        leg_alt_list.append(leg[i]["altitude_m"])

                    # Tracking azimuth
                    if leg[i].get("azimuth") is not None:
                        leg_azi_list.append(leg[i]["azimuth"])

                front_overlap_leg_median = np.median(front_dist_moved_leg_list)
                leg_median_altitude = np.median(leg_alt_list)
                leg_azimuth = circular_mean_list(leg_azi_list)

                log.debug(
                    f"Leg {idx} Dist Median={front_overlap_leg_median}, Alt Median={leg_median_altitude}"
                )

                # Look for any potential gaps in current leg that exceed the median baseline
                for i in range(1, len(leg)):
                    current_image = leg[i]
                    previous_image = leg[i - 1]

                    if current_image["distance_moved"] > (
                        front_overlap_leg_median * GAP_EXCEED_BASELINE
                    ):
                        all_potential_gaps.append(
                            {
                                "type": "front_overlap_gap",
                                "leg_id": idx,
                                "start_loc": previous_image["image_location_json"],
                                "end_loc": current_image["image_location_json"],
                                "dist": current_image["distance_moved"],
                                "azimuth": leg_azimuth,
                                "altitude": leg_median_altitude,
                                "expected": front_overlap_leg_median,
                            }
                        )

                if previous_leg is not None and segment_side_overlap_median:
                    # SIDE OVERLAP COMPARING PREVIOUS AND CURRENT LEG
                    side_overlap_dist, start_loc, end_loc = (
                        _calculate_side_overlap_distance(previous_leg, leg)
                    )

                    # Look for any potential gaps in previous and current leg that exceed the median baseline
                    if side_overlap_dist > (
                        segment_side_overlap_median * GAP_EXCEED_BASELINE
                    ):
                        all_potential_gaps.append(
                            {
                                "type": "side_overlap_gap",
                                "current_leg_id": idx,
                                "start_loc": start_loc,
                                "end_loc": end_loc,
                                "dist": side_overlap_dist,
                                "azimuth": leg_azimuth,
                                "altitude": leg_median_altitude,
                                "expected": segment_side_overlap_median,
                            }
                        )

                previous_leg = leg

    # Overall average altitude
    # Set to default first then override if values found
    overall_average_altitude = MINIMUM_ALTITUDE

    if len(all_altitudes) > 0:
        overall_average_altitude = np.mean(all_altitudes)
    else:
        log.error("Altitude values not found.")

    # Calculating theoretical spacing overall (70%) for side overlap median then overriding if values exist
    global_side_overlap_median = None

    if flight_drone_type:
        specs = DRONE_PARAMS[flight_drone_type]
        horizontal_footprint = 2 * overall_average_altitude * specs["HORIZONTAL_FOV"]
        global_side_overlap_median = horizontal_footprint * 0.30

    if len(all_side_overlap_medians) > 0:
        global_side_overlap_median = np.median(all_side_overlap_medians)
    elif flight_drone_type is None:
        log.error("No drone type found and no side overlap medians available.")

    gap_geometry = None

    # Process for confirming gaps and triggering reconstruction of flightplan
    # Getting all image points for UI
    image_features = [
        {
            "type": "Feature",
            "geometry": row["image_location_json"],
            "properties": {
                "id": str(row["id"]),
                "filename": str(row["filename"]),
                "status": str(row["status"]),
                "thumbnail_url": maybe_presign_s3_key(
                    row["thumbnail_url"], expires_hours=1
                )
                if row.get("thumbnail_url")
                else None,
                "url": maybe_presign_s3_key(row["s3_key"], expires_hours=1)
                if row.get("s3_key")
                else None,
            },
        }
        for row in project_image_results
    ]

    images_geojson = {"type": "FeatureCollection", "features": image_features}

    if (
        not manual_gaps
        and flight_drone_type
        and 0 < len(project_image_results) <= SPARSE_SEGMENT_MAX_IMAGES
    ):
        sparse_gap_geometry = _detect_sparse_coverage_gap(
            task_aoi_outline,
            project_image_results,
            flight_drone_type,
            overall_average_altitude,
        )
        if sparse_gap_geometry is not None:
            sparse_yaws = [
                row["yaw_deg"]
                for row in project_image_results
                if row.get("yaw_deg") is not None
            ]
            sparse_rotation = circular_mean_list(sparse_yaws) if sparse_yaws else None
            result = _generate_flightplan_for_geometry(
                sparse_gap_geometry,
                drone_type=flight_drone_type,
                average_altitude=overall_average_altitude,
                rotation_angle=sparse_rotation,
            )

            if result:
                return {
                    "message": "Successfully identified sparse-coverage gaps.",
                    "task_geometry": _geometry_to_feature(task_aoi_outline),
                    "gap_polygons": _geometry_to_feature_collection(result["geometry"]),
                    "drone_type": flight_drone_type,
                    "kmz_bytes": result["kmz_bytes"],
                    "images": images_geojson,
                }

            return {
                "message": "Gaps identified, but no flightplan was generated.",
                "task_id": str(task_id),
                "task_geometry": _geometry_to_feature(task_aoi_outline),
                "gap_polygons": _geometry_to_feature_collection(sparse_gap_geometry),
                "drone_type": flight_drone_type,
                "kmz_bytes": None,
                "images": images_geojson,
            }

    if len(all_potential_gaps) > MIN_GAP_IMAGES:
        # Filter potential gaps to find those that intersect with task AOI
        confirmed_gaps = _validate_gaps_in_task_aoi(
            task_aoi_outline, all_potential_gaps
        )

        approximate_horizontal_footprint = None
        if global_side_overlap_median:
            approximate_horizontal_footprint = global_side_overlap_median / 0.30
        elif confirmed_gaps:
            expected_gap_sizes = [
                gap["expected"] for gap in confirmed_gaps if gap.get("expected")
            ]
            if expected_gap_sizes:
                approximate_horizontal_footprint = (
                    float(np.median(expected_gap_sizes)) / 0.30
                )

        if approximate_horizontal_footprint:
            gap_geometry = _build_gap_geometry(
                confirmed_gaps,
                task_aoi_outline,
                approximate_horizontal_footprint,
            )

        if confirmed_gaps and flight_drone_type:
            log.info(
                f"Task {task_id}: {len(confirmed_gaps)} gaps confirmed. Generating reconstruction plan."
            )

            result = _generate_reconstruction_flightplan(
                confirmed_gaps,
                task_aoi_outline,
                global_side_overlap_median,
                flight_drone_type,
                overall_average_altitude,
            )

            if result:
                gap_geometry = result["geometry"]
                return {
                    "message": f"Successfully identified {len(confirmed_gaps)} gaps.",
                    "task_geometry": _geometry_to_feature(task_aoi_outline),
                    "gap_polygons": _geometry_to_feature_collection(gap_geometry),
                    "drone_type": flight_drone_type,
                    "kmz_bytes": result["kmz_bytes"],
                    "images": images_geojson,
                }

        if confirmed_gaps and not flight_drone_type:
            return {
                "message": "Select a drone model to generate a reflight plan.",
                "task_id": str(task_id),
                "task_geometry": _geometry_to_feature(task_aoi_outline),
                "gap_polygons": _geometry_to_feature_collection(gap_geometry),
                "drone_type": None,
                "kmz_bytes": None,
                "images": images_geojson,
            }

    if not flight_drone_type:
        message = "Missing drone metadata"
    else:
        message = "No gaps detected"

    log.info(f"Task {task_id}: No gaps identified for task.")

    return {
        "message": f"{message}",
        "task_id": str(task_id),
        "task_geometry": _geometry_to_feature(task_aoi_outline),
        "gap_polygons": {"type": "FeatureCollection", "features": []},
        "drone_type": flight_drone_type,
        "kmz_bytes": None,
        "images": images_geojson,
    }
