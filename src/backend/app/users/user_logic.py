import time
from typing import Any

import bcrypt
import jwt
from fastapi import HTTPException
from psycopg import Connection
from pydantic import EmailStr

from app.config import settings
from app.db import db_models
from app.users import user_schemas


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


def verify_token(token: str) -> dict[str, Any]:
    """Verifies the access token and returns the payload if valid.

    Args:
        token (str): The access token to be verified.

    Returns:
        dict: The payload of the access token if verification is successful.

    Raises:
        HTTPException: If the token has expired or credentials could not be validated.
    """
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="Token has expired") from e
    except Exception as e:
        raise HTTPException(status_code=401, detail="Could not validate token") from e


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed_password.decode("utf-8")


async def authenticate(
    db: Connection, email: EmailStr, password: str
) -> db_models.DbUser | None:
    db_user = await user_schemas.DbUser.get_user_by_email(db, email)
    if not db_user:
        return None
    if not verify_password(password, db_user["password"]):
        return None
    return db_user


async def get_oam_token_for_user(db: Connection, user_id: str) -> str:
    query = """
            SELECT oam_api_token
            FROM user_profile
            where user_id = %(user_id)s;
            """
    async with db.cursor() as cur:
        await cur.execute(query, {"user_id": user_id})
        data = await cur.fetchone()
        return data[0]
