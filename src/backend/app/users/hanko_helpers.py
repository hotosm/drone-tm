"""Helper functions for Hanko SSO user mapping in Drone-TM.

This module provides adapter functions that bridge Drone-TM's existing
user management with the auth-libs user mapping system.

The functions here adapt Drone-TM's database models for use as callbacks
in auth-libs' get_mapped_user_id() function.
"""

import uuid
from typing import Optional

from loguru import logger as log
from psycopg import Connection

from hotosm_auth.models import HankoUser

from app.users.user_schemas import AuthUser, DbUser


async def lookup_user_by_email(db_conn: Connection, email: str) -> Optional[str]:
    """Search for existing Drone-TM user by email address.

    This function is used as a callback by auth-libs to check if a user
    with the given email already exists in Drone-TM's database.

    Args:
        db_conn: psycopg database connection
        email: Email address to search for

    Returns:
        str: User ID if found, None otherwise

    Example:
        user_id = await lookup_user_by_email(db, "user@example.com")
        if user_id:
            print(f"Found existing user: {user_id}")
    """
    log.debug(f"Looking up user by email: {email}")
    user = await DbUser.get_user_by_email(db_conn, email)

    if user:
        log.info(f"Found existing user {user['id']} with email {email}")
        return user["id"]

    log.debug(f"No user found with email: {email}")
    return None


async def create_drone_tm_user(db_conn: Connection, hanko_user: HankoUser) -> str:
    """Create a new Drone-TM user from a Hanko user.

    This function is used as a callback by auth-libs to create a new
    Drone-TM user when no existing user is found by email.

    The function generates a new UUID for the Drone-TM user (not reusing
    the Hanko user ID), following the existing pattern in Drone-TM where
    user IDs are generated as UUID integers.

    Args:
        db_conn: psycopg database connection
        hanko_user: Authenticated Hanko user with email and profile info

    Returns:
        str: The newly created user's ID

    Example:
        new_user_id = await create_drone_tm_user(db, hanko_user)
        print(f"Created new user: {new_user_id}")
    """
    # Generate new UUID for Drone-TM user
    # Using uuid4().int to match the pattern in /regulator/ endpoint (line 330 in user_routes.py)
    new_user_id = str(uuid.uuid4().int)

    log.info(f"Creating new Drone-TM user for Hanko user {hanko_user.id}")

    # Extract username from email (everything before @)
    username = hanko_user.email.split("@")[0]

    # Create AuthUser object for DbUser.create()
    auth_user = AuthUser(
        id=new_user_id,
        email=hanko_user.email,
        name=username,
        profile_img=None,
        role="MAPPER",  # Default role for new users
    )

    # Create user in database
    created_user = await DbUser.create(db_conn, auth_user)

    log.info(f"Created new user {created_user.id} for email {hanko_user.email}")
    return created_user.id
