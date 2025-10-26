import json
import os
import shutil
import uuid
from io import BytesIO
from typing import Any, Dict

import geojson
import pyproj
import shapely.wkb as wkblib
from drone_flightplan import (
    add_elevation_from_dem,
    calculate_parameters,
    create_placemarks,
    terrain_following_waylines,
    create_waypoint,
)
from fastapi import BackgroundTasks, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from botocore.exceptions import ClientError
from geojson import Feature, FeatureCollection
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from shapely.geometry import shape
from shapely.ops import transform

from app.config import settings
from app.models.enums import FlightMode, ImageProcessingStatus, OAMUploadStatus
from app.projects import project_schemas
from app.projects.image_processing import DroneImageProcessor
from app.s3 import (
    add_obj_to_bucket,
    get_file_from_bucket,
    get_object_metadata,
    get_presigned_url,
    list_objects_from_bucket,
)
from app.tasks.task_splitter import split_by_square
from app.utils import (
    calculate_flight_time_from_placemarks,
    merge_multipolygon,
)


async def get_centroids(db: Connection):
    try:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                    p.id,
                    p.slug,
                    p.name,
                    ST_AsGeoJSON(p.centroid)::jsonb AS centroid,
                    COUNT(t.id) AS total_task_count,
                    COUNT(CASE WHEN te.state IN ('LOCKED_FOR_MAPPING', 'REQUEST_FOR_MAPPING', 'IMAGE_UPLOADED', 'UNFLYABLE_TASK', 'IMAGE_PROCESSING_STARTED') THEN 1 END) AS ongoing_task_count,
                    COUNT(CASE WHEN te.state = 'IMAGE_PROCESSING_FINISHED' THEN 1 END) AS completed_task_count
                FROM
                    projects p
                LEFT JOIN
                    tasks t ON p.id = t.project_id
                LEFT JOIN
                    task_events te ON t.id = te.task_id
                GROUP BY
                    p.id, p.slug, p.name, p.centroid;
            """
            )
            centroids = await cur.fetchall()

            if not centroids:
                return []

            return centroids

    except Exception as e:
        log.error(f"Error during reading centroids: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def upload_file_to_s3(
    project_id: uuid.UUID, file: UploadFile, file_name: str
) -> str:
    """Upload a file (image or DEM) to S3.

    Args:
        project_id (uuid.UUID): The project ID in the database.
        file (UploadFile): The file to be uploaded.
        folder (str): The folder name in the S3 bucket.
        file_extension (str): The file extension (e.g., 'png', 'tif').

    Returns:
        str: The S3 URL for the uploaded file.
    """
    # Define the S3 file path
    file_path = f"dtm-data/projects/{project_id}/{file_name}"

    # Read the file bytes
    file_bytes = await file.read()
    file_obj = BytesIO(file_bytes)

    # Upload the file to the S3 bucket
    add_obj_to_bucket(
        settings.S3_BUCKET_NAME,
        file_obj,
        file_path,
        file.content_type,
    )

    # Construct the S3 URL for the file
    file_url = f"{settings.S3_DOWNLOAD_ROOT}/{settings.S3_BUCKET_NAME}{file_path}"

    return file_url


async def update_project_oam_status(
    db: Connection, project_id: uuid.UUID, status: OAMUploadStatus
):
    """Update the OAM status for a project."""
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET oam_upload_status = %s
            WHERE id = %s
            """,
            (status.name, project_id),
        )
    await db.commit()
    return True


async def update_url(db: Connection, project_id: uuid.UUID, url: str):
    """Update the URL (DEM or image) for a project in the database.

    Args:
        db (Connection): The database connection.
        project_id (uuid.UUID): The project ID in the database.
        url (str): The URL to be updated.
        url_type (str): The column name for the URL (e.g., 'dem_url', 'image_url').

    Returns:
        bool: True if the update was successful.
    """
    async with db.cursor() as cur:
        await cur.execute(
            """
            UPDATE projects
            SET dem_url = %(url)s
            WHERE id = %(project_id)s""",
            {"url": url, "project_id": project_id},
        )

    return True


