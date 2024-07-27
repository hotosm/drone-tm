from app.users.user_deps import login_required
from app.users.user_schemas import AuthUser
from app.models.enums import HTTPStatus
from fastapi import APIRouter, Depends, HTTPException
from app.db.database import get_db
from app.config import settings
from app.drones import drone_schemas
from databases import Database
from app.drones import drone_crud

router = APIRouter(
    prefix=f"{settings.API_PREFIX}/drones",
    responses={404: {"description": "Not found"}},
)


@router.post("/create_drone", tags=["Drones"])
async def drone_create(
    drone_info: drone_schemas.DroneIn,
    db: Database = Depends(get_db),
    user_data: AuthUser = Depends(login_required),
):
    """
    Creates a new drone record in the database.

    Args:
        drone_info (drone_schemas.DroneIn): The schema object containing drone details.
        db (Database, optional): The database session object.
        user_data (AuthUser, optional): The authenticated user data.

    Returns:
        dict: A dictionary containing a success message and the ID of the newly created drone.
    """
    drone_id = await drone_crud.create_drone(db, drone_info)
    if not drone_id:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Drone creation failed"
        )
    return {"message": "Drone created successfully", "drone_id": drone_id}


@router.get("/{drone_id}", tags=["Drones"], response_model=drone_schemas.DroneOut)
async def get_drone(
    drone_id: int,
    db: Database = Depends(get_db),
    user_data: AuthUser = Depends(login_required),
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
    drone = await drone_crud.get_drone(db, drone_id)
    if not drone:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="Drone not found"
        )
    return drone
