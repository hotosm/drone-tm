import secrets
from functools import lru_cache
from pydantic import (
    BeforeValidator,
    TypeAdapter,
    ValidationInfo,
    field_validator,
    computed_field,
    EmailStr,
)
from pydantic_settings import BaseSettings
from typing import Annotated, Optional, Union, Any
from pydantic.networks import HttpUrl, PostgresDsn


HttpUrlStr = Annotated[
    str,
    BeforeValidator(
        lambda value: str(TypeAdapter(HttpUrl).validate_python(value) if value else "")
    ),
]


class Settings(BaseSettings):
    """Main settings class, defining environment variables."""

    APP_NAME: str = "Drone Tasking Manager"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    EXTRA_CORS_ORIGINS: Optional[Union[str, list[str]]] = []

    @field_validator("EXTRA_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(
        cls,
        val: Union[str, list[str]],
        info: ValidationInfo,
    ) -> Union[list[str], str]:
        """Build and validate CORS origins list.

        By default, the provided frontend URLs are included in the origins list.
        If this variable used, the provided urls are appended to the list.
        """
        default_origins = []

        if val is None:
            return default_origins

        if isinstance(val, str):
            default_origins += [i.strip() for i in val.split(",")]
            return default_origins

        elif isinstance(val, list):
            default_origins += val
            return default_origins

    API_PREFIX: str = "/api"
    SECRET_KEY: str = secrets.token_urlsafe(32)

    POSTGRES_HOST: Optional[str] = "db"
    POSTGRES_USER: Optional[str] = "dtm"
    POSTGRES_PASSWORD: Optional[str] = "dtm"
    POSTGRES_DB: Optional[str] = "dtm_db"

    DTM_DB_URL: Optional[PostgresDsn] = None

    @field_validator("DTM_DB_URL", mode="after")
    @classmethod
    def assemble_db_connection(cls, v: Optional[str], info: ValidationInfo) -> Any:
        """Build Postgres connection from environment variables."""
        if isinstance(v, str):
            return v
        pg_url = PostgresDsn.build(
            scheme="postgresql",
            username=info.data.get("POSTGRES_USER"),
            password=info.data.get("POSTGRES_PASSWORD"),
            host=info.data.get("POSTGRES_HOST"),
            path=info.data.get("POSTGRES_DB", ""),
        )
        return pg_url

    SITE_URL: str
    S3_ENDPOINT: str = "http://s3:9000"
    S3_ACCESS_KEY: Optional[str] = ""
    S3_SECRET_KEY: Optional[str] = ""
    S3_BUCKET_NAME: str = "dtm-data"
    S3_DOWNLOAD_ROOT: Optional[str] = None

    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 60 * 24 * 1  # 1 day
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 60 * 24 * 8  # 8 day

    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    GOOGLE_LOGIN_REDIRECT_URI: str = "http://localhost:8000"

    # SMTP Configurations
    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: Optional[str] = None
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    EMAILS_FROM_EMAIL: Optional[EmailStr] = None
    EMAILS_FROM_NAME: Optional[str] = "Drone Tasking Manager"

    @computed_field
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)


@lru_cache
def get_settings():
    """Cache settings when accessed throughout app."""
    _settings = Settings()
    if _settings.DEBUG:
        print(f"Loaded settings: {_settings.model_dump()}")
    return _settings


settings = get_settings()
