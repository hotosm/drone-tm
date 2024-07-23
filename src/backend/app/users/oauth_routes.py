import os
from loguru import logger as log
from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from app.db import database
from app.users.user_routes import router
from app.users.user_deps import init_google_auth, login_required
from app.users.user_schemas import AuthUser, Token
from app.users import user_crud
from app.config import settings
from databases import Database


if settings.DEBUG:
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"


@router.get("/google-login")
async def login_url(google_auth=Depends(init_google_auth)):
    """Get Login URL for Google Oauth Application.

    The application must be registered on google oauth.
    Open the download url returned to get access_token.

    Args:
        request: The GET request.
        google_auth: The Auth object.

    Returns:
        login_url (string): URL to authorize user in Google OAuth.
            Includes URL params: client_id, redirect_uri, permission scope.
    """
    login_url = google_auth.login()
    log.debug(f"Login URL returned: {login_url}")
    return JSONResponse(content=login_url, status_code=200)


@router.get("/callback/")
async def callback(request: Request, google_auth=Depends(init_google_auth)):
    """Performs token exchange between Google and DTM API"""

    callback_url = str(request.url)
    access_token = google_auth.callback(callback_url).get("access_token")

    user_data = google_auth.deserialize_access_token(access_token)
    access_token, refresh_token = await user_crud.create_access_token(user_data)

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.get("/refresh-token", response_model=Token)
async def update_token(user_data: AuthUser = Depends(login_required)):
    """Refresh access token"""

    access_token, refresh_token = await user_crud.create_access_token(
        user_data.model_dump()
    )
    return Token(access_token=access_token, refresh_token=refresh_token)


@router.get("/my-info/")
async def my_data(
    db: Database = Depends(database.encode_db),
    user_data: AuthUser = Depends(login_required),
):
    """Read access token and get user details from Google"""

    user_info = await user_crud.get_or_create_user(db, user_data)
    has_user_profile = await user_crud.get_userprofile_by_userid(db, user_info.id)

    user_info_dict = user_info.model_dump()
    user_info_dict["has_user_profile"] = bool(has_user_profile)
    return user_info_dict
