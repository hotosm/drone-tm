import jwt
from typing import Annotated
from databases import Database
from fastapi import Depends, HTTPException, Request, status, Header
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy.orm import Session
from app.config import settings
from app.db import database
from app.users import user_crud, user_schemas
from app.db.db_models import DbUser
from app.users.auth import Auth
from app.users.user_schemas import AuthUser
from loguru import logger as log

reusable_oauth2 = OAuth2PasswordBearer(tokenUrl=f"{settings.API_PREFIX}/users/login")

# SessionDep = Annotated[
#     Database,
#     Depends(database.encode_db),
# ]
SessionDep = Annotated[
    Session,
    Depends(database.get_db),
]
TokenDep = Annotated[str, Depends(reusable_oauth2)]


def get_current_user(session: SessionDep, token: TokenDep):
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[user_crud.ALGORITHM]
        )
        token_data = user_schemas.TokenPayload(**payload)

    except (InvalidTokenError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )

    user = session.get(DbUser, token_data.sub)

    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


CurrentUser = Annotated[DbUser, Depends(get_current_user)]


def get_current_active_superuser(current_user: CurrentUser):
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


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

    google_auth = await init_google_auth()

    if not access_token:
        raise HTTPException(status_code=401, detail="No access token provided")

    try:
        google_user = google_auth.deserialize_access_token(access_token)
    except ValueError as e:
        log.error(e)
        log.error("Failed to deserialise access token")
        raise HTTPException(status_code=401, detail="Access token not valid") from e

    return AuthUser(**google_user)
