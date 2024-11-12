import os
import jwt
from app.users import user_schemas
from app.users import user_deps
from app.users import user_logic
from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks, Form
from typing import Annotated
from fastapi.security import OAuth2PasswordRequestForm
from app.users.user_schemas import (
    DbUser,
    Token,
    UserProfileIn,
    AuthUser,
)
from app.users.user_deps import login_required, init_google_auth
from app.config import settings
from app.db import database
from app.models.enums import HTTPStatus
from psycopg import Connection
from fastapi.responses import JSONResponse
from loguru import logger as log
from pydantic import EmailStr
from app.utils import send_reset_password_email


if settings.DEBUG:
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/users",
    tags=["users"],
    responses={404: {"description": "Not found"}},
)


@router.post("/login/")
async def login_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[Connection, Depends(database.get_db)],
    role: str = Form(...),
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = await user_logic.authenticate(db, form_data.username, form_data.password)

    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.get("is_active"):
        raise HTTPException(status_code=400, detail="Inactive user")

    user_info = {
        "id": user.get("id"),
        "email": user.get("email_address"),
        "name": user.get("name"),
        "profile_img": user.get("profile_img"),
        "role": role,
    }

    access_token, refresh_token = await user_logic.create_access_token(user_info)

    return Token(access_token=access_token, refresh_token=refresh_token, role=role)


@router.get("/", tags=["users"], response_model=list[user_schemas.DbUser])
async def get_user(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    return await user_schemas.DbUser.all(db)

@router.post("/{user_id}/profile")
async def update_user_profile(
    user_id: str,
    profile_update: UserProfileIn,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
    request: Request,
):
    """
    Create user profile based on provided user_id and profile_update data.
    Args:
        user_id (int): The ID of the user whose profile is being updated.
        profile_update (UserUserProfileIn): Updated profile data to apply.
    Returns:
        dict: Updated user profile information.
    Raises:
        HTTPException: If user with given user_id is not found in the database.
    """
    user = await user_schemas.DbUser.get_user_by_id(db, user_id)
    if user_data.id != user_id:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN,
            detail="You are not authorized to update profile",
        )

    user =  await user_schemas.DbUserProfile.update(db, user_id, profile_update)
    return JSONResponse(
        status_code=HTTPStatus.OK,
        content={"message": "User profile updated successfully", "results": user},
    )



@router.patch("/{user_id}/profile")
async def update_user_profile(
    user_id: str,
    profile_update: UserProfileIn,
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """
    Update user profile based on provided user_id and profile_update data.
    Args:
        user_id (int): The ID of the user whose profile is being updated.
        profile_update (UserUserProfileIn): Updated profile data to apply.
    Returns:
        dict: Updated user profile information.
    Raises:
        HTTPException: If user with given user_id is not found in the database.
    """
    user = await user_schemas.DbUser.get_user_by_id(db, user_id)
    if user_data.id != user_id:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN,
            detail="You are not authorized to update profile",
        )
        
    if profile_update.old_password and profile_update.password:
        if not user_logic.verify_password(
            profile_update.old_password, user.get("password")
        ):
            raise HTTPException(
                status_code=HTTPStatus.BAD_REQUEST,
                detail="Old password is incorrect",
            )
    user = await user_schemas.DbUserProfile.update(db, user_id, profile_update)
    return JSONResponse(
        status_code=HTTPStatus.OK,
        content={"message": "User profile updated successfully", "results": user},
    )


@router.get("/google-login")
async def login_url(google_auth=Depends(init_google_auth)):
    """Get Login URL for Google Oauth Application.

    The application must be registered on google oauth.
    Open the download url returned to get access_token.

    Args:
        request: The GET request.
        google_auth: The Auth object.

    Returns:
        login_url (string): URL to authorize user in Google OAuth.
            Includes URL params: client_id, redirect_uri, permission scope.
    """
    login_url = google_auth.login()
    log.debug(f"Login URL returned: {login_url}")
    return JSONResponse(content=login_url, status_code=200)


@router.get("/callback/")
async def callback(
    request: Request,
    role: str,
    google_auth=Depends(init_google_auth),
):
    """Performs token exchange between Google and DTM API"""

    # Enforce https callback url
    callback_url = str(request.url).replace("http://", "https://")
    access_token = google_auth.callback(callback_url, role).get("access_token")

    user_data = google_auth.deserialize_access_token(access_token)

    access_token, refresh_token = await user_logic.create_access_token(user_data)

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        role=role,
    )


@router.get("/refresh-token", response_model=Token)
async def update_token(user_data: Annotated[AuthUser, Depends(login_required)]):
    """Refresh access token"""

    access_token, refresh_token = await user_logic.create_access_token(
        user_data.model_dump()
    )
    return Token(
        access_token=access_token, refresh_token=refresh_token, role=user_data.role
    )


@router.get("/my-info/")
async def my_data(
    db: Annotated[Connection, Depends(database.get_db)],
    user_data: Annotated[AuthUser, Depends(login_required)],
):
    """Read access token and get user details from Google"""
    # Get or create user info
    user_info = await user_schemas.DbUser.get_or_create_user(db, user_data)
    # Check if user profile exists
    has_user_profile = await user_schemas.DbUserProfile.get_userprofile_by_userid(
        db, user_info.id
    )

    # Convert user info to dictionary and add profile existence flag
    user_info_dict = user_info.model_dump()
    user_info_dict["has_user_profile"] = bool(has_user_profile)

    # Merge user profile if it exists
    if has_user_profile:
        user_info_dict.update(has_user_profile.model_dump())

    return user_info_dict


@router.post("/forgot-password/")
async def forgot_password(
    db: Annotated[Connection, Depends(database.get_db)],
    email: EmailStr,
    background_tasks: BackgroundTasks,
):
    user = await DbUser.get_user_by_email(db, email)
    token = user_deps.create_reset_password_token(user["email_address"])
    # Store the token in the database (or other storage mechanism) FIXME it is necessary to save reset password token.
    # user["reset_password_token"] = token
    background_tasks.add_task(send_reset_password_email, user["email_address"], token)

    return JSONResponse(
        content={"detail": "Password reset email sent"}, status_code=200
    )


@router.post("/reset-password/")
async def reset_password(
    db: Annotated[Connection, Depends(database.get_db)], token: str, new_password: str
):
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        email = payload.get("sub")
        if email is None:
            raise HTTPException(
                status_code=HTTPStatus.UNAUTHORIZED, detail="Invalid token"
            )

        user = await DbUser.get_user_by_email(db, email)
        if not user:
            raise HTTPException(
                status_code=HTTPStatus.NOT_FOUND, detail="User not found"
            )

        # Update password within a transaction
        async with db.transaction():
            async with db.cursor() as cur:
                await cur.execute(
                    """
                        UPDATE users
                        SET password = %(password)s
                        WHERE id = %(user_id)s;
                    """,
                    {
                        "password": user_logic.get_password_hash(new_password),
                        "user_id": user.get("id"),
                    },
                )

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=HTTPStatus.UNAUTHORIZED, detail="Token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=HTTPStatus.UNAUTHORIZED, detail="Invalid token")
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"An error occurred: {str(e)}",
        )

    return JSONResponse(
        content={"detail": "Your password has been successfully reset!"},
        status_code=200,
    )
