from typing import Annotated

from app.db import database
from app.drones.drone_schemas import DbDrone
from app.models.enums import HTTPStatus
from fastapi import Depends, HTTPException, Path
from psycopg import Connection


async def get_drone_by_id(
    drone_id: Annotated[
        int,
        Path(description="Drone ID."),
    ],
    db: Annotated[Connection, Depends(database.get_db)],
) -> DbDrone:
    """Get a single project by id."""
    try:
        return await DbDrone.one(db, drone_id)
    except KeyError as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND) from e
