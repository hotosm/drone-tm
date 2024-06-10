from pydantic import BaseModel
from typing import Optional


class UserBase(BaseModel):
    username: str
    email_address: str
    is_active: bool = False
    is_superuser: bool = False
    name: str


class User(BaseModel):
    email_address: str
    is_active: bool = True
    is_superuser: bool = False
    name: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    id: int
    email_address: str
    name: str
    is_active: bool
    is_superuser: bool


class UserRegister(BaseModel):
    username: str
    email_address: str
    password: str
    name: Optional[str] = None


class UserCreate(UserBase):
    password: str
