from pydantic import BaseModel, EmailStr, ValidationInfo, Field
from pydantic.functional_validators import field_validator
from typing import Optional
from app.models.enums import UserRole


class AuthUser(BaseModel):
    """The user model returned from Google OAuth2."""

    id: str
    email: EmailStr
    name: str
    img_url: Optional[str] = None


class UserBase(BaseModel):
    username: str
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
    role: Optional[UserRole] = UserRole.DRONE_PILOT
    password: Optional[str] = None

    @field_validator("role", mode="after")
    @classmethod
    def integer_role_to_string(cls, value: UserRole) -> str:
        return str(value.name)
