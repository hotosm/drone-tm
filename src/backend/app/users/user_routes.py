from fastapi import APIRouter, Response, HTTPException, Depends
from typing import Annotated
from fastapi.security import OAuth2PasswordRequestForm
from app.users.user_schemas import (
    Token,
    ProfileUpdate,
    AuthUser,
)
from app.users.user_deps import login_required
from app.config import settings
from app.users import user_crud
from app.db import database
from app.models.enums import HTTPStatus
from databases import Database


router = APIRouter(
    prefix=f"{settings.API_PREFIX}/users",
    tags=["users"],
    responses={404: {"description": "Not found"}},
)


@router.post("/login/")
async def login_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Database = Depends(database.encode_db),
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = await user_crud.authenticate(db, form_data.username, form_data.password)

    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    user_info = {"id": user.id, "email": user.email_address}

    access_token, refresh_token = await user_crud.create_access_token(user_info)

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/{user_id}/profile")
async def update_user_profile(
    user_id: str,
    profile_update: ProfileUpdate,
    db: Database = Depends(database.encode_db),
    user_data: AuthUser = Depends(login_required),
):
    """
    Update user profile based on provided user_id and profile_update data.
    Args:
        user_id (int): The ID of the user whose profile is being updated.
        profile_update (UserProfileUpdate): Updated profile data to apply.
    Returns:
        dict: Updated user profile information.
    Raises:
        HTTPException: If user with given user_id is not found in the database.
    """

    user = await user_crud.get_user_by_id(db, user_id)
    if user_data.id != user_id:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN,
            detail="You are not authorized to update profile",
        )

    if not user:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail="User not found")

    user = await user_crud.update_user_profile(db, user_id, profile_update)
    return Response(status_code=HTTPStatus.OK)
