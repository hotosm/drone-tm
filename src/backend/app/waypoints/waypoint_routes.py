from fastapi import APIRouter


router = APIRouter(
    prefix="/waypoint",
    tags=["waypoint"],
    responses={404: {"description": "Not found"}},
)
