from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import Annotated
from fastapi.security import OAuth2PasswordRequestForm
from app.users.user_schemas import Token
from app.config import settings
from app.users import user_crud

router = APIRouter(
    prefix="/projects",
    tags=["users"],
    responses={404: {"description": "Not found"}},
)


@router.post("/login/access-token")
def login_access_token(
    session: Session, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = user_crud.authenticate(
        session=session, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return Token(
        access_token=user_crud.create_access_token(
            user.id, expires_delta=access_token_expires
        )
    )
