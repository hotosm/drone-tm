import jwt
from app.users.user_logic import verify_token
from fastapi import HTTPException, Request, Security
from fastapi.security.api_key import APIKeyHeader
from app.config import settings
from app.users.auth import Auth
from app.users.user_schemas import AuthUser
from loguru import logger as log
from datetime import datetime, timedelta


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
    request: Request, access_token: str = Security(APIKeyHeader(name="access-token"))
) -> AuthUser:
    """Dependency to inject into endpoints requiring login."""
    if settings.DEBUG:
        return AuthUser(
            id="6da91a51-5efd-40c9-a9c4-b66465a75fbe",
            email="admin@hotosm.org",
            name="admin",
            profile_img="",
            role="",
        )

    if not access_token:
        raise HTTPException(status_code=401, detail="No access token provided")

    try:
        user = verify_token(access_token)
    except HTTPException as e:
        log.error(e)
        log.error("Failed to verify access token")
        raise HTTPException(status_code=401, detail="Access token not valid") from e

    return AuthUser(**user)


def create_reset_password_token(email: str):
    expire = datetime.now() + timedelta(
        minutes=settings.RESET_PASSWORD_TOKEN_EXPIRE_MINUTES
    )
    to_encode = {"sub": email, "exp": expire}
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt
