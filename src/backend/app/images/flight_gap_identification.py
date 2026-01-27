import math
import numpy as np
import pyproj

from uuid import UUID
from shapely.geometry import Point, Polygon, LineString, MultiPolygon, shape, mapping

from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row

from app.models.enums import ImageStatus
from app.utils import calculate_angular_difference, circular_mean_pair, circular_mean_list

from drone_flightplan import create_flightplan
from drone_flightplan.drone_type import DRONE_PARAMS, DroneType
from drone_flightplan.enums import FlightMode


projector = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

def point_to_meters(location: dict) -> Point:
    """
    Converts GeoJSON [Lon, Lat] to EPSG:3857 (Web Mercator) meters.

    Args:
        location (dict): GeoJSON point dictionary (e.g., {'coordinates': [lon, lat]})
        
    Returns:
        Point: A Shapely Point object in meters, or None if input is invalid.
    """
    if not location or 'coordinates' not in location:
        return None
    
    coordinates = location['coordinates']
    if len(coordinates) < 2:
        return None
        
    lon, lat = coordinates[0], coordinates[1]

    x, y = projector.transform(lon, lat)

    return Point(x, y)


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
    min_distance = float('inf')
    nearest_neighbor_loc = None

    # Identify shortest and longest legs
    if len(previous_leg) < len(current_leg):
        shortest_leg, longer_leg = previous_leg, current_leg
    else: 
        shortest_leg, longer_leg = current_leg, previous_leg
    
    # Establish the reference point (midpoint of the short leg)
    reference_point_idx = (len(shortest_leg) // 2)
    reference_loc = shortest_leg[reference_point_idx]['location']
    reference_point_m = point_to_meters(reference_loc)

    for image in longer_leg: 
        current_point_m = point_to_meters(image['location'])
        
        distance = reference_point_m.distance(current_point_m)

        if distance < min_distance: 
            min_distance = distance
            nearest_neighbor_loc = image['location']
    
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
        potential_gap_line = LineString([
            potential_gap['start_loc']['coordinates'],
            potential_gap['end_loc']['coordinates']
        ])

        if potential_gap_line.intersects(task_aoi_outline):
            confirmed_gaps.append(potential_gap)
    
    return confirmed_gaps


def _generate_reconstruction_flightplan(
        confirmed_gaps: list[dict], 
        task_aoi: Polygon,
        global_side_median: float,
        drone_type: DroneType, 
    ):
    """
    Generates a kmz flight plan to cover detected missing imagery gaps.

    Args:
        confirmed_gaps (list[dict]): Validated gaps within the AOI.
        task_aoi (Polygon): The task AOI.
        global_side_median (float): The measured side-lap distance (in meters).
        drone_type (DroneType): The drone model to optimize parameters for.
    """
    specs = DRONE_PARAMS[drone_type]

    avg_alt = np.mean([gap['altitude'] for gap in confirmed_gaps])
    avg_azi = np.mean([gap['azimuth'] for gap in confirmed_gaps])

    log.info(f"Reconstructing for {drone_type.value}: Alt={avg_alt}m, Azimuth={avg_azi}deg")

    vertical_footprint = 2 * avg_alt * math.tan(specs["VERTICAL_FOV"] / 2)
    horizontal_footprint = 2 * avg_alt * math.tan(specs["HORIZONTAL_FOV"] / 2)

    front_overlap = 100 * (1 - (confirmed_gaps[0]['expected'] / vertical_footprint))
    side_overlap = 100 * (1 - (global_side_median / horizontal_footprint))

    gap_polygons = []
    for gap in confirmed_gaps:
        line = LineString([gap['start_loc']['coordinates'], gap['end_loc']['coordinates']])
        gap_polygons.append(line.buffer((horizontal_footprint / 2) / 111320)) 
    
    reconstruction_aoi = MultiPolygon(gap_polygons).intersection(task_aoi)

    if reconstruction_aoi.is_empty:
        log.warning("Reconstruction AOI is empty after intersection with Task AOI.")
        return None

    total_gaps = sum([(gap['dist'] / gap['expected']) for gap in confirmed_gaps])
    mode = FlightMode.WAYPOINTS if total_gaps < 100 else FlightMode.WAYLINES

    log.info(f"Generating reconstruction flightplan for area: {reconstruction_aoi.area} sq deg")

    return create_flightplan(
        aoi=mapping(reconstruction_aoi),
        forward_overlap=max(50, min(90, front_overlap)),
        side_overlap=max(50, min(90, side_overlap)),
        agl=avg_alt,
        flight_mode=mode,
        drone_type=drone_type,
        rotation_angle=avg_azi
    )


async def identify_flight_gaps(
        db: Connection, 
        project_id: UUID, 
        batch_id: UUID, 
        task_id: UUID
    ):

    params = {"project_id": project_id,
        "batch_id": batch_id,
        "task_id": task_id,
        "status": ImageStatus.ASSIGNED.value,
    }

    sql = """
        WITH ordered AS (
            SELECT 
                i.id,
                i.location,
                d.model AS drone_model_name,
            COALESCE(to_timestamp(i.exif->>'DateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')::timestamptz,
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
                AND i.batch_id = %(batch_id)s
                AND i.status = %(status)s
                AND i.rejection_reason IS NULL
                AND i.location IS NOT NULL
        ),
        base AS (
            SELECT
                *,
                LAG(sort_ts, 1, sort_ts) OVER (ORDER BY sort_ts ASC) AS prev_sort_ts,
                LAG(location, 1, location) OVER (ORDER BY sort_ts ASC) AS prev_location
            FROM ordered
        ),
        segmented AS (
            SELECT
                *,
                SUM(
                    CASE
                        WHEN EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)) > 600 THEN 1
                        WHEN ST_Distance(prev_location::geography, location::geography) > 1000 THEN 1
                        WHEN GREATEST(EXTRACT(EPOCH FROM (sort_ts - prev_sort_ts)), 0) > 0
                             AND (ST_Distance(prev_location::geography, location::geography) /
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
                LAG(location, 1, location) OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) AS previous_location,
                LAG(altitude_m, 1, altitude_m) OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) AS previous_altitude_m,
                location,
                ROW_NUMBER() OVER (PARTITION BY segment_id ORDER BY sort_ts ASC) as row_num
            FROM segmented
        ),
        SELECT
            id,
            sort_ts,
            segment_id,
            drone_model_name,
            altitude_m,
            yaw_deg,
            row_num,
            CASE
                WHEN row_num = 1 THEN NULL
                ELSE mod(
                    (degrees(ST_Azimuth(previous_location::geometry, location::geometry)) + 360.0)::numeric,
                    360::numeric
                )::double precision
            END AS azimuth,
            CASE
                WHEN row_num = 1 THEN NULL
                ELSE ST_Distance(previous_location::geography, location::geography)
            END AS distance_moved,
            yaw_deg,
            altitude_m
        FROM trajectory_data
        ORDER BY sort_ts ASC;
    """

    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        project_image_results = await cur.fetchall()
    
    log.info(
        f"Image gap detection for task {task_id}: "
        f"Found {len(project_image_results)} assigned images with valid GPS"
    )

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

    MIN_DISTANCE_METERS = 5.0
    LEG_SAMPLE_COUNT = 3 # Ensures enough into the trajectory to compare azimuths'
    # Minimum missing imagery to create a suggested flightplan
    MIN_GAP_IMAGES = 3
    GAP_EXCEED_BASELINE = 1.5  # Threshold when to detect a missing 'gap'
    MIN_SEGMENT_SIZE = 20 

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

        # Recording drone model for each segment
        db_drone_model = segment[0].get("drone_model_name")
            
        # Determine the legs in each segment's drone trajectory
        leg_count = 0 # Curent leg
        leg_index_list = [] # List of indices belonging to the current leg 

        leg_average_baseline = None
        
        sample_legs_azimuth = [] # Beginning images used to calculate initial mean 
        sample_legs_indices = [] # Tracking those specific indices
        for i in range(len(segment)): 
            if i == 0:
                continue
            if segment[i]['distance_moved'] < MIN_DISTANCE_METERS:
                continue
            if segment[i]['azimuth'] is None:
                continue

            # No baseline has been established
            if leg_average_baseline is None:
                sample_legs_azimuth.append(segment[i]['azimuth'])
                sample_legs_indices.append(i)

                if len(sample_legs_azimuth) >= LEG_SAMPLE_COUNT:
                    leg_average_baseline = circular_mean_list(sample_legs_azimuth)
                    leg_index_list.extend(sample_legs_indices)

                    # Clear count 
                    sample_legs_azimuth = []
                    sample_legs_indices = []

            # Baseline has been established to check for deviations
            else:
                current_image_azimuth = segment[i]['azimuth']
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
                        segment[leg_index]['leg_id'] = leg_count
                    
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

        potential_missing_images = [] # Tracking any suspected gaps for the whole segment

        # Establishing side overlap median baseline for all legs
        global_side_overlap_median = None
        side_dist_moved_legs_list = []
        for i in range(1, len(segment_legs)):
            side_leg_distance, _, _ = _calculate_side_overlap_distance(segment_legs[i], segment_legs[i - 1])
            side_dist_moved_legs_list.append(side_leg_distance)

        if side_dist_moved_legs_list:
            global_side_overlap_median = np.median(side_dist_moved_legs_list)
        else: 
            # If only one leg exists then there isn't sufficient data for a side overlap to be found
            # Calculate what the spacing SHOULD look like based on the drone's FOV
            # at its current altitude, assuming a standard 70% side overlap.
            specs = DRONE_PARAMS[db_drone_model]
            avg_alt = np.median([images['altitude_m'] for images in segment if images.get('altitude_m')])
            horizontal_footprint = 2 * avg_alt * math.tan(specs["HORIZONTAL_FOV"] / 2)

            global_side_overlap_median = horizontal_footprint * 0.30

        log.debug(f"Global side overlap median for all legs: {global_side_overlap_median}")

        previous_leg = None
        for idx, leg in enumerate(segment_legs):
            # Caclulate valid values for this specific leg 
            front_overlap_leg_median = None
            front_dist_moved_leg_list = []
            leg_alt_list = []
            leg_azi_list = []
            for i in range(len(leg)):
            # FRONT OVERLAP PER LEG
                if i == 0:
                    continue
                if leg[i]['distance_moved'] < MIN_DISTANCE_METERS:
                    continue
                front_dist_moved_leg_list.append(leg[i]['distance_moved'])

                # Tracking altitude
                if leg[i].get('altitude_m') is not None:
                    leg_alt_list.append(leg[i]['altitude_m'])
                
                # Tracking azimuth
                if leg[i].get('azimuth') is not None:
                    leg_azi_list.append(leg[i]['azimuth'])

            front_overlap_leg_median = np.median(front_dist_moved_leg_list)
            leg_median_altitude = np.median(leg_alt_list)
            leg_azimuth = circular_mean_list(leg_azi_list)

            log.debug(f"Leg {idx} Dist Median={front_overlap_leg_median}, Alt Median={leg_median_altitude}")
    
            # Look for any potential gaps in current leg that exceed the median baseline
            for i in range(1, len(leg)):
                current_image = leg[i]
                previous_image = leg[i - 1]

                if current_image['distance_moved'] > (front_overlap_leg_median * GAP_EXCEED_BASELINE):
                    potential_missing_images.append({
                        "type": "front_overlap_gap",
                        "leg_id": idx,
                        "start_loc": previous_image["location"],
                        "end_loc": current_image["location"],
                        "dist": current_image["distance_moved"],
                        "azimuth": leg_azimuth,
                        "altitude": leg_median_altitude,
                        "expected": front_overlap_leg_median
                    })
            
            if previous_leg is not None and global_side_overlap_median:
                # SIDE OVERLAP COMPARING PREVIOUS AND CURRENT LEG
                 side_overlap_dist, start_loc, end_loc = _calculate_side_overlap_distance(previous_leg, leg)

                # Look for any potential gaps in previous and current leg that exceed the median baseline
                 if side_overlap_dist > (global_side_overlap_median * GAP_EXCEED_BASELINE):
                     potential_missing_images.append({
                        "type": "side_overlap_gap",
                        "current_leg_id": idx,
                        "start_loc": start_loc,
                        "end_loc": end_loc,
                        "dist": side_overlap_dist,
                        "azimuth": leg_azimuth,
                        "altitude": leg_median_altitude,
                        "expected": global_side_overlap_median
                    })

            previous_leg = leg

        # Process for confirming gaps and triggering reconstruction of flightplan
        if len(potential_missing_images) > MIN_GAP_IMAGES:
            # Fetch the task aoi from the database
            task_outline_query =  """
                            SELECT
                                ST_AsGeoJSON(outline)::json as geometry
                            FROM tasks 
                            WHERE id = %(task_id)s
                        """
            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(task_outline_query, {"task_id": task_id})
                task_row = await cur.fetchone()
            
            if task_row['geometry']:
                task_aoi_outline = shape(task_row['geometry'])
                
                # Filter potential gaps to find those that intersect with task AOI
                confirmed_gaps = _validate_gaps_in_task_aoi(task_aoi_outline, potential_missing_images)

                if confirmed_gaps: 
                    log.info(f"Task {task_id}: {len(confirmed_gaps)} gaps confirmed. Generating reconstruction plan.")

                    _generate_reconstruction_flightplan(
                        confirmed_gaps, 
                        task_aoi_outline,
                        global_side_overlap_median,
                        db_drone_model
                    )
