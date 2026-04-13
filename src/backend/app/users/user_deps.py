from datetime import datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, Security
from fastapi.security.api_key import APIKeyHeader
from loguru import logger as log
from psycopg import Connection

from app.config import settings
from app.db import database
from app.users.auth import Auth
from app.users.user_logic import verify_token
from app.users.user_schemas import AuthUser, DbUser


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


async def verify_access_token(
    access_token: str = Security(APIKeyHeader(name="access-token")),
) -> dict:
    """Common token verification logic."""
    if not access_token:
        raise HTTPException(status_code=401, detail="No access token provided")

    try:
        user = verify_token(access_token)
        return user
    except HTTPException as e:
        log.debug(f"Expected access token verification failure: {e.detail}")
        raise HTTPException(status_code=401, detail="Access token not valid") from e
    except Exception as e:
        log.error(f"Unexpected error while verifying access token: {e}")
        raise HTTPException(status_code=401, detail="Access token not valid") from e


async def login_required(
    request: Request,
    user_dict: dict = Depends(verify_access_token),
) -> AuthUser:
    """Dependency to inject into endpoints requiring login."""
    return AuthUser(**user_dict)


async def login_dependency(
    db: Annotated[Connection, Depends(database.get_db)],
    request: Request,
    user_dict: dict = Depends(verify_access_token),
) -> DbUser:
    """Dependency to inject into endpoints requiring login with database user."""
    return await DbUser.get_or_create_user(db, AuthUser(**user_dict))


def create_reset_password_token(email: str):
    expire = datetime.now() + timedelta(
        minutes=settings.RESET_PASSWORD_TOKEN_EXPIRE_MINUTES
    )
    to_encode = {"sub": email, "exp": expire}
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


# Override login_required with Hanko SSO when AUTH_PROVIDER=hanko
if settings.AUTH_PROVIDER == "hanko":
    from hotosm_auth_fastapi import CurrentUser, get_mapped_user_id
    from app.users.hanko_helpers import lookup_user_by_email, create_drone_tm_user

    log.info("Using Hanko SSO authentication")

    async def login_required(
        hanko_user: CurrentUser,
        db: Annotated[Connection, Depends(database.get_db)],
    ) -> AuthUser:
        """Hanko SSO login dependency."""
        user_id = await get_mapped_user_id(
            hanko_user=hanko_user,
            db_conn=db,
            app_name="drone-tm",
            auto_create=True,
            email_lookup_fn=lookup_user_by_email,
            user_creator_fn=create_drone_tm_user,
        )

        user = await DbUser.get_user_by_id(db, user_id)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return AuthUser(
            id=user["id"],
            email=user["email_address"],
            name=user.get("name"),
            profile_img=user.get("profile_img"),
            role="MAPPER",
        )

    async def login_dependency(
        hanko_user: CurrentUser,
        db: Annotated[Connection, Depends(database.get_db)],
    ) -> DbUser:
        """Hanko SSO login dependency for permission checks."""
        user_id = await get_mapped_user_id(
            hanko_user=hanko_user,
            db_conn=db,
            app_name="drone-tm",
            auto_create=True,
            email_lookup_fn=lookup_user_by_email,
            user_creator_fn=create_drone_tm_user,
        )

        user = await DbUser.one(db, user_id)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
