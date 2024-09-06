from typing import Annotated
from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.models.enums import HTTPStatus
from fastapi import APIRouter, Depends, HTTPException
from app.db import database
from app.config import settings
from app.drones import drone_schemas, drone_deps
from psycopg import Connection


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/drones",
    tags=["Drones"],
    responses={404: {"description": "Not found"}},
)


@router.get("/", response_model=list[drone_schemas.DroneOut])
async def read_drones(
    db: Annotated[Connection, Depends(database.get_db)],
):
    """Get all drones."""
    try:
        return await drone_schemas.DbDrone.all(db)
    except KeyError as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND) from e


@router.post("/create-drone")
async def create_drone(
    drone_info: drone_schemas.DroneIn,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Create a new drone in database"""
    drone_id = await drone_schemas.DbDrone.create(db, drone_info)
    return {"message": "Drone created successfully", "drone_id": drone_id}


@router.delete("/{drone_id}")
async def delete_drone(
    drone: Annotated[drone_schemas.DbDrone, Depends(drone_deps.get_drone_by_id)],
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """
    Deletes a drone record from the database.

    Args:
        drone_id (int): The ID of the drone to be deleted.
        db (Database, optional): The database session object.
        user_data (AuthUser, optional): The authenticated user data.

    Returns:
        dict: A success message if the drone was deleted.
    """

    # TODO: Check user role, Admin can only do this.
    # After user roles introduction
    drone_id = await drone_schemas.DbDrone.delete(db, drone.id)
    return {"message": f"Drone successfully deleted {drone_id}"}


@router.get("/{drone_id}", response_model=drone_schemas.DbDrone)
async def read_drone(
    drone: Annotated[drone_schemas.DbDrone, Depends(drone_deps.get_drone_by_id)],
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """
    Retrieves a drone record from the database.

    Args:
        drone_id (int): The ID of the drone to be retrieved.
        db (Database, optional): The database session object.
        user_data (AuthUser, optional): The authenticated user data.

    Returns:
        dict: The drone record if found.
    """
    return drone
