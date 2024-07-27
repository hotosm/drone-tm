from app.drones import drone_schemas
from app.models.enums import HTTPStatus
from databases import Database
from loguru import logger as log
from fastapi import HTTPException

async def delete_drone(db: Database, drone_id: int) -> bool:
    """
    Deletes a drone record from the database.

    Args:
        db (Database): The database connection object.
        drone_id (int): The ID of the drone to be deleted.

    Returns:
        bool: True if the drone was successfully deleted, False otherwise.
    """
    try:
        delete_query = """
            DELETE FROM drones
            WHERE id = :id
        """
        result = await db.execute(delete_query, {'id': drone_id})
        return result > 0
    
    except Exception as e:
        log.exception(e)
        raise HTTPException(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail="Deletion failed") from e


async def get_drone(db: Database, drone_id: int):
    """
    Retrieves a drone record from the database.

    Args:
        db (Database): The database connection object.
        drone_id (int): The ID of the drone to be retrieved.

    Returns:
        dict: The drone record if found, otherwise None.
    """
    try:
        select_query = """
            SELECT * FROM drones
            WHERE id = :id
        """
        result = await db.fetch_one(select_query, {'id': drone_id})
        return result
    
    except Exception as e:
        log.exception(e)
        raise HTTPException(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail="Retrieval failed") from e


async def create_drone(db: Database, drone_info: drone_schemas.DroneIn):
    """
    Creates a new drone record in the database.

    Args:
        db (Database): The database connection object.
        drone (drone_schemas.DroneIn): The schema object containing drone details.

    Returns:
        The ID of the newly created drone record.
    """
    try:
        insert_query = """
            INSERT INTO drones (
                model, manufacturer, camera_model, sensor_width, sensor_height,
                max_battery_health, focal_length, image_width, image_height,
                max_altitude, max_speed, weight, created
            ) VALUES (
                :model, :manufacturer, :camera_model, :sensor_width, :sensor_height,
                :max_battery_health, :focal_length, :image_width, :image_height,
                :max_altitude, :max_speed, :weight, CURRENT_TIMESTAMP
            )
            RETURNING id
        """
        result = await db.execute(insert_query, drone_info.__dict__)
        return result
    
    except Exception as e:
        log.exception(e)
        raise HTTPException(e) from e