async def update_task_metrics(db, task_updates):
    """Update task metrics asynchronously."""
    async with db.cursor() as cur:
        await cur.executemany(
            """
            UPDATE tasks
            SET total_area_sqkm = %s, flight_time_minutes = %s, flight_distance_km = %s
            WHERE id = %s
            """,
            task_updates,
        )
        log.debug(f"Updated {len(task_updates)} tasks with flight metrics")


async def process_task_metrics(db, tasks_data, project):
    """Process flight metrics and update tasks."""
    task_updates = []
    for task in tasks_data:
        task_id, project_id, outline, index = task[:4]
        geom = shape(wkblib.loads(outline))

        proj_wgs84 = pyproj.CRS("EPSG:4326")
        proj_mercator = pyproj.CRS("EPSG:3857")
        project_transformer = pyproj.Transformer.from_crs(
            proj_wgs84, proj_mercator, always_xy=True
        )
        transformed_geom = transform(project_transformer.transform, geom)
        total_area_sqkm = transformed_geom.area / 1_000_000

        forward_overlap = project.front_overlap or 70
        side_overlap = project.side_overlap or 70
        gsd = project.gsd_cm_px
        altitude = project.altitude_from_ground

        parameters = calculate_parameters(
            forward_overlap, side_overlap, altitude, gsd, 2
        )
        waypoint_params = {
            "project_area": FeatureCollection([Feature(geometry=geom)]),
            "agl": altitude,
            "gsd": gsd,
            "forward_overlap": forward_overlap,
            "side_overlap": side_overlap,
            "rotation_angle": 0,
            "generate_3d": False,
            "mode": FlightMode.waypoints,
        }

        if project.is_terrain_follow:
            dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"
            points = create_waypoint(**waypoint_params)
            try:
                get_file_from_bucket(
                    settings.S3_BUCKET_NAME,
                    f"dtm-data/projects/{project.id}/dem.tif",
                    dem_path,
                )
                outfile_with_elevation = "/tmp/output_file_with_elevation.geojson"
                add_elevation_from_dem(dem_path, points, outfile_with_elevation)
                with open(outfile_with_elevation, "r") as inpointsfile:
                    points_with_elevation = inpointsfile.read()
            except Exception:
                points_with_elevation = points

            placemarks = create_placemarks(
                geojson.loads(points_with_elevation), parameters
            )
        else:
            points = create_waypoint(**waypoint_params)
            placemarks = create_placemarks(geojson.loads(points), parameters)

        flight_metrics = calculate_flight_time_from_placemarks(placemarks)
        flight_time_minutes = flight_metrics.get("total_flight_time")
        flight_distance_km = flight_metrics.get("flight_distance_km")

        task_updates.append(
            (total_area_sqkm, flight_time_minutes, flight_distance_km, task_id)
        )

    if task_updates:
        await update_task_metrics(db, task_updates)


async def create_tasks_from_geojson(
    db,
    project_id: uuid.UUID,
    boundaries: Any,
    project,
    background_tasks: BackgroundTasks,
):
    """Create tasks and update metrics asynchronously."""
    try:
        if isinstance(boundaries, str):
            boundaries = json.loads(boundaries)
        polygons = (
            [boundaries] if boundaries["type"] == "Feature" else boundaries["features"]
        )
        log.debug(f"Processing {len(polygons)} task geometries")

        tasks_data = []
        for index, polygon in enumerate(polygons):
            if not polygon.get("geometry"):
                continue

            geom = shape(polygon["geometry"])
            task_id = str(uuid.uuid4())
            tasks_data.append(
                (task_id, project_id, wkblib.dumps(geom, hex=True), index + 1)
            )

        if tasks_data:
            async with db.cursor() as cur:
                await cur.executemany(
                    """
                    INSERT INTO tasks (id, project_id, outline, project_task_index)
                    VALUES (%s, %s, %s, %s)
                    """,
                    tasks_data,
                )
                log.debug(f"Inserted {len(tasks_data)} tasks in bulk")
            background_tasks.add_task(process_task_metrics, db, tasks_data, project)

        return {
            "message": "Task creation started, metrics will be updated in the background"
        }
    except Exception as e:
        log.exception(e)
        raise HTTPException(e) from e


