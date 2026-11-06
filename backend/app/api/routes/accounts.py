from __future__ import annotations

import logging
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import COOKIE, require_auth
from app.config import get_settings
from app.core.exceptions import AppError
from app.database.database import get_db
from app.database.models import Account
from app.integrations.google_drive import oauth
from app.services import accounts, quota, sessions

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/accounts", tags=["accounts"], dependencies=[Depends(require_auth)])
callback_router = APIRouter(tags=["oauth"])


class StartBody(BaseModel):
    reconnect_account_id: str | None = None


@router.get("")
def list_accounts(db: Session = Depends(get_db)):
    return [accounts.account_dict(db, a) for a in db.scalars(select(Account).order_by(Account.email))]


@router.post("/oauth/start")
def oauth_start(body: StartBody, request: Request, response: Response, db: Session = Depends(get_db)):
    s = get_settings()
    want = urlparse(s.google_redirect_uri).netloc
    have = request.headers.get("host", "")
    if want != have:
        raise AppError(400, "WRONG_ADDRESS", f"Open DriveManager at {urlparse(s.google_redirect_uri).scheme}://{want} to connect accounts. "
                       f"Google only sends you back to the address registered as the redirect URI (you are on {have}).")
    hint = None
    if body.reconnect_account_id:
        hint = accounts.get_account(db, body.reconnect_account_id, require_active=False).email
    url, cookie = oauth.begin(s, hint)
    response.set_cookie(oauth.OAUTH_COOKIE, cookie, max_age=600, httponly=True, samesite="lax", secure=s.cookie_secure, path="/auth/google")
    return {"authorization_url": url}


@router.get("/{account_id}")
def get_account(account_id: str, db: Session = Depends(get_db)):
    return accounts.account_dict(db, accounts.get_account(db, account_id, require_active=False), detail=True)


@router.delete("/{account_id}")
def remove_account(account_id: str, db: Session = Depends(get_db)):
    accounts.disconnect(db, accounts.get_account(db, account_id, require_active=False))
    return {"ok": True}


@router.post("/{account_id}/sync")
def sync_now(account_id: str, db: Session = Depends(get_db)):
    acc = accounts.get_account(db, account_id)
    job = accounts.queue_sync(db, acc, "MANUAL")
    return {"queued": job is not None, "message": "Sync started." if job else "A sync is already running for this account."}


@router.post("/{account_id}/quota/refresh")
def refresh_quota(account_id: str, db: Session = Depends(get_db)):
    acc = accounts.get_account(db, account_id)
    with accounts.drive_errors(db, acc):
        quota.refresh(db, acc)
    return accounts.account_dict(db, acc)


@callback_router.get("/auth/google/callback")
def oauth_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None,
                   db: Session = Depends(get_db)):
    """Google redirects the browser here. We require the local session so nobody else can attach accounts."""
    s = get_settings()
    if not sessions.get_valid(db, request.cookies.get(COOKIE)):
        return RedirectResponse("/login", status_code=303)

    def back(**q):
        r = RedirectResponse("/accounts?" + "&".join(f"{k}={quote(str(v))}" for k, v in q.items()), status_code=303)
        r.delete_cookie(oauth.OAUTH_COOKIE, path="/auth/google")
        return r

    if error:
        return back(error="Google sign-in was cancelled." if error == "access_denied" else f"Google returned an error: {error}")
    if not code or not state:
        return back(error="Google did not return an authorization code. Start the connection again.")
    try:
        creds = oauth.finish(s, request.cookies.get(oauth.OAUTH_COOKIE), state, code)
        acc, is_new = accounts.connect(db, creds)
    except AppError as e:
        return back(error=e.message)
    except Exception:
        log.exception("OAuth callback failed")
        return back(error="Connecting the account failed. Check the backend log and try again.")
    return back(connected=acc.email, new="1" if is_new else "0")
