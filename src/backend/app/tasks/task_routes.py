import uuid
from typing import Annotated
from app.projects import project_deps, project_schemas
from app.projects import project_logic
from fastapi import APIRouter, BackgroundTasks, Depends
from app.config import settings
from app.tasks import task_schemas, task_logic
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from psycopg import Connection
from app.db import database
from loguru import logger as log
from psycopg.rows import dict_row

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/tasks",
    tags=["tasks"],
    responses={404: {"description": "Not found"}},
)


@router.get("/{task_id}")
async def read_task(
    task_id: uuid.UUID,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    "Retrieve details of a specific task by its ID."
    return await task_schemas.TaskDetailsOut.get_task_details(db, task_id)


@router.get("/statistics/")
async def get_task_stats(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
):
    "Retrieve statistics related to tasks for the authenticated user."
    return await task_logic.get_task_stats(db, user_data)


@router.get("/")
async def list_tasks(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    skip: int = 0,
    limit: int = 50,
):
    """Get all tasks for a all user."""
    user_id = user_data.id
    role = user_data.role
    log.info(f"Fetching tasks for user {user_id} with role: {role}")
    return await task_schemas.UserTasksOut.get_tasks_by_user(
        db, user_id, role, skip, limit
    )


@router.get("/states/{project_id}")
async def task_states(
    db: Annotated[Connection, Depends(database.get_db)], project_id: uuid.UUID
):
    """Get all tasks states for a project."""
    return await task_schemas.Task.all(db, project_id)


@router.post("/event/{project_id}/{task_id}")
async def new_event(
    db: Annotated[Connection, Depends(database.get_db)],
    background_tasks: BackgroundTasks,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    detail: task_schemas.NewEvent,
    user_data: Annotated[AuthUser, Depends(login_required)],
    project: Annotated[
        project_schemas.DbProject, Depends(project_deps.get_project_by_id)
    ],
):
    user_id = user_data.id
    project = project.model_dump()
    user_role = user_data.role
    return await task_logic.handle_event(
        db,
        project_id,
        task_id,
        user_id,
        project,
        user_role,
        detail,
        user_data,
        background_tasks,
    )


# TODO: We will remove this endpoint after production release.
@router.post("/dummy/")
async def update_task_table(
    db: Annotated[Connection, Depends(database.get_db)],
):
    async with db.cursor(row_factory=dict_row) as cur:
        # Fetch all projects
        await cur.execute(
            """
            SELECT *
            FROM projects
            """
        )
        db_projects = await cur.fetchall()

        for project in db_projects:
            project_id = project["id"]

            # Fetch tasks for the current project
            await cur.execute(
                """
                SELECT *
                FROM tasks
                WHERE project_id = %s
                """,
                (project_id,),
            )
            tasks = await cur.fetchall()

            for task in tasks:
                if task["total_area_sqkm"] is None:
                    # Calculate the area
                    await cur.execute(
                        """
                        SELECT ST_Area(ST_Transform(%s, 3857)) / 1000000 AS task_area
                        """,
                        (task["outline"],),
                    )
                    area_result = await cur.fetchone()

                    task_area = area_result["task_area"] if area_result else 0

                    # Update the total_area_sqkm in the tasks table
                    await cur.execute(
                        """
                        UPDATE tasks
                        SET total_area_sqkm = %s
                        WHERE id = %s
                        """,
                        (task_area, task["id"]),
                    )
                task_id = task["id"]

                if task["assets_url"] is None:
                    await cur.execute(
                        """
                        SELECT state
                        FROM task_events
                        WHERE task_id = %s
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (task_id,),
                    )
                    task_event = await cur.fetchone()
                    if (
                        task_event
                        and task_event["state"] == "IMAGE_PROCESSING_FINISHED"
                    ):
                        s3_path_url = (
                            f"dtm-data/projects/{project_id}/{task_id}/assets.zip"
                        )
                        # Update the task table with the assets_url
                        await project_logic.update_task_field(
                            db, project_id, task_id, "assets_url", s3_path_url
                        )

            if task["total_image_uploaded"] is None:
                await cur.execute(
                    """
                        SELECT state
                        FROM task_events
                        WHERE task_id = %s AND state = 'IMAGE_UPLOADED'
                        ORDER BY created_at DESC
                        """,
                    (task_id,),
                )
                task_event = await cur.fetchone()
                if task_event:
                    # update the count of the task to image uploaded.
                    toatl_image_count = project_logic.get_project_info_from_s3(
                        project_id, task_id
                    ).image_count

                    await project_logic.update_task_field(
                        db,
                        project_id,
                        task_id,
                        "total_image_uploaded",
                        toatl_image_count,
                    )

                if task["flight_time_minutes"] and task["flight_distance_km"] is None:
                    import geojson
                    from drone_flightplan import (
                        waypoints,
                        add_elevation_from_dem,
                        calculate_parameters,
                        create_placemarks,
                    )
                    from app.s3 import get_file_from_bucket
                    from geojson import Feature, FeatureCollection, Polygon
                    from app.models.enums import FlightMode
                    from app.utils import calculate_flight_time_from_placemarks

                    # Fetch the task outline
                    await cur.execute(
                        """
                        SELECT jsonb_build_object(
                                'type', 'Feature',
                                'geometry', ST_AsGeoJSON(tasks.outline)::jsonb,
                                'properties', jsonb_build_object(
                                    'id', tasks.id,
                                    'bbox', jsonb_build_array(
                                        ST_XMin(ST_Envelope(tasks.outline)),
                                        ST_YMin(ST_Envelope(tasks.outline)),
                                        ST_XMax(ST_Envelope(tasks.outline)),
                                        ST_YMax(ST_Envelope(tasks.outline))
                                    )
                                ),
                                'id', tasks.id
                            ) AS outline
                        FROM tasks
                        WHERE id = %s;
                        """,
                        (task["id"],),
                    )
                    polygon = await cur.fetchone()
                    polygon = polygon["outline"]
                    forward_overlap = (
                        project["front_overlap"] if project["front_overlap"] else 70
                    )
                    side_overlap = (
                        project["side_overlap"] if project["side_overlap"] else 70
                    )
                    generate_3d = False  # TODO: For 3d imageries drone_flightplan package needs to be updated.

                    gsd = project["gsd_cm_px"]
                    altitude = project["altitude_from_ground"]

                    parameters = calculate_parameters(
                        forward_overlap,
                        side_overlap,
                        altitude,
                        gsd,
                        2,
                    )

                    # Wrap polygon into GeoJSON Feature
                    coordinates = polygon["geometry"]["coordinates"]
                    if polygon["geometry"]["type"] == "Polygon":
                        coordinates = polygon["geometry"]["coordinates"]
                    feature = Feature(geometry=Polygon(coordinates), properties={})
                    feature_collection = FeatureCollection([feature])

                    # Common parameters for create_waypoint
                    waypoint_params = {
                        "project_area": feature_collection,
                        "agl": altitude,
                        "gsd": gsd,
                        "forward_overlap": forward_overlap,
                        "side_overlap": side_overlap,
                        "rotation_angle": 0,
                        "generate_3d": generate_3d,
                    }
                    waypoint_params["mode"] = FlightMode.waypoints
                    if project["is_terrain_follow"]:
                        dem_path = f"/tmp/{uuid.uuid4()}/dem.tif"

                        # Terrain follow uses waypoints mode, waylines are generated later
                        points = waypoints.create_waypoint(**waypoint_params)

                        try:
                            get_file_from_bucket(
                                settings.S3_BUCKET_NAME,
                                f"dtm-data/projects/{project.id}/dem.tif",
                                dem_path,
                            )
                            # TODO: Do this with inmemory data
                            outfile_with_elevation = (
                                "/tmp/output_file_with_elevation.geojson"
                            )
                            add_elevation_from_dem(
                                dem_path, points, outfile_with_elevation
                            )

                            inpointsfile = open(outfile_with_elevation, "r")
                            points_with_elevation = inpointsfile.read()

                        except Exception:
                            points_with_elevation = points

                        placemarks = create_placemarks(
                            geojson.loads(points_with_elevation), parameters
                        )

                    else:
                        points = waypoints.create_waypoint(**waypoint_params)
                        placemarks = create_placemarks(
                            geojson.loads(points), parameters
                        )

                    flight_time_minutes = calculate_flight_time_from_placemarks(
                        placemarks
                    ).get("total_flight_time")
                    flight_distance_km = calculate_flight_time_from_placemarks(
                        placemarks
                    ).get("flight_distance_km")

                    # Update the total_area_sqkm in the tasks table
                    await cur.execute(
                        """
                        UPDATE tasks
                        SET flight_time_minutes = %s,
                            flight_distance_km = %s
                        WHERE id = %s
                        """,
                        (flight_time_minutes, flight_distance_km, task["id"]),
                    )

        return {"message": "Task table updated successfully."}
