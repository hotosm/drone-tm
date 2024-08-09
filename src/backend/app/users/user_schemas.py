from pydantic import BaseModel, EmailStr, ValidationInfo, Field
from pydantic.functional_validators import field_validator
from typing import Optional
from app.models.enums import UserRole
from psycopg import Connection
import uuid
from psycopg.rows import class_row
import psycopg
from fastapi import HTTPException

class AuthUser(BaseModel):
    """The user model returned from Google OAuth2."""

    id: str
    email: EmailStr
    name: str
    img_url: Optional[str] = None


class UserBase(BaseModel):
    email_address: EmailStr
    is_active: bool = True
    is_superuser: bool = False
    name: str


class User(BaseModel):
    email_address: EmailStr
    is_active: bool
    is_superuser: bool
    name: str


# Contents of JWT token
class TokenPayload(BaseModel):
    sub: int | None = None


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserPublic(UserBase):
    pass


class UserRegister(BaseModel):
    username: str = Field(min_length=4)
    email_address: EmailStr
    password: str
    name: str

    @field_validator("name", mode="before")
    @classmethod
    def not_empty(cls, v: str, info: ValidationInfo):
        if v is not None and v == "":
            raise ValueError(f"{info.field_name} cannot be empty")
        return v

    @field_validator("password", mode="before")
    def password_complexity(cls, v: str, info: ValidationInfo):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        # TODO: Add them if required
        # if not re.search(r'[A-Z]', v):
        #     raise ValueError('Password must contain at least one uppercase letter')
        # if not re.search(r'[a-z]', v):
        #     raise ValueError('Password must contain at least one lowercase letter')
        # if not re.search(r'[0-9]', v):
        #     raise ValueError('Password must contain at least one digit')
        # if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
        #     raise ValueError('Password must contain at least one special character')
        return v


class UserCreate(UserBase):
    password: str


class ProfileUpdate(BaseModel):
    phone_number: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    organization_name: Optional[str] = None
    organization_address: Optional[str] = None
    job_title: Optional[str] = None
    notify_for_projects_within_km: Optional[int] = None
    drone_you_own: Optional[str] = None
    experience_years: Optional[int] = None
    certified_drone_operator: Optional[bool] = False
    role: Optional[UserRole] = None
    password: Optional[str] = None

    @field_validator("role", mode="after")
    @classmethod
    def integer_role_to_string(cls, value: UserRole) -> str:
        return str(value.name)


class DbUser(BaseModel):
    id: str
    email_address: EmailStr
    is_active: bool
    is_superuser: bool
    name: str
    profile_img: Optional[str] = None

    @staticmethod
    async def get_or_create_user(db: Connection, user_data: AuthUser):
        """Get user from User table if exists, else create."""
        async with db.cursor(row_factory=class_row(DbUser)) as cur:
            try:
                await cur.execute(
                    """
                    INSERT INTO users (
                        id, name, email_address, profile_img, is_active, is_superuser, date_registered
                    )
                    VALUES (
                        %(user_id)s, %(name)s, %(email_address)s, %(profile_img)s, True, False, now()
                    )
                    ON CONFLICT (id)
                    DO UPDATE SET profile_img = EXCLUDED.profile_img
                    RETURNING *;
                    """,
                    {
                        "user_id": str(user_data.id),
                        "name": user_data.name,
                        "email_address": user_data.email,
                        "profile_img": user_data.img_url,
                    },
                )
                user = await cur.fetchone()
                return user

            except psycopg.IntegrityError as e:
                if (
                    'duplicate key value violates unique constraint "users_email_address_key"'
                    in str(e)
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"User with this email {user_data.email} already exists.",
                    ) from e
                else:
                    raise HTTPException(status_code=400, detail=str(e)) from e