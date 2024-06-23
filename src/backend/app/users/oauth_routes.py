from loguru import logger as log
from fastapi import Depends
from app.users.user_routes import router
from fastapi.responses import JSONResponse
from app.users.user_deps import init_google_auth


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
