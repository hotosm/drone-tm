from typing import Any, List
from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import Annotated
from fastapi.security import OAuth2PasswordRequestForm
from app.users.user_schemas import Token, UserPublic, UserRegister
from app.users.user_deps import CurrentUser
from app.config import settings
from app.users import user_crud
from app.db import database
from databases import Database
from app.users import user_schemas
from app.config import settings

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

    access_token, refresh_token = user_crud.create_access_token(user_info)

    return Token(access_token=access_token, refresh_token=refresh_token)

# @router.post("/login/")
# def login_access_token(
#     form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
#     db: Session = Depends(database.get_db),
# ) -> Token:
#     """
#     OAuth2 compatible token login, get an access token for future requests
#     """
#     user = user_crud.authenticate(db, form_data.username, form_data.password)

#     if not user:
#         raise HTTPException(status_code=400, detail="Incorrect email or password")
#     elif not user.is_active:
#         raise HTTPException(status_code=400, detail="Inactive user")
#     access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
#     refresh_token_expires = timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES)

#     access_token, refresh_token = user_crud.create_access_token(
#         user.id,
#         expires_delta=access_token_expires,
#         refresh_token_expiry=refresh_token_expires,
#     )
#     return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/signup", response_model=UserPublic)
async def register_user(
    user_in: UserRegister,
    db: Database = Depends(database.encode_db),
):
    """
    Create new user without the need to be logged in.
    """
    user = await user_crud.get_user_email(db, user_in.email_address)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system",
        )
    user = await user_crud.get_user_username(db, user_in.username)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system",
        )
    user = await user_crud.create_user(db, user_in)
    return user


@router.get("/refresh_token")
def update_token(current_user: CurrentUser):
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES)

    access_token, refresh_token = user_crud.create_access_token(
        current_user.id,
        expires_delta=access_token_expires,
        refresh_token_expiry=refresh_token_expires,
    )
    return Token(access_token=access_token, refresh_token=refresh_token)


@router.get("/me", response_model=UserPublic)
def read_user_me(current_user: CurrentUser) -> Any:
    """
    Get current user.
    """
    return current_user
