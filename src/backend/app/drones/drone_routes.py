from typing import Annotated

from fastapi import APIRouter, Depends
from psycopg import Connection

from app.db import database
from app.drones import drone_schemas
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser

router = APIRouter(
    prefix="/drones",
    tags=["Drones"],
    responses={404: {"description": "Not found"}},
)

@router.get("/drone-altitude/{country}/")
async def get_drone_altitude_by_country(
    country: str,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Get drone altitude details by country."""
    result = await drone_schemas.DroneFlightHeight.one(db, country)

    if not result:
        return []

    return result
