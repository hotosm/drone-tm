from fastapi import HTTPException, Request, Header
from app.config import settings
from app.users.auth import Auth
from app.users.user_schemas import AuthUser
from loguru import logger as log
import jwt
from typing import Any
from passlib.context import CryptContext
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
        user = verify_token(access_token)
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