# async def create_tasks_from_geojson(
#     db: Connection,
#     project_id: uuid.UUID,
#     boundaries: Any,
#     project: project_schemas.DbProject,
# ):
#     """Create tasks for a project, from provided task boundaries."""
#     try:
#         if isinstance(boundaries, str):
#             boundaries = json.loads(boundaries)

#         if boundaries["type"] == "Feature":
#             polygons = [boundaries]
#         else:
#             polygons = boundaries["features"]

#         log.debug(f"Processing {len(polygons)} task geometries")

#         # Set up the projection transform for EPSG:3857 (Web Mercator)
#         proj_wgs84 = pyproj.CRS("EPSG:4326")
#         proj_mercator = pyproj.CRS("EPSG:3857")
#         project_transformer = pyproj.Transformer.from_crs(
#             proj_wgs84, proj_mercator, always_xy=True
#         )

#         for index, polygon in enumerate(polygons):
#             forward_overlap = project.front_overlap if project.front_overlap else 70
#             side_overlap = project.side_overlap if project.side_overlap else 70
#             generate_3d = False  # TODO: For 3d imageries drone_flightplan package needs to be updated.

#             gsd = project.gsd_cm_px
#             altitude = project.altitude_from_ground

#             parameters = calculate_parameters(
#                 forward_overlap,
#                 side_overlap,
#                 altitude,
#                 gsd,
#                 2,  # Image Interval is set to 2
#             )

#             # Wrap polygon into GeoJSON Feature
#             if not polygon["geometry"]:
#                 continue
#             # If the polygon is a MultiPolygon, convert it to a Polygon
#             if polygon["geometry"]["type"] == "MultiPolygon":
#                 log.debug("Converting MultiPolygon to Polygon")
#                 polygon["geometry"]["type"] = "Polygon"
#                 polygon["geometry"]["coordinates"] = polygon["geometry"]["coordinates"][
#                     0
#                 ]

#             geom = shape(polygon["geometry"])

#             coordinates = polygon["geometry"]["coordinates"]
#             if polygon["geometry"]["type"] == "Polygon":
#                 coordinates = polygon["geometry"]["coordinates"]
#             feature = Feature(geometry=Polygon(coordinates), properties={})
#             feature_collection = FeatureCollection([feature])

#             # Common parameters for create_waypoint
#             waypoint_params = {
#                 "project_area": feature_collection,
#                 "agl": altitude,
#                 "gsd": gsd,
#                 "forward_overlap": forward_overlap,
#                 "side_overlap": side_overlap,
#                 "rotation_angle": 0,
#                 "generate_3d": generate_3d,
#             }
#             waypoint_params["mode"] = FlightMode.waypoints
#             if project.is_terrain_follow:
#                 dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"

#                 # Terrain follow uses waypoints mode, waylines are generated later
#                 points = create_waypoint(**waypoint_params)

#                 try:
#                     get_file_from_bucket(
#                         settings.S3_BUCKET_NAME,
#                         f"dtm-data/projects/{project.id}/dem.tif",
#                         dem_path,
#                     )
#                     # TODO: Do this with inmemory data
#                     outfile_with_elevation = "/tmp/output_file_with_elevation.geojson"
#                     add_elevation_from_dem(dem_path, points, outfile_with_elevation)

#                     inpointsfile = open(outfile_with_elevation, "r")
#                     points_with_elevation = inpointsfile.read()

#                 except Exception:
#                     points_with_elevation = points

#                 placemarks = create_placemarks(
#                     geojson.loads(points_with_elevation), parameters
#                 )

#             else:
#                 points = create_waypoint(**waypoint_params)
#                 placemarks = create_placemarks(geojson.loads(points), parameters)

#             flight_time_minutes = calculate_flight_time_from_placemarks(placemarks).get(
#                 "total_flight_time"
#             )
#             flight_distance_km = calculate_flight_time_from_placemarks(placemarks).get(
#                 "flight_distance_km"
#             )
#             try:
#                 # Transform the geometry to EPSG:3857 and calculate the area in square meters
#                 transformed_geom = transform(project_transformer.transform, geom)
#                 area_sq_m = transformed_geom.area  # Area in square meters

