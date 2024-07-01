import time
import jwt
from app.config import settings
from typing import Any
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.db import db_models
from app.users.user_schemas import UserCreate
from sqlalchemy import text
from fastapi import HTTPException


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_access_token(subject: str | Any):
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


# def get_user_by_email(db: Session, email: str) -> db_models.DbUser | None:
#     output = db.query(db_models.DbUser).filter(db_models.DbUser.email_address == email).first()
#     print("output = ",output)
#     return output


def get_user_by_email(db: Session, email: str):
    query = text(f"SELECT * FROM users WHERE email_address = '{email}' LIMIT 1;")
    result = db.execute(query)
    data = result.fetchone()
    return data


def get_user_by_username(db: Session, username: str):
    query = text(f"SELECT * FROM users WHERE username = '{username}' LIMIT 1;")
    result = db.execute(query)
    data = result.fetchone()
    return data


# def get_user_by_username(db: Session, username: str):
#     return db.query(db_models.DbUser).filter(db_models.DbUser.username==username).first()


def authenticate(db: Session, username: str, password: str) -> db_models.DbUser | None:
    db_user = get_user_by_username(db, username)
    if not db_user:
        return None
    if not verify_password(password, db_user.password):
        return None
    return db_user


def create_user(db: Session, user_create: UserCreate):
    db_obj = db_models.DbUser(
        is_active=True,  # FIXME: set to false by default, activate through email
        password=get_password_hash(user_create.password),
        **user_create.model_dump(exclude=["password"]),
    )

    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj
