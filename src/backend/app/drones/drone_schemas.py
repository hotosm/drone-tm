from pydantic import BaseModel
from fastapi import HTTPException
from app.models.enums import HTTPStatus
from psycopg import Connection
from psycopg.rows import class_row


class DroneIn(BaseModel):
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


class DroneOut(BaseModel):
    id: int
    model: str


class DbDrone(BaseModel):
    id: int
    model: str
    manufacturer: str
    camera_model: str
    sensor_width: float
    sensor_height: float
    max_battery_health: int
    focal_length: float
    image_width: int
    image_height: int
    max_altitude: int
    max_speed: float
    weight: int

    @staticmethod
    async def one(db: Connection, drone_id: int):
        """Get a single project by it's ID, including tasks and task count."""
        async with db.cursor(row_factory=class_row(DbDrone)) as cur:
            await cur.execute(
                """
                SELECT * FROM drones d
                WHERE
                    d.id = %(drone_id)s
                GROUP BY
                    p.id;
                """,
                {"drone_id": drone_id},
            )
            drone = await cur.fetchone()

            if not drone:
                raise KeyError(f"Drone {drone_id} not found")

            return drone

    @staticmethod
    async def all(db: Connection):
        """Get all projects, including tasks and task count."""
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
