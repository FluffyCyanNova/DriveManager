from __future__ import annotations

import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.config import VERSION, get_settings
from app.core.exceptions import AppError
from app.database.database import get_db
from app.database.models import Account
from app.database.repositories.settings import get_setting, set_setting
from app.services.allocation_settings import AllocationSettings

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_auth)])


@router.get("/allocation")
def get_allocation(db: Session = Depends(get_db)):
    return AllocationSettings(**(get_setting(db, "allocation", {}) or {})).model_dump()


@router.put("/allocation")
def put_allocation(body: AllocationSettings, db: Session = Depends(get_db)):
    ids = set(db.scalars(select(Account.id)))
    bad = [r.name for r in body.rules if r.account_id not in ids]
    if bad:
        raise AppError(400, "UNKNOWN_ACCOUNT", f"These rules point to an account that isn't connected: {', '.join(bad)}.")
    set_setting(db, "allocation", body.model_dump())
    return body.model_dump()


@router.get("/runtime")
def runtime():
    s = get_settings()
    return {"version": VERSION, "sync_interval_minutes": s.sync_interval_minutes, "quota_refresh_interval_minutes": s.quota_refresh_interval_minutes,
            "upload_concurrency": s.upload_concurrency, "upload_chunk_mb": s.upload_chunk_mb,
            "staging_retention_hours": s.staging_retention_hours, "session_ttl_hours": s.session_ttl_hours,
            "google_configured": s.google_configured, "redirect_uri": s.google_redirect_uri, "tls_cookie_secure": s.cookie_secure,
            "timezone": s.tz,
            # build info for Settings > About (set at image build time; empty when running outside Docker)
            "commit": os.environ.get("APP_COMMIT") or None, "build_date": os.environ.get("APP_BUILD_DATE") or None}


# ---------------- sidebar order + pins (shared by every device) ----------------
# Pinned items are shown in a group at the top, in pin order, and can't be dragged. Dashboard is pinned by default.
SIDEBAR_DEFAULT = ["dashboard", "uploads", "files", "trash", "accounts", "virtual", "activity", "analytics", "settings"]
SIDEBAR_DEFAULT_PINNED = ["dashboard"]
SIDEBAR_KEY = "ui.sidebar"
SIDEBAR_OLD_KEY = "ui.sidebar_order"          # before pins existed: a plain list without "dashboard"


class SidebarBody(BaseModel):
    order: list[str] = Field(max_length=50)
    pinned: list[str] = Field(default_factory=list, max_length=50)


def _clean(keys) -> list[str]:
    return [k for k in dict.fromkeys(keys or []) if k in SIDEBAR_DEFAULT]


def _sidebar(saved: dict | None) -> dict:
    saved = saved or {}
    order = _clean(saved.get("order"))
    order += [k for k in SIDEBAR_DEFAULT if k not in order]     # items added in later versions appear at their default place
    pinned = _clean(saved["pinned"]) if "pinned" in saved else list(SIDEBAR_DEFAULT_PINNED)
    return {"order": order, "pinned": pinned, "default": SIDEBAR_DEFAULT, "default_pinned": SIDEBAR_DEFAULT_PINNED,
            "customized": order != SIDEBAR_DEFAULT or pinned != SIDEBAR_DEFAULT_PINNED}


def _load_sidebar(db: Session) -> dict:
    saved = get_setting(db, SIDEBAR_KEY)
    if saved is None and (old := get_setting(db, SIDEBAR_OLD_KEY)):
        saved = {"order": ["dashboard", *old]}
    return _sidebar(saved)


@router.get("/sidebar")
def get_sidebar(db: Session = Depends(get_db)):
    return _load_sidebar(db)


@router.put("/sidebar")
def put_sidebar(body: SidebarBody, db: Session = Depends(get_db)):
    state = _sidebar({"order": body.order, "pinned": body.pinned})
    set_setting(db, SIDEBAR_KEY, {"order": state["order"], "pinned": state["pinned"]})
    return state


@router.delete("/sidebar")
def reset_sidebar(db: Session = Depends(get_db)):
    set_setting(db, SIDEBAR_KEY, None)
    set_setting(db, SIDEBAR_OLD_KEY, None)
    return _sidebar(None)