#                 # Convert area to square kilometers
#                 total_area_sqkm = area_sq_m / 1_000_000

#                 task_id = str(uuid.uuid4())
#                 async with db.cursor() as cur:
#                     await cur.execute(
#                         """
#                         INSERT INTO tasks (id, project_id, outline, project_task_index, total_area_sqkm, flight_time_minutes, flight_distance_km)
#                         VALUES (%(id)s, %(project_id)s, %(outline)s, %(project_task_index)s, %(total_area_sqkm)s, %(flight_time_minutes)s, %(flight_distance_km)s)
#                         RETURNING id;
#                         """,
#                         {
#                             "id": task_id,
#                             "project_id": project_id,
#                             "outline": wkblib.dumps(
#                                 shape(polygon["geometry"]), hex=True
#                             ),
#                             "project_task_index": index + 1,
#                             "total_area_sqkm": total_area_sqkm,
#                             "flight_time_minutes": flight_time_minutes,
#                             "flight_distance_km": flight_distance_km,
#                         },
#                     )
#                     result = await cur.fetchone()

#                     if result:
#                         log.debug(
#                             "Created database task | "
#                             f"Project ID {project_id} | "
#                             f"Task index {index}"
#                         )
#                         log.debug(
#                             "COMPLETE: creating project boundary, based on task boundaries"
#                         )
#             except Exception as e:
#                 log.exception(e)
#                 raise HTTPException(e) from e

#         return True

#     except Exception as e:
#         log.exception(e)
#         raise HTTPException(e) from e


async def preview_split_by_square(boundary: str, meters: int):
    """Preview split by square for a project boundary.

    Use a lambda function to remove the "z" dimension from each
    coordinate in the feature's geometry.
    """
    boundary = merge_multipolygon(boundary)

    return await run_in_threadpool(
        lambda: split_by_square(
            boundary,
            meters=meters,
        )
    )


async def process_drone_images(
    ctx: Dict[Any, Any],
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: str,
) -> Dict[str, Any]:
    """Process drone images using ODM"""
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting process_drone_images (Job ID: {job_id})")

    try:
        pool = ctx["db_pool"]
        async with pool.connection() as conn:
            # Initialize the processor with the database connection
            processor = DroneImageProcessor(
                node_odm_url=settings.NODE_ODM_URL,
                project_id=project_id,
                task_id=task_id,
                user_id=user_id,
                db=conn,
                task_ids=None,
            )

            # Define processing options
            options = [
                {"name": "dsm", "value": True},
                {"name": "orthophoto-resolution", "value": 5},
            ]

            webhook_url = f"{settings.BACKEND_URL}/api/projects/odm/webhook/{user_id}/{project_id}/{task_id}/"

            result = await processor.process_images_from_s3(
                settings.S3_BUCKET_NAME,
                name=f"DTM-Task-{task_id}",
                options=options,
                webhook=webhook_url,
            )

            return {
                "job_id": job_id,
                "project_id": str(project_id),
                "task_id": str(task_id),
                "status": "processing_started",
                "result": result,
            }

    except Exception as e:
        log.error(f"Error in process_drone_images (Job ID: {job_id}): {str(e)}")
        raise


async def update_processing_status(
    db: Connection, project_id: uuid.UUID, status: ImageProcessingStatus
):
    print("status = ", status.name)
    """
    Update the processing status to the specified status in the database.
    """
    await db.execute(
        """
        UPDATE projects
        SET image_processing_status = %(status)s
        WHERE id = %(project_id)s;
        """,
        {"status": status.name, "project_id": project_id},
    )
    await db.commit()
    return


