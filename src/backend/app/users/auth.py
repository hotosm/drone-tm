"""Core logic for Google OAuth."""

import base64
import json
import logging

from itsdangerous import BadSignature, SignatureExpired
from itsdangerous.url_safe import URLSafeSerializer
from requests_oauthlib import OAuth2Session
from pydantic import BaseModel


log = logging.getLogger(__name__)


class Login(BaseModel):
    login_url: str


class Token(BaseModel):
    access_token: str


class Auth:
    """Main class for OSM login."""

    def __init__(
        self,
        authorization_url,
        token_url,
        client_id,
        client_secret,
        secret_key,
        login_redirect_uri,
        scope,
    ):
        """Set object params and get OAuth2 session."""
        self.authorization_url = authorization_url
        self.token_url = token_url
        self.client_secret = client_secret
        self.secret_key = secret_key
        self.oauth = OAuth2Session(
            client_id,
            redirect_uri=login_redirect_uri,
            scope=scope,
        )

    def login(self) -> dict:
        """Generate login URL from OSM session.

        Provides a login URL using the session created by osm
        client id and redirect uri supplied.

        Returns:
            dict: {'login_url': 'URL'}
        """
        login_url, _ = self.oauth.authorization_url(self.authorization_url)
        return json.loads(Login(login_url=login_url).model_dump_json())

    def callback(self, callback_url: str) -> str:
        """Performs token exchange between OSM and the callback website.

        Core will use Oauth secret key from configuration while deserializing token,
        provides access token that can be used for authorized endpoints.

        Args:
            callback_url(str): Absolute URL should be passed which
                is catched from login_redirect_uri.

        Returns:
            access_token(str): The decoded access token.
        """
        self.oauth.fetch_token(
            self.token_url,
            authorization_response=callback_url,
            client_secret=self.client_secret,
        )

        user_api_url = "https://www.googleapis.com/oauth2/v1/userinfo"
        resp = self.oauth.get(user_api_url)
        if resp.status_code != 200:
            raise ValueError("Invalid response from OSM")
        data = resp.json().get("user")
        serializer = URLSafeSerializer(self.secret_key)
        user_data = {
            "id": data.get("id"),
            "username": data.get("display_name"),
            "img_url": data.get("img").get("href") if data.get("img") else None,
        }
        token = serializer.dumps(user_data)
        access_token = base64.b64encode(bytes(token, "utf-8")).decode("utf-8")
        token = Token(access_token=access_token)
        return json.loads(token.model_dump_json())

    def deserialize_access_token(self, access_token: str) -> dict:
        """Returns the userdata as JSON from access token.

        Can be used for login required decorator or to check
        the access token provided.

        Args:
            access_token(str): The access token from Auth.callback()

        Returns:
            user_data(dict): A JSON of user data from OSM.
        """
        deserializer = URLSafeSerializer(self.secret_key)

        try:
            decoded_token = base64.b64decode(access_token)
        except Exception as e:
            log.error(e)
            log.error(f"Could not decode token: {access_token}")
            raise ValueError("Could not decode token") from e

        try:
            user_data = deserializer.loads(decoded_token)
        except (SignatureExpired, BadSignature) as e:
            log.error(e)
            raise ValueError("Auth token is invalid or expired") from e

        return user_data
