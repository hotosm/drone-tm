from fastapi import HTTPException, Request, Header
from app.config import settings
from app.users import user_crud
from app.users.auth import Auth
from app.users.user_schemas import AuthUser, UserProfileIn
from loguru import logger as log
import time
import jwt
from typing import Any
from passlib.context import CryptContext
from app.db import db_models
from pydantic import EmailStr
import psycopg
from psycopg import Connection


async def init_google_auth():
    """Initialise Auth object for google login"""

    return Auth(
        authorization_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://www.googleapis.com/oauth2/v4/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        secret_key=settings.SECRET_KEY,
        login_redirect_uri=settings.GOOGLE_LOGIN_REDIRECT_URI,
        scope=[
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
        ],
    )


async def login_required(
    request: Request, access_token: str = Header(None)
) -> AuthUser:
    """Dependency to inject into endpoints requiring login."""
    if settings.DEBUG:
        return AuthUser(
            id="6da91a51-5efd-40c9-a9c4-b66465a75fbe",
            email="admin@hotosm.org",
            name="admin",
            img_url="",
        )

    if not access_token:
        raise HTTPException(status_code=401, detail="No access token provided")

    if not access_token:
        raise HTTPException(status_code=401, detail="No access token provided")

    try:
        user = user_crud.verify_token(access_token)
    except HTTPException as e:
        log.error(e)
        log.error("Failed to verify access token")
        raise HTTPException(status_code=401, detail="Access token not valid") from e

    return AuthUser(**user)


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


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def create_access_token(subject: dict[str, Any]) -> tuple[str, str]:
    expire = int(time.time()) + settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    refresh_expire = int(time.time()) + settings.REFRESH_TOKEN_EXPIRE_MINUTES * 60

    # Access token
    subject["exp"] = expire
    access_token = jwt.encode(
        subject, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )

    # Refresh token
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
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


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
        return dict(result) if result else None


async def authenticate(
    db: Connection, email: EmailStr, password: str
) -> db_models.DbUser | None:
    db_user = await get_user_by_email(db, email)
    if not db_user:
        return None
    if not verify_password(password, db_user["password"]):
        return None
    return db_user


async def get_or_create_user(db: Connection, user_data: AuthUser) -> AuthUser:
    """Get user from User table if exists, else create."""
    try:
        update_sql = """
            INSERT INTO users (
                id, name, email_address, profile_img, is_active, is_superuser, date_registered
            )
            VALUES (%s, %s, %s, %s, True, False, now())
            ON CONFLICT (id)
            DO UPDATE SET profile_img = EXCLUDED.profile_img;
        """

        async with db.cursor() as cur:
            await cur.execute(
                update_sql,
                (str(user_data.id), user_data.name, user_data.email, user_data.img_url),
            )
        return user_data

    except psycopg.errors.UniqueViolation as e:
        if "users_email_address_key" in str(e):
            raise HTTPException(
                status_code=400,
                detail=f"User with this email {user_data.email} already exists.",
            ) from e
        else:
            raise HTTPException(status_code=400, detail=str(e)) from e


async def update_user_profile(
    db: Connection, user_id: int, profile_update: UserProfileIn
) -> bool:
    """
    Update user profile in the database.
    Args:
        db (Connection): Database connection object.
        user_id (int): ID of the user whose profile is being updated.
        profile_update (ProfileUpdate): Instance of ProfileUpdate containing fields to update.
    Returns:
        bool: True if update operation succeeds.
    Raises:
        HTTPException: If the update operation fails.
    """
    try:
        profile_query = """
            INSERT INTO user_profile (
                user_id, role, phone_number, country, city, organization_name,
                organization_address, job_title, notify_for_projects_within_km,
                experience_years, drone_you_own, certified_drone_operator
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id)
            DO UPDATE SET
                role = EXCLUDED.role,
                phone_number = EXCLUDED.phone_number,
                country = EXCLUDED.country,
                city = EXCLUDED.city,
                organization_name = EXCLUDED.organization_name,
                organization_address = EXCLUDED.organization_address,
                job_title = EXCLUDED.job_title,
                notify_for_projects_within_km = EXCLUDED.notify_for_projects_within_km,
                experience_years = EXCLUDED.experience_years,
                drone_you_own = EXCLUDED.drone_you_own,
                certified_drone_operator = EXCLUDED.certified_drone_operator;
        """

        async with db.cursor() as cur:
            await cur.execute(
                profile_query,
                (
                    user_id,
                    profile_update.role,
                    profile_update.phone_number,
                    profile_update.country,
                    profile_update.city,
                    profile_update.organization_name,
                    profile_update.organization_address,
                    profile_update.job_title,
                    profile_update.notify_for_projects_within_km,
                    profile_update.experience_years,
                    profile_update.drone_you_own,
                    profile_update.certified_drone_operator,
                ),
            )

        # If password is provided, update the users table
        if profile_update.password:
            password_update_query = """
                UPDATE users
                SET password = %s
                WHERE id = %s;
            """
            async with db.cursor() as cur:
                await cur.execute(
                    password_update_query,
                    (get_password_hash(profile_update.password), user_id),
                )

        return True
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