async def process_all_drone_images(
    ctx: Dict[Any, Any], project_id: uuid.UUID, tasks: list, user_id: str
):
    job_id = ctx.get("job_id", "unknown")
    log.info(f"Starting process_drone_images_for_a_project (Job ID: {job_id})")

    try:
        pool = ctx["db_pool"]
        async with pool.connection() as conn:
            # Initialize the processor
            processor = DroneImageProcessor(
                node_odm_url=settings.NODE_ODM_URL,
                project_id=project_id,
                task_id=None,
                user_id=user_id,
                task_ids=tasks,
                db=conn,
            )

            # Define processing options
            options = [
                {"name": "dsm", "value": True},
                {"name": "orthophoto-resolution", "value": 5},
            ]
            webhook_url = f"{settings.BACKEND_URL}/api/projects/odm/webhook/{user_id}/{project_id}/"
            await processor.process_images_for_all_tasks(
                settings.S3_BUCKET_NAME,
                name_prefix=f"DTM-Task-{project_id}",
                options=options,
                webhook=webhook_url,
            )

            # Update the processing status to 'IMAGE_PROCESSING_STARTED' in the database.
            await update_processing_status(
                conn, project_id, ImageProcessingStatus.PROCESSING
            )
            return

    except Exception as e:
        log.error(f"Error in process_drone_images (Job ID: {job_id}): {str(e)}")
        raise


def get_project_info_from_s3(project_id: uuid.UUID, task_id: uuid.UUID):
    """Helper function to get the number of images and the URL to download the assets."""
    try:
        # Prefix for the images
        images_prefix = f"dtm-data/projects/{project_id}/{task_id}/images/"

        # List and count the images
        objects = list_objects_from_bucket(
            settings.S3_BUCKET_NAME, prefix=images_prefix
        )
        image_extensions = (".jpg", ".jpeg", ".png", ".tif", ".tiff")
        image_count = sum(
            1 for obj in objects if obj.object_name.lower().endswith(image_extensions)
        )

        # Generate a presigned URL for the assets ZIP file
        try:
            # Check if the object exists
            assets_path = f"dtm-data/projects/{project_id}/{task_id}/assets.zip"
            get_object_metadata(settings.S3_BUCKET_NAME, assets_path)

            # If it exists, generate the presigned URL
            presigned_url = get_presigned_url(
                settings.S3_BUCKET_NAME, assets_path, expires=2
            )
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code == '404' or error_code == 'NoSuchKey':
                # The object does not exist
                log.info(
                    f"Assets ZIP file not found for project {project_id}, task {task_id}."
                )
                presigned_url = None
            else:
                # An unexpected error occurred
                log.error(f"An error occurred while accessing assets file: {e}")
                raise HTTPException(status_code=500, detail=str(e))

        return project_schemas.AssetsInfo(
            project_id=str(project_id),
            task_id=str(task_id),
            image_count=image_count,
            assets_url=presigned_url,
        )
    except Exception as e:
        log.exception(f"An error occurred while retrieving assets info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def check_regulator_project(db: Connection, project_id: str, email: str):
    sql = """
    SELECT id FROM projects WHERE
    id = %(project_id)s
    AND %(email)s = ANY(regulator_emails)
    AND regulator_comment IS NULL
    """
    async with db.cursor() as cur:
        await cur.execute(sql, {"project_id": project_id, "email": email})
        project = await cur.fetchone()
        return bool(project)


def generate_square_geojson(center_lat, center_lon, side_length_meters):
    transformer = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    transformer_back = pyproj.Transformer.from_crs(
        "EPSG:3857", "EPSG:4326", always_xy=True
    )

    center_x, center_y = transformer.transform(center_lon, center_lat)
    half_side = side_length_meters / 2

    corners_m = [
        (center_x - half_side, center_y - half_side),
        (center_x + half_side, center_y - half_side),
        (center_x + half_side, center_y + half_side),
        (center_x - half_side, center_y + half_side),
        (center_x - half_side, center_y - half_side),
    ]

    corners_lat_lon = [transformer_back.transform(x, y) for x, y in corners_m]

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [corners_lat_lon]},
            }
        ],
    }
    return geojson


async def get_all_tasks_for_project(project_id, db):
    """Get all unique tasks associated with the project ID
    that are in state IMAGE_UPLOADED.
    """
    async with db.cursor() as cur:
        query = """
        SELECT DISTINCT ON (t.id) t.id
        FROM tasks t
        JOIN task_events te ON t.id = te.task_id
        WHERE t.project_id = %s AND te.state = 'IMAGE_UPLOADED'
        ORDER BY t.id, te.created_at DESC;
        """
        await cur.execute(query, (project_id,))
        results = await cur.fetchall()
        # Convert UUIDs to string
        return [str(result[0]) for result in results]


async def update_task_field(
    db: Connection, project_id: uuid.UUID, task_id: uuid.UUID, column: Any, value: str
):
    """Generic function to update a field(assets_url and total_image_count) in the tasks table."""
    async with db.cursor() as cur:
        await cur.execute(
            f"""
            UPDATE tasks
            SET {column} = %(value)s
            WHERE project_id = %(project_id)s AND id = %(task_id)s;
            """,
            {
                "value": value,
                "project_id": str(project_id),
                "task_id": str(task_id),
            },
        )
    return True


async def process_waypoints_and_waylines(
    side_overlap: float,
    front_overlap: float,
    altitude_from_ground: float,
    gsd_cm_px: float,
    meters: float,
    project_geojson: UploadFile,
    is_terrain_follow: bool,
    dem: UploadFile,
):
    """Processes and returns counts of waypoints and waylines."""
    # Validate the input GeoJSON file
    file_name = os.path.splitext(project_geojson.filename)
    file_ext = file_name[1]
    allowed_extensions = [".geojson", ".json"]
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Provide a valid .geojson file")

    # Generate square boundary GeoJSON
    content = project_geojson.file.read()
    boundary = geojson.loads(content)
    geometry = shape(boundary["features"][0]["geometry"])
    centroid = geometry.centroid
    center_lon = centroid.x
    center_lat = centroid.y
    square_geojson = generate_square_geojson(center_lat, center_lon, meters)

    # Prepare common parameters for waypoint creation
    forward_overlap = front_overlap if front_overlap else 70
    side_overlap = side_overlap if side_overlap else 70
    parameters = calculate_parameters(
        forward_overlap,
        side_overlap,
        altitude_from_ground,
        gsd_cm_px,
        2,
    )
    waypoint_params = {
        "project_area": square_geojson,
        "agl": altitude_from_ground,
        "gsd": gsd_cm_px,
        "forward_overlap": forward_overlap,
        "side_overlap": side_overlap,
        "rotation_angle": 0,
        "generate_3d": False,  # TODO: For 3d imageries drone_flightplan package needs to be updated.
        "take_off_point": None,
    }
    count_data = {"waypoints": 0, "waylines": 0}

    if is_terrain_follow and dem:
        temp_dir = f"/tmp/{uuid.uuid4()}"
        dem_path = os.path.join(temp_dir, "dem.tif")

        try:
            os.makedirs(temp_dir, exist_ok=True)
            # Read DEM content into memory and write to the file
            file_content = await dem.read()
            with open(dem_path, "wb") as file:
                file.write(file_content)

            # Process waypoints with terrain-follow elevation
            waypoint_params["mode"] = FlightMode.waypoints
            points = create_waypoint(**waypoint_params)

            # Add elevation data to waypoints
            outfile_with_elevation = os.path.join(
                temp_dir, "output_file_with_elevation.geojson"
            )
            add_elevation_from_dem(dem_path, points, outfile_with_elevation)

            # Read the updated waypoints with elevation
            with open(outfile_with_elevation, "r") as inpointsfile:
                points_with_elevation = inpointsfile.read()
                count_data["waypoints"] = len(
                    json.loads(points_with_elevation)["features"]
                )

            # Generate waylines from waypoints with elevation
            wayline_placemarks = create_placemarks(
                geojson.loads(points_with_elevation), parameters
            )

            placemarks = terrain_following_waylines.waypoints2waylines(
                wayline_placemarks, 5
            )
            count_data["waylines"] = len(placemarks["features"])

        except Exception as e:
            log.error(f"Error processing DEM: {e}")

        finally:
            # Cleanup temporary files and directory
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
        return count_data

    else:
        # Generate waypoints and waylines
        waypoint_params["mode"] = FlightMode.waypoints
        points = create_waypoint(**waypoint_params)
        count_data["waypoints"] = len(json.loads(points)["features"])

        waypoint_params["mode"] = FlightMode.waylines
        lines = create_waypoint(**waypoint_params)
        count_data["waylines"] = len(json.loads(lines)["features"])

    return count_data
