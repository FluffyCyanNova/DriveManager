"""Per-account Google API client. Refresh tokens are decrypted only here, only in memory."""
from __future__ import annotations

import json
import logging
import threading
from datetime import timedelta

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import AuthorizedSession
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.config import get_settings
from app.core.encryption import decrypt
from app.core.time import utcnow

log = logging.getLogger(__name__)
TOKEN_URI = "https://oauth2.googleapis.com/token"

_cache: dict[str, tuple[str, object]] = {}   # account_id -> (access_token, expiry)
_lock = threading.Lock()


class ReauthRequired(Exception):
    """Refresh token revoked/expired. The account must be reconnected."""


class DriveApiError(Exception):
    def __init__(self, status: int, reason: str, message: str):
        super().__init__(message)
        self.status, self.reason, self.message = status, reason, message


def map_http_error(e: HttpError) -> DriveApiError:
    status = int(getattr(e.resp, "status", 500))
    reason, message = "unknown", str(e)
    try:
        err = json.loads(e.content.decode())["error"]
        message = err.get("message", message)
        reason = (err.get("errors") or [{}])[0].get("reason", err.get("status", reason))
    except Exception:
        pass
    return DriveApiError(status, reason, message)


def credentials_for(account) -> Credentials:
    s = get_settings()
    with _lock:
        tok = _cache.get(account.id)
    token, expiry = (tok if tok and tok[1] > utcnow() + timedelta(seconds=90) else (None, None))
    return Credentials(token=token, refresh_token=decrypt(account.encrypted_refresh_token), token_uri=TOKEN_URI,
                       client_id=s.google_client_id, client_secret=s.google_client_secret, scopes=s.scopes, expiry=expiry)


class DriveClient:
    def __init__(self, account):
        self.account_id = account.id
        self.creds = credentials_for(account)

    def _remember(self) -> None:
        if self.creds.token and self.creds.expiry:
            with _lock:
                _cache[self.account_id] = (self.creds.token, self.creds.expiry)

    def service(self):
        return build("drive", "v3", credentials=self.creds, cache_discovery=False)

    def session(self) -> AuthorizedSession:
        return AuthorizedSession(self.creds)

    def call(self, request):
        """Execute a googleapiclient request with retries and normalized errors."""
        try:
            return request.execute(num_retries=5)
        except HttpError as e:
            raise map_http_error(e) from None
        except RefreshError as e:
            forget(self.account_id)
            raise ReauthRequired(str(e)) from None
        finally:
            self._remember()

    def refresh_if_needed(self) -> None:
        """Used by raw-HTTP code paths: ensures a valid access token or raises ReauthRequired."""
        from google.auth.transport.requests import Request
        try:
            if not self.creds.valid:
                self.creds.refresh(Request())
        except RefreshError as e:
            forget(self.account_id)
            raise ReauthRequired(str(e)) from None
        self._remember()


def forget(account_id: str) -> None:
    with _lock:
        _cache.pop(account_id, None)
