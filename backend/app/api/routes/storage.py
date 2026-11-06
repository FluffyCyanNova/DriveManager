from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.database.database import get_db
from app.database.models import Account
from app.services import accounts, analytics, quota

router = APIRouter(prefix="/api", tags=["storage"], dependencies=[Depends(require_auth)])


@router.get("/storage")
def storage(db: Session = Depends(get_db)):
    """Per-account quotas. Each Google account has its own limit; they are intentionally never summed into a 'pool'."""
    accs = [accounts.account_dict(db, a) for a in db.scalars(select(Account).order_by(Account.email))]
    return {"accounts": accs, "total_used": sum((a["quota"] or {}).get("usage", 0) for a in accs)}


@router.post("/storage/refresh")
def refresh_all(db: Session = Depends(get_db)):
    quota.refresh_all_active(db)
    return storage(db)


@router.get("/storage/history")
def history(account_id: str | None = None, days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    return analytics.history(db, account_id, days)


@router.get("/analytics/summary")
def summary(db: Session = Depends(get_db)):
    return analytics.summary(db)
