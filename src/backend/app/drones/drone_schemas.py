from typing import Optional
from pydantic import BaseModel
from fastapi import HTTPException
from app.models.enums import HTTPStatus
from psycopg import Connection
from psycopg.rows import class_row
from datetime import datetime


class BaseDrone(BaseModel):
    model: str
    manufacturer: str
    camera_model: str
    sensor_width: float
    sensor_height: float
    max_battery_health: float
    focal_length: float
    image_width: int
    image_height: int
    max_altitude: float
    max_speed: float
    weight: float


class DroneIn(BaseDrone):
    """Model for drone creation"""


class DroneOut(BaseModel):
    id: int
    model: str


class DbDrone(BaseDrone):
    id: int

    @staticmethod
    async def one(db: Connection, drone_id: int):
        """Get a single drone by it's ID"""
        async with db.cursor(row_factory=class_row(DbDrone)) as cur:
            await cur.execute(
                """
                SELECT * FROM drones
                WHERE id = %(drone_id)s;
                """,
                {"drone_id": drone_id},
            )
            drone = await cur.fetchone()

            if not drone:
                raise KeyError(f"Drone {drone_id} not found")

            return drone

    @staticmethod
    async def all(db: Connection):
        """Get all drones"""
        async with db.cursor(row_factory=class_row(DbDrone)) as cur:
            await cur.execute(
                """
                SELECT * FROM drones d
                GROUP BY d.id;
                """
            )
            drones = await cur.fetchall()

            if not drones:
                raise KeyError("No drones found")
            return drones

    @staticmethod
    async def delete(db: Connection, drone_id: int):
        """Delete a single drone by its ID."""
        async with db.cursor() as cur:
            await cur.execute(
                """
                DELETE FROM drones
                WHERE id = %(drone_id)s
                RETURNING id;
                """,
                {"drone_id": drone_id},
            )
            deleted_drone_id = await cur.fetchone()

            if not deleted_drone_id:
                raise KeyError(f"Drone {drone_id} not found or could not be deleted")

            return deleted_drone_id[0]

    @staticmethod
    async def create(db: Connection, drone: DroneIn):
        """Create a single drone."""
        # NOTE we first check if a drone with this model name exists
        async with db.cursor() as cur:
            sql = """
                SELECT EXISTS (
                    SELECT 1
                    FROM drones
                    WHERE LOWER(model) = %(model_name)s
                )
            """
            await cur.execute(sql, {"model_name": drone.model.lower()})
            project_exists = await cur.fetchone()
            if project_exists[0]:
                msg = f"Drone ({drone.model}) already exists!"
                raise HTTPException(status_code=HTTPStatus.CONFLICT, detail=msg)

        # If drone with the same model does not already exists, add a new one.
        model_dump = drone.model_dump()
        columns = ", ".join(model_dump.keys())
        value_placeholders = ", ".join(f"%({key})s" for key in model_dump.keys())

        sql = f"""
                INSERT INTO drones ({columns}, created)
                VALUES ({value_placeholders}, NOW())
                RETURNING id;
               """

        async with db.cursor() as cur:
            await cur.execute(sql, model_dump)
            new_drone_id = await cur.fetchone()

            if not new_drone_id:
                msg = f"Unknown SQL error for data: {model_dump}"
                raise HTTPException(
                    status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=msg
                )
            return new_drone_id[0]


class DroneFlightHeight(BaseModel):
    id: int
    country: str
    country_code: str
    max_altitude_ft: float
    max_altitude_m: float
    created_at: datetime
    updated_at: Optional[datetime] = None

    @staticmethod
    async def all(db: Connection):
        try:
            async with db.cursor(row_factory=class_row(DroneFlightHeight)) as cur:
                await cur.execute("""
                    SELECT *
                    FROM drone_flight_height;
                """)
                return await cur.fetchall()

        except Exception as e:
            raise HTTPException(
                status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)
            )

    @staticmethod
    async def one(db: Connection, country: str):
        try:
            async with db.cursor(row_factory=class_row(DroneFlightHeight)) as cur:
                await cur.execute(
                    """
                    SELECT * FROM drone_flight_height WHERE country = %(country)s;
                """,
                    {"country": country},
                )
                return await cur.fetchone()
        except Exception as e:
            raise HTTPException(
                status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)
            )
