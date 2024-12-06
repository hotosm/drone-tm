from app.db import database
from app.config import settings
from fastapi import APIRouter, Depends
from typing import Annotated
from psycopg import Connection


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/gcp",
    tags=["gcp"],
    responses={404: {"description": "Not found"}},
)


@router.get("/find-images")
async def find_images(
    db: Annotated[Connection, Depends(database.get_db)],
):
    pass
