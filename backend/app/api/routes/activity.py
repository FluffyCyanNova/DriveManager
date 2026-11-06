from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.core.time import iso
from app.database.database import get_db
from app.database.models import FileEvent

router = APIRouter(prefix="/api/activity", tags=["activity"], dependencies=[Depends(require_auth)])


@router.get("")
def activity(type: str | None = None, account_id: str | None = None, before_id: int | None = None,
             limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    q = select(FileEvent).order_by(FileEvent.id.desc()).limit(limit)
    if type:
        q = q.where(FileEvent.event_type.in_(type.split(",")))
    if account_id:
        q = q.where(FileEvent.account_id == account_id)
    if before_id:
        q = q.where(FileEvent.id < before_id)
    rows = db.scalars(q).all()
    return {"items": [{"id": e.id, "type": e.event_type, "account_id": e.account_id, "account_email": e.account_email,
                       "file_name": e.file_name, "google_file_id": e.google_file_id, "details": e.details,
                       "created_at": iso(e.created_at)} for e in rows],
            "next_before_id": rows[-1].id if len(rows) == limit else None}
