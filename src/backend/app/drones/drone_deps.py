from typing import Annotated
from fastapi import Depends, HTTPException, Path
from psycopg import Connection
from app.db import database
from app.drones.drone_schemas import DbDrone
from app.models.enums import HTTPStatus


async def get_drone_by_id(
    project_id: Annotated[
        id,
        Path(description="Drone ID."),
    ],
    db: Annotated[Connection, Depends(database.get_db)],
) -> DbDrone:
    """Get a single project by id."""
    try:
        return await DbDrone.one(db, project_id)
    except KeyError as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND) from e
