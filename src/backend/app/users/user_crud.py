import time
import jwt
from app.config import settings
from typing import Any
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.db import db_models
from app.users.user_schemas import UserCreate, AuthUser
from sqlalchemy import text
from databases import Database
from fastapi import HTTPException
from app.models.enums import UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


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


def verify_token(token: str):
    """Verifies the access token and returns the payload if valid.

    Args:
        token (str): The access token to be verified.

    Returns:
        dict: The payload of the access token if verification is successful.

    Raises:
        HTTPException: If the token has expired or credentials could not be validated.
    """
    secret_key = settings.SECRET_KEY
    try:
        return jwt.decode(token, str(secret_key), algorithms=[settings.ALGORITHM])
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="Token has expired") from e
    except Exception as e:
        raise HTTPException(status_code=401, detail="Could not validate token") from e


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def get_user_by_email(db: Session, email: str):
    query = text(f"SELECT * FROM users WHERE email_address = '{email}' LIMIT 1;")
    result = db.execute(query)
    data = result.fetchone()
    return data


async def get_user_email(db: Database, email: str):
    query = f"SELECT * FROM users WHERE email_address = '{email}' LIMIT 1;"
    result = await db.fetch_one(query)
    return result


async def get_user_username(db: Database, username: str):
    query = f"SELECT * FROM users WHERE username = '{username}' LIMIT 1;"
    result = await db.fetch_one(query=query)
    return result


def get_user_by_username(db: Session, username: str):
    query = text(f"SELECT * FROM users WHERE username = '{username}' LIMIT 1;")
    result = db.execute(query)
    data = result.fetchone()
    return data


async def authenticate(
    db: Database, username: str, password: str
) -> db_models.DbUser | None:
    db_user = await get_user_username(db, username)
    if not db_user:
        return None
    if not verify_password(password, db_user["password"]):
        return None
    return db_user


# def authenticate(db: Session, username: str, password: str) -> db_models.DbUser | None:
#     db_user = get_user_by_username(db, username)
#     if not db_user:
#         return None
#     if not verify_password(password, db_user.password):
#         return None
#     return db_user


async def create_user(db: Database, user_create: UserCreate):
    query = f"""
    INSERT INTO users (username, password, is_active, name, email_address, is_superuser)
    VALUES ('{user_create.username}', '{get_password_hash(user_create.password)}', {True}, '{user_create.name}', '{user_create.email_address}', {False})
    RETURNING id
    """
    _id = await db.execute(query)
    raw_query = f"SELECT * from users WHERE id = {_id} LIMIT 1"
    db_obj = await db.fetch_one(query=raw_query)
    if not db_obj:
        raise HTTPException(status_code=500, detail="User could not be created")
    return db_obj


async def get_or_create_user(
    db: Database,
    user_data: AuthUser,
):
    """Get user from User table if exists, else create."""
    try:
        update_sql = """
            INSERT INTO users (
                    id, username, email_address, profile_img, role
                    )
                VALUES (
                    :user_id, :username, :email_address, :profile_img, :role
                    )
            ON CONFLICT (id)
                DO UPDATE SET profile_img = :profile_img;
            """

        await db.execute(
            update_sql,
            {
                "user_id": str(user_data.id),
                "username": user_data.email,  # FIXME: remove this
                "email_address": user_data.email,
                "profile_img": user_data.img_url,
                "role": UserRole.DRONE_PILOT.name,
            },
        )
        return user_data

    except Exception as e:
        if (
            'duplicate key value violates unique constraint "users_email_address_key"'
            in str(e)
        ):
            raise HTTPException(
                status_code=400,
                detail=f"User with this email {user_data.email} already exists.",
            ) from e
        else:
            raise HTTPException(status_code=400, detail=str(e)) from e
