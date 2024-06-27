import jwt
from app.config import settings
from datetime import datetime, timedelta
from typing import Any
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.db import db_models
from app.users.user_schemas import UserCreate
from sqlalchemy import text
from databases import Database
from fastapi import HTTPException

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def create_access_token(
    subject: str | Any, expires_delta: timedelta, refresh_token_expiry: timedelta
):
    expire = datetime.utcnow() + expires_delta
    refresh_expire = datetime.utcnow() + refresh_token_expiry

    to_encode_access_token = {"exp": expire, "sub": str(subject)}
    to_encode_refresh_token = {"exp": refresh_expire, "sub": str(subject)}

    access_token = jwt.encode(
        to_encode_access_token, settings.SECRET_KEY, algorithm=ALGORITHM
    )
    refresh_token = jwt.encode(
        to_encode_refresh_token, settings.SECRET_KEY, algorithm=ALGORITHM
    )

    return access_token, refresh_token


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

async def authenticate(db: Database, username: str, password: str) -> db_models.DbUser | None:
    db_user = await get_user_username(db, username)
    if not db_user:
        return None
    if not verify_password(password, db_user['password']):
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
        raise HTTPException(
            status_code=500,
            detail="User could not be created"
        )
    return db_obj
