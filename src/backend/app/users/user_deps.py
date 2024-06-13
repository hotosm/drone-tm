import jwt
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy.orm import Session
from app.config import settings
from app.db import database
from app.users import user_crud, user_schemas
from app.db.db_models import DbUser


reusable_oauth2 = OAuth2PasswordBearer(tokenUrl=f"{settings.API_PREFIX}/users/login")


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
