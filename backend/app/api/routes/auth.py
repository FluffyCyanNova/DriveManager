from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import COOKIE, check_origin, client_ip, require_auth
from app.config import get_settings
from app.core.exceptions import AppError
from app.core.security import burn_verify, hash_password, login_throttle, safe_equals, verify_password
from app.database.database import get_db
from app.database.models import LocalSession
from app.database.repositories.settings import get_setting, set_setting
from app.services import sessions

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str = Field(max_length=200)
    password: str = Field(max_length=1000)


class PasswordBody(BaseModel):
    current_password: str = Field(max_length=1000)
    new_password: str = Field(min_length=10, max_length=1000)


def current_hash(db: Session) -> str:
    return get_setting(db, "password_hash") or get_settings().app_password_hash


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=s.cookie_secure,
                        max_age=s.session_absolute_days * 86400, path="/")


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    check_origin(request)
    s = get_settings()
    ip = client_ip(request)
    wait = login_throttle.blocked(ip)
    if wait:
        raise AppError(429, "TOO_MANY_ATTEMPTS", f"Too many failed sign-ins. Try again in {wait // 60 + 1} minute(s).")
    h = current_hash(db)
    if not h:
        raise AppError(500, "NOT_CONFIGURED", "No password is configured. Run scripts\\setup.ps1.")
    user_ok = safe_equals(body.username, s.app_username)
    if user_ok:
        pw_ok = verify_password(h, body.password)
    else:
        burn_verify(body.password)
        pw_ok = False
    if not (user_ok and pw_ok):
        login_throttle.fail(ip)
        raise AppError(401, "BAD_CREDENTIALS", "Incorrect username or password.")
    login_throttle.reset(ip)
    token, row = sessions.create(db, ip, request.headers.get("user-agent"))
    _set_cookie(response, token)
    return {"username": s.app_username, "csrf_token": row.csrf_token}


@router.get("/session")
def session(request: Request, db: Session = Depends(get_db)):
    row = sessions.get_valid(db, request.cookies.get(COOKIE))
    if not row:
        return {"authenticated": False}
    return {"authenticated": True, "username": get_settings().app_username, "csrf_token": row.csrf_token}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db), _: LocalSession = Depends(require_auth)):
    sessions.destroy(db, request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/change-password")
def change_password(body: PasswordBody, db: Session = Depends(get_db), sess: LocalSession = Depends(require_auth)):
    if not verify_password(current_hash(db), body.current_password):
        raise AppError(400, "BAD_PASSWORD", "Current password is incorrect.")
    set_setting(db, "password_hash", hash_password(body.new_password))
    sessions.destroy_all(db, except_id=sess.id)   # sign out every other browser
    return {"ok": True}
