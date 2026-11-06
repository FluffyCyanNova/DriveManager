"""Google OAuth 2.0 web-server flow with PKCE. The code verifier lives in a signed, HttpOnly cookie, never in the URL."""
from __future__ import annotations

import os
import secrets

from google_auth_oauthlib.flow import Flow
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings
from app.core.exceptions import AppError

OAUTH_COOKIE = "dm_oauth"
_AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
_TOKEN_URI = "https://oauth2.googleapis.com/token"


def _serializer(s: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(s.app_secret_key, salt="oauth-state")


def _flow(s: Settings, state: str | None = None) -> Flow:
    if s.google_redirect_uri.startswith("http://"):
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"   # allowed by Google only for localhost redirect URIs
    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
    cfg = {"web": {"client_id": s.google_client_id, "client_secret": s.google_client_secret,
                   "auth_uri": _AUTH_URI, "token_uri": _TOKEN_URI, "redirect_uris": [s.google_redirect_uri]}}
    return Flow.from_client_config(cfg, scopes=s.scopes, redirect_uri=s.google_redirect_uri, state=state)


def begin(s: Settings, login_hint: str | None = None) -> tuple[str, str]:
    """Returns (authorization_url, signed_cookie_value)."""
    if not s.google_configured:
        raise AppError(400, "GOOGLE_NOT_CONFIGURED", "Google OAuth credentials are not configured. See docs/GOOGLE_OAUTH.md.")
    flow = _flow(s)
    flow.code_verifier = secrets.token_urlsafe(64)
    kwargs = {"access_type": "offline", "prompt": "consent", "include_granted_scopes": "false"}
    if login_hint:
        kwargs["login_hint"] = login_hint
    url, state = flow.authorization_url(**kwargs)
    return url, _serializer(s).dumps({"state": state, "verifier": flow.code_verifier})


def finish(s: Settings, cookie_value: str | None, state: str, code: str):
    """Validates state against the cookie and exchanges the code. Returns google Credentials."""
    if not cookie_value:
        raise AppError(400, "OAUTH_STATE_MISSING", "The sign-in attempt expired. Start the connection again.")
    try:
        data = _serializer(s).loads(cookie_value, max_age=600)
    except (BadSignature, SignatureExpired):
        raise AppError(400, "OAUTH_STATE_INVALID", "The sign-in attempt expired. Start the connection again.") from None
    if not secrets.compare_digest(data["state"], state):
        raise AppError(400, "OAUTH_STATE_MISMATCH", "Sign-in state did not match. Start the connection again.")
    flow = _flow(s, state=state)
    flow.code_verifier = data["verifier"]
    flow.fetch_token(code=code)
    return flow.credentials
