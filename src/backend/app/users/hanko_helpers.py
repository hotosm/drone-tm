"""Hanko SSO user mapping helpers for Drone-TM."""

import uuid
from typing import Optional

from loguru import logger as log
from psycopg import Connection

from hotosm_auth.models import HankoUser

from app.users.user_schemas import AuthUser, DbUser


async def lookup_user_by_email(db_conn: Connection, email: str) -> Optional[str]:
    """Find existing user by email. Returns user ID or None."""
    user = await DbUser.get_user_by_email(db_conn, email)
    if user:
        log.debug(f"Found user {user['id']} for {email}")
        return user["id"]
    return None


async def create_drone_tm_user(db_conn: Connection, hanko_user: HankoUser) -> str:
    """Create new Drone-TM user from Hanko user. Returns new user ID."""
    new_user_id = str(uuid.uuid4().int)
    username = hanko_user.email.split("@")[0]

    auth_user = AuthUser(
        id=new_user_id,
        email=hanko_user.email,
        name=username,
        profile_img=None,
        role="MAPPER",
    )

    created_user = await DbUser.create(db_conn, auth_user)
    log.info(f"Created user {created_user.id} for {hanko_user.email}")
    return created_user.id
