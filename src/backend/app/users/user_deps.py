from app.users.user_logic import verify_token
from fastapi import HTTPException, Request, Header
from app.config import settings
from app.users.auth import Auth
from app.users.user_schemas import AuthUser
from loguru import logger as log
from datetime import datetime, timedelta
import jwt
from aiosmtplib import send as send_email
from email.mime.text import MIMEText
from email.utils import formataddr


async def init_google_auth():
    """Initialise Auth object for google login"""

    return Auth(
        authorization_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://www.googleapis.com/oauth2/v4/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        secret_key=settings.SECRET_KEY,
        login_redirect_uri=settings.GOOGLE_LOGIN_REDIRECT_URI,
        scope=[
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
        ],
    )


async def login_required(
    request: Request, access_token: str = Header(None)
) -> AuthUser:
    """Dependency to inject into endpoints requiring login."""
    if settings.DEBUG:
        return AuthUser(
            id="6da91a51-5efd-40c9-a9c4-b66465a75fbe",
            email="admin@hotosm.org",
            name="admin",
            profile_img="",
        )

    if not access_token:
        raise HTTPException(status_code=401, detail="No access token provided")

    if not access_token:
        raise HTTPException(status_code=401, detail="No access token provided")

    try:
        user = verify_token(access_token)
    except HTTPException as e:
        log.error(e)
        log.error("Failed to verify access token")
        raise HTTPException(status_code=401, detail="Access token not valid") from e

    return AuthUser(**user)


def create_reset_password_token(email: str):
    expire = datetime.now() + timedelta(
        minutes=settings.RESET_PASSWORD_TOKEN_EXPIRE_MINUTES
    )
    to_encode = {"sub": email, "exp": expire}
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


async def send_reset_password_email(email: str, token: str):
    reset_link = f"{settings.FRONTEND_URL}/forgot-password?token={token}"
    message = MIMEText(
        f"Please use the following link to reset your password: {reset_link}", "html"
    )
    message["From"] = formataddr(
        (settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL)
    )
    message["To"] = email
    message["Subject"] = "Password Reset Request"

    await send_email(
        message,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER,
        password=settings.SMTP_PASSWORD,
        start_tls=settings.SMTP_TLS,
    )
