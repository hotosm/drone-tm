import uuid
import base64
from app.models.enums import HTTPStatus, State, UserRole
from pydantic import BaseModel, EmailStr, ValidationInfo, Field, model_validator
from pydantic.functional_validators import field_validator
from typing import List, Optional
from psycopg import Connection
from psycopg.rows import class_row
import psycopg
from fastapi import HTTPException
from typing import Any
from loguru import logger as log
from app.users import user_logic
from psycopg.rows import dict_row
from app.s3 import is_connection_secure, s3_client
from app.config import settings


class AuthUser(BaseModel):
    """The user model returned from Google OAuth2."""

    id: str
    email: EmailStr
    name: str
    profile_img: Optional[str] = None
    role: str = None


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
    role: str


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


class BaseUserProfile(BaseModel):
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
    role: Optional[List[UserRole]] = None
    certificate_file: Optional[str] = None
    registration_file: Optional[str] = None
    certificate_url: Optional[str] = None
    registration_certificate_url: Optional[str] = None

    @model_validator(mode="after")
    def set_urls(cls, values):
        """Set and format certificate and registration URLs."""
        bucket_name = settings.S3_BUCKET_NAME
        endpoint, is_secure = is_connection_secure(settings.S3_ENDPOINT)
        protocol = "https" if is_secure else "http"

        def format_url(url):
            if url:
                url = url if url.startswith("/") else f"/{url}"
                return f"{protocol}://{endpoint}/{bucket_name}{url}"
            return url

        values.certificate_url = format_url(values.certificate_url)
        values.registration_certificate_url = format_url(
            values.registration_certificate_url
        )

        return values

    @field_validator("role", mode="after")
    @classmethod
    def integer_role_to_string(cls, value: UserRole):
        if isinstance(value, list):
            value = [str(role.name) for role in value]

        if isinstance(value, int):
            value = UserRole(value)

        unique_roles = set(value)
        value = list(unique_roles)
        return value

    @field_validator("role", mode="before")
    @classmethod
    def srting_role_to_integer(cls, value: UserRole) -> str:
        if isinstance(value, str):
            role_list = value.strip("{}").split(",")
            value = [
                UserRole[role.strip()].value
                for role in role_list
                if role.strip() in UserRole.__members__
            ]
        return value


class UserProfileCreate(BaseUserProfile):
    password: str


class UserProfileUpdate(BaseUserProfile):
    old_password: Optional[str] = None
    password: Optional[str] = None


class DbUserProfile(BaseUserProfile):
    """UserProfile model for interacting with the user_profile table."""

    user_id: int

    @staticmethod
    async def _handle_file_upload(profile: UserProfileCreate, user_id: int):
        """
        Handle file uploads (certificate and registration) and return presigned URLs and S3 paths.

        Args:
            profile (UserProfileCreate): The user profile containing file fields.
            user_id (int): The user's ID.

        Returns:
            dict: A dictionary with presigned URLs and S3 paths for each file type.
        """
        result = {}

        file_paths = {
            "certificate_file": f"dtm-data/users/{user_id}/certificate/{profile.certificate_file}",
            "registration_file": f"dtm-data/users/{user_id}/registration/{profile.registration_file}",
        }

        for file_type, s3_path in file_paths.items():
            file_name = getattr(profile, file_type, None)
            if file_name:
                try:
                    client = s3_client()
                    presigned_url = client.get_presigned_url(
                        "PUT", settings.S3_BUCKET_NAME, s3_path
                    )
                    result[file_type] = {
                        "presigned_url": presigned_url,
                        "s3_path": s3_path,
                    }
                except Exception as e:
                    log.error(f"Failed to generate presigned URL for {file_type}: {e}")
                    result[file_type] = {"error": str(e)}

        return result

    @staticmethod
    async def _update_roles(db: Connection, user_id: int, new_roles: Optional[list]):
        """Update the roles of the user in the database."""
        if new_roles is not None:
            role_update_query = """
                UPDATE user_profile
                SET role = (
                    SELECT ARRAY(
                        SELECT DISTINCT unnest(array_cat(role, %s))
                    )
                )
                WHERE user_id = %s;
            """
            async with db.cursor() as cur:
                await cur.execute(role_update_query, (new_roles, user_id))

    @staticmethod
    async def create(db: Connection, user_id: int, profile_create: UserProfileCreate):
        """Create a new user profile."""
        model_data = profile_create.model_dump(exclude_none=True, exclude={"password"})

        field_mapping = {
            "certificate_file": "certificate_url",
            "registration_file": "registration_certificate_url",
        }

        results = await DbUserProfile._handle_file_upload(profile_create, user_id)
        for file_type, file_data in results.items():
            if file_data.get("s3_path"):
                model_data[field_mapping[file_type]] = file_data["s3_path"]

        model_data.pop("certificate_file", None)
        model_data.pop("registration_file", None)

        # Prepare the SQL query for inserting the new profile
        columns = ", ".join(model_data.keys())
        value_placeholders = ", ".join(f"%({key})s" for key in model_data.keys())
        sql = f"""
            INSERT INTO user_profile (user_id, {columns})
            VALUES (%(user_id)s, {value_placeholders})
            RETURNING *;
        """

        model_data["user_id"] = user_id

        async with db.cursor() as cur:
            await cur.execute(sql, model_data)

            if profile_create.password:
                password_update_query = """
                    UPDATE users
                    SET password = %(password)s
                    WHERE id = %(user_id)s;
                """
                hashed_password = user_logic.get_password_hash(profile_create.password)
                await cur.execute(
                    password_update_query,
                    {"password": hashed_password, "user_id": user_id},
                )

        for file_type, url_key in field_mapping.items():
            if results.get(file_type):
                model_data[url_key] = results[file_type].get("presigned_url")

        return model_data

    @staticmethod
    async def update(db: Connection, user_id: int, profile_update: UserProfileUpdate):
        """Update or insert a user profile."""
        field_mapping = {
            "certificate_file": "certificate_url",
            "registration_file": "registration_certificate_url",
        }

        model_data = profile_update.model_dump(
            exclude_none=True, exclude={"password", "old_password", "certificate_file"}
        )
        results = await DbUserProfile._handle_file_upload(profile_update, user_id)
        for file_type, file_data in results.items():
            if file_data.get("s3_path"):
                model_data[field_mapping[file_type]] = file_data["s3_path"]

        model_data.pop("certificate_file", None)
        model_data.pop("registration_file", None)

        await DbUserProfile._update_roles(db, user_id, model_data.get("role"))

        # Prepare the columns and placeholders for the main update
        columns = ", ".join(model_data.keys())

        value_placeholders = ", ".join(f"%({key})s" for key in model_data.keys())
        sql = f"""
            INSERT INTO user_profile (
                user_id, {columns}
            )
            VALUES (
                %(user_id)s, {value_placeholders}
            )
            ON CONFLICT (user_id)
            DO UPDATE SET
                {", ".join(f"{key} = EXCLUDED.{key}" for key in model_data.keys())};
        """

        # Prepare password update query if a new password is provided
        password_update_query = """
            UPDATE users
            SET password = %(password)s
            WHERE id = %(user_id)s;
        """

        model_data["user_id"] = user_id

        async with db.cursor() as cur:
            await cur.execute(sql, model_data)

            if profile_update.password:
                # Update password if provided
                await cur.execute(
                    password_update_query,
                    {
                        "password": user_logic.get_password_hash(
                            profile_update.password
                        ),
                        "user_id": user_id,
                    },
                )
        for file_type, url_key in field_mapping.items():
            if results.get(file_type):
                model_data[url_key] = results[file_type].get("presigned_url")

        return model_data

    async def get_userprofile_by_userid(db: Connection, user_id: str):
        """Fetch the user profile by user ID."""
        query = """
            SELECT * FROM user_profile
            WHERE user_id = %(user_id)s
            LIMIT 1;
        """
        async with db.cursor(row_factory=class_row(DbUserProfile)) as cur:
            await cur.execute(query, {"user_id": user_id})
            result = await cur.fetchone()
            log.info(f"Fetched user profile data: {result}")
            return result


class DbUser(BaseModel):
    id: str
    email_address: EmailStr
    is_active: bool
    is_superuser: bool
    name: str
    profile_img: Optional[str] = None

    @staticmethod
    async def all(db: Connection):
        "Fetch  all users."
        async with db.cursor(row_factory=class_row(DbUser)) as cur:
            await cur.execute(
                """
                SELECT * FROM users;
                """
            )
            return await cur.fetchall()

    @staticmethod
    async def one(db: Connection, user_id: str):
        """Fetch user from the database by user_id."""
        async with db.cursor(row_factory=class_row(DbUser)) as cur:
            await cur.execute(
                """
                SELECT * FROM users WHERE id = %(user_id)s;
                """,
                {"user_id": user_id},
            )
            return await cur.fetchone()

    @staticmethod
    async def create(db: Connection, user_data: AuthUser):
        """Create a new user in the database."""
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
                    RETURNING *;
                    """,
                    {
                        "user_id": str(user_data.id),
                        "name": user_data.name,
                        "email_address": user_data.email,
                        "profile_img": user_data.profile_img,
                    },
                )
                return await cur.fetchone()

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

    @staticmethod
    async def get_or_create_user(db: Connection, user_data: AuthUser):
        """Get user from User table if exists, else create."""
        user = await DbUser.one(db, str(user_data.id))
        if user:
            return user
        return await DbUser.create(db, user_data)

    @staticmethod
    async def get_user_by_id(db: Connection, id: str) -> dict[str, Any] | None:
        query = "SELECT * FROM users WHERE id = %s LIMIT 1;"
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, (id,))
            result = await cur.fetchone()
            return result if result else None

    @staticmethod
    async def get_user_by_email(db: Connection, email: str) -> dict[str, Any]:
        query = "SELECT * FROM users WHERE email_address = %s LIMIT 1;"
        try:
            async with db.cursor(row_factory=dict_row) as cur:
                await cur.execute(query, (email,))
                result = await cur.fetchone()
                if not result:
                    return None

                return result
        except Exception as e:
            raise HTTPException(
                status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                detail=str(e),
            )

    @staticmethod
    async def get_requested_user_id(
        db: Connection, project_id: uuid.UUID, task_id: uuid.UUID, current_state: State
    ):
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT user_id
                FROM task_events
                WHERE project_id = %(project_id)s
                    AND task_id = %(task_id)s
                    AND state = %(current_state)s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                {
                    "project_id": str(project_id),
                    "task_id": str(task_id),
                    "current_state": current_state.name,
                },
            )

            result = await cur.fetchone()
            if result is None:
                raise ValueError("No user requested for mapping")
            return result["user_id"]


class Base64Request(BaseModel):
    token: str

    @field_validator("token")
    def validate_base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
            return value
        except Exception:
            raise ValueError("Invalid Base64 string")
