from __future__ import annotations

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
            "timezone": s.tz}


# ---------------- sidebar order (shared by every device) ----------------
# Dashboard is pinned at the top and isn't part of the order.
SIDEBAR_DEFAULT = ["files", "trash", "virtual", "uploads", "accounts", "activity", "analytics", "settings"]
SIDEBAR_KEY = "ui.sidebar_order"


class SidebarBody(BaseModel):
    order: list[str] = Field(max_length=50)


def _sidebar(saved: list[str] | None) -> dict:
    order = [k for k in dict.fromkeys(saved or []) if k in SIDEBAR_DEFAULT]
    order += [k for k in SIDEBAR_DEFAULT if k not in order]     # items added in later versions appear at their default place (end)
    return {"order": order, "default": SIDEBAR_DEFAULT, "customized": order != SIDEBAR_DEFAULT}


@router.get("/sidebar")
def get_sidebar(db: Session = Depends(get_db)):
    return _sidebar(get_setting(db, SIDEBAR_KEY))


@router.put("/sidebar")
def put_sidebar(body: SidebarBody, db: Session = Depends(get_db)):
    state = _sidebar(body.order)
    set_setting(db, SIDEBAR_KEY, state["order"])
    return state


@router.delete("/sidebar")
def reset_sidebar(db: Session = Depends(get_db)):
    set_setting(db, SIDEBAR_KEY, None)
    return _sidebar(None)
