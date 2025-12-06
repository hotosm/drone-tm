from enum import Enum
import os
import base64
import secrets
from functools import lru_cache
from typing import Annotated, Any, Optional, Union

import bcrypt
from loguru import logger as log
from pydantic import (
    BeforeValidator,
    Field,
    EmailStr,
    TypeAdapter,
    ValidationInfo,
    computed_field,
    field_validator,
)
from pydantic.networks import HttpUrl, PostgresDsn
from pydantic_settings import BaseSettings
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HttpUrlStr = Annotated[
    str,
    BeforeValidator(
        lambda value: str(TypeAdapter(HttpUrl).validate_python(value) if value else "")
    ),
]


class MonitoringTypes(str, Enum):
    """Configuration options for monitoring."""

    NONE = ""
    SENTRY = "sentry"


class OtelSettings(BaseSettings):
    """Inherited OpenTelemetry specific settings (monitoring).

    These mostly set environment variables set by the OTEL SDK.
    """

    SITE_NAME: Optional[str] = Field(exclude=True)
    LOG_LEVEL: Optional[str] = Field(exclude=True)

    @computed_field
    @property
    def otel_log_level(self) -> Optional[str]:
        """Set OpenTelemetry log level."""
        if self.LOG_LEVEL:
            log_level = self.LOG_LEVEL.lower()
            # NOTE setting to DEBUG makes very verbose for every library
            os.environ["OTEL_LOG_LEVEL"] = log_level
        return log_level

    @computed_field
    @property
    def otel_service_name(self) -> Optional[HttpUrlStr]:
        """Set OpenTelemetry service name for traces."""
        service_name = "unknown"
        if self.SITE_NAME:
            # Return name with underscores
            service_name = self.SITE_NAME.lower().replace(" ", "-")
            # Export to environment for OTEL instrumentation
            os.environ["OTEL_SERVICE_NAME"] = service_name
        return service_name

    @computed_field
    @property
    def otel_python_excluded_urls(self) -> Optional[str]:
        """Set excluded URLs for Python instrumentation."""
        endpoints = "__lbheartbeat__,docs,openapi.json"
        os.environ["OTEL_PYTHON_EXCLUDED_URLS"] = endpoints

        return endpoints

    @computed_field
    @property
    def otel_python_log_correlation(self) -> Optional[str]:
        """Set log correlation for OpenTelemetry Python spans."""
        value = "true"
        os.environ["OTEL_PYTHON_LOG_CORRELATION"] = value
        return value


class SentrySettings(OtelSettings):
    """Optional Sentry OpenTelemetry specific settings (monitoring)."""

    SENTRY_DSN: HttpUrlStr


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

    API_PREFIX: str = ""
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

    FRONTEND_URL: str = "http://localhost:3040"
    BACKEND_URL: str = "http://localhost:8000"
    NODE_ODM_URL: Optional[str] = "http://nodeodm:9900"
    REDIS_DSN: str = "redis://redis:6379/0"

    S3_ENDPOINT: str = "http://minio:9000"
    S3_ACCESS_KEY: Optional[str] = ""
    S3_SECRET_KEY: Optional[str] = ""
    S3_BUCKET_NAME: str = "dtm-bucket"
    S3_DOWNLOAD_ROOT: Optional[str] = None

    JAXA_AUTH_TOKEN: Optional[str] = ""

    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 60 * 24 * 1  # 1 day
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 60 * 24 * 8  # 8 day
    RESET_PASSWORD_TOKEN_EXPIRE_MINUTES: int = 5

    # Authentication Provider Switch
    # Options: "legacy" (Google OAuth) or "hanko" (Hanko SSO)
    AUTH_PROVIDER: str = "legacy"

    # Legacy Google OAuth (when AUTH_PROVIDER="legacy")
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_LOGIN_REDIRECT_URI: str = "http://localhost:8000"

    # Hanko SSO (when AUTH_PROVIDER="hanko")
    HANKO_API_URL: Optional[str] = None
    COOKIE_SECRET: Optional[str] = None
    COOKIE_DOMAIN: Optional[str] = None

    MONITORING: Optional[MonitoringTypes] = None

    @computed_field
    @property
    def monitoring_config(self) -> Optional[SentrySettings]:
        """Get the monitoring configuration."""
        if self.MONITORING == MonitoringTypes.SENTRY:
            return SentrySettings()

        return None

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
        log.info(f"Loaded settings: {_settings.model_dump()}")
    return _settings


settings = get_settings()


def derive_encryption_key(user_id: str):
    """Derives a unique encryption key for each user.
    A salt is added to the hashing process to force their uniqueness, increase complexity without
    increasing user requirements, and mitigate password attacks like hash tables
    """
    salt = settings.SECRET_KEY.encode()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,  # 32 bytes = 256 bits (valid for AES-256)
        salt=salt,
        iterations=100000,
    )
    return kdf.derive(user_id.encode())  # Return raw key bytes


def encrypt_token(user_id: str, token: str):
    """Encrypts an API token using AES-GCM encryption with a user-specific key.

    The function generates a random 12-byte IV (Initialization Vector) and encrypts
    the token.
    The resulting data (IV + tag + ciphertext) is base64-encoded for safe storage or transmission.

    Args:
        user_id (str): The unique identifier of the user.
        oam_api_token (str): The API token to be encrypted.

    Returns:
        str: The encrypted API token, base64-encoded.
    """
    key = derive_encryption_key(user_id)  # Ensure key is raw bytes
    iv = os.urandom(12)  # AES-GCM requires a 12-byte IV
    cipher = Cipher(algorithms.AES(key), modes.GCM(iv))
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(token.encode()) + encryptor.finalize()

    # Combine IV, tag, and ciphertext, then base64 encode for storage
    encrypted_data = iv + encryptor.tag + ciphertext
    return base64.b64encode(encrypted_data).decode()


def decrypt_token(user_id: str, encrypted_token: str):
    """Decrypts an API token encrypted with AES-GCM using the user-specific key.

    The function decodes the base64-encoded encrypted data, extracts the IV,
    authentication tag, and ciphertext, then decrypts the data to retrieve
    the original API token.

    Args:
        user_id (str): The unique identifier of the user.
        encrypted_token (str): The base64-encoded encrypted API token from the database.

    Returns:
        str: The decrypted API token in plaintext.
    """
    key = derive_encryption_key(user_id)
    data = base64.b64decode(encrypted_token)

    iv, tag, ciphertext = data[:12], data[12:28], data[28:]

    cipher = Cipher(algorithms.AES(key), modes.GCM(iv, tag))
    decryptor = cipher.decryptor()

    decrypted_data = decryptor.update(ciphertext) + decryptor.finalize()
    return decrypted_data.decode()


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed_password.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )
