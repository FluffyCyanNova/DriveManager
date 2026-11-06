from __future__ import annotations

from urllib.parse import urlparse

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import AppError
from app.core.security import safe_equals
from app.database.database import get_db
from app.database.models import LocalSession
from app.services import sessions

COOKIE = "dm_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def origin_allowed(origin: str | None, host: str | None) -> bool:
    """Browsers always send Origin on cross-site and unsafe requests; it must match our Host or the allow-list."""
    if not origin:
        return True
    if origin.rstrip("/") in get_settings().extra_origins:
        return True
    return bool(host) and urlparse(origin).netloc == host


def check_origin(request: Request) -> None:
    if not origin_allowed(request.headers.get("origin"), request.headers.get("host")):
        raise AppError(403, "BAD_ORIGIN", "Request origin is not allowed.")


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def require_auth(request: Request, db: Session = Depends(get_db)) -> LocalSession:
    row = sessions.get_valid(db, request.cookies.get(COOKIE))
    if not row:
        raise AppError(401, "UNAUTHENTICATED", "Please sign in.")
    if request.method not in SAFE_METHODS:
        check_origin(request)
        if not safe_equals(request.headers.get("x-csrf-token", ""), row.csrf_token):
            raise AppError(403, "CSRF", "Security token missing or invalid. Reload the page and try again.")
    return row
