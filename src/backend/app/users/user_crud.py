import time
import jwt
from app.config import settings
from typing import Any
from psycopg import Connection
from loguru import logger as log


async def create_access_token(subject: str | Any):
    expire = int(time.time()) + settings.ACCESS_TOKEN_EXPIRE_MINUTES
    refresh_expire = int(time.time()) + settings.REFRESH_TOKEN_EXPIRE_MINUTES

    # access token
    subject["exp"] = expire
    access_token = jwt.encode(
        subject, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )

    # refresh token
    subject["exp"] = refresh_expire
    refresh_token = jwt.encode(
        subject, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )

    return access_token, refresh_token


async def get_user_by_id(db: Connection, id: str) -> dict[str, Any] | None:
    query = "SELECT * FROM users WHERE id = %s LIMIT 1;"
    async with db.cursor() as cur:
        await cur.execute(query, (id,))
        result = await cur.fetchone()
        return result if result else None


async def get_user_by_email(db: Connection, email: str) -> dict[str, Any] | None:
    query = "SELECT * FROM users WHERE email_address = %s LIMIT 1;"
    async with db.cursor() as cur:
        await cur.execute(query, (email,))
        result = await cur.fetchone()
        return result if result else None


async def get_userprofile_by_userid(db: Connection, user_id: str):
    """Fetch the user profile by user ID."""
    query = """
        SELECT * FROM user_profile
        WHERE user_id = %(user_id)s
        LIMIT 1;
    """
    async with db.cursor() as cur:
        await cur.execute(query, {"user_id": user_id})
        result = await cur.fetchone()
        log.info(f"Fetched user profile data: {result}")
        return result
