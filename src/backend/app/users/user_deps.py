from typing import Annotated
from app.users.user_logic import verify_token
from fastapi import Depends, HTTPException, Request, Header
from app.config import settings
from app.users.auth import Auth
from app.users.user_schemas import AuthUser
from loguru import logger as log
from psycopg import Connection
from psycopg.rows import dict_row
from app.models.enums import UserRole
from app.db import database


async def get_user_role(db: Connection, user_id: str) -> str:
    async with db.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT role FROM user_profile WHERE user_id = %(user_id)s""",
            {"user_id": user_id},
        )
        records = await cur.fetchall()

        if not records:
            raise HTTPException(status_code=404, detail="User profile not found")
        roles = [record["role"] for record in records]

        if UserRole.PROJECT_CREATOR.name in roles:
            return "PROJECT_CREATOR"
        else:
            return "DRONE_PILOT"


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


async def get_role_with_user_data(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: AuthUser = Depends(login_required),
) -> str:
    return await get_user_role(db, user_data.id)
