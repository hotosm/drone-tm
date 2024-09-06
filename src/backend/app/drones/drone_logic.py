from app.models.enums import HTTPStatus
from loguru import logger as log
from fastapi import HTTPException
from psycopg import Connection
from typing import List
from app.drones.drone_schemas import DroneOut


async def read_all_drones(db: Connection) -> List[DroneOut]:
    """
    Retrieves all drone records from the database.

    Args:
        db (Database): The database connection object.

    Returns:
        List[DroneOut]: A list of all drone records.
    """
    try:
        select_query = """
            SELECT * FROM drones
        """
        results = await db.fetch_all(select_query)
        return results

    except Exception as e:
        log.exception(e)
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail="Retrieval failed"
        ) from e


async def delete_drone(db: Connection, drone_id: int) -> bool:
    """
    Deletes a drone record from the database, along with associated drone flights.

    Args:
        db (Database): The database connection object.
        drone_id (int): The ID of the drone to be deleted.

    Returns:
        bool: True if the drone was successfully deleted, False otherwise.
    """
    try:
        delete_query = """
            WITH deleted_flights AS (
                DELETE FROM drone_flights
                WHERE drone_id = :drone_id
                RETURNING drone_id
            )
            DELETE FROM drones
            WHERE id = :drone_id
        """
        await db.execute(delete_query, {"drone_id": drone_id})
        return True

    except Exception as e:
        log.exception(e)
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail="Deletion failed"
        ) from e


async def get_drone(db: Connection, drone_id: int):
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
        result = await db.fetch_one(select_query, {"id": drone_id})
        return result

    except Exception as e:
        log.exception(e)
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail="Retrieval failed"
        ) from e
