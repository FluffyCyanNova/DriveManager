"""Activity history (file_events) and the cross-process realtime bus (realtime_events)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.database.models import FileEvent, RealtimeEvent
from app.core.time import utcnow


def publish(db: Session, type_: str, payload: dict | None = None, commit: bool = True) -> None:
    db.add(RealtimeEvent(type=type_, payload=payload or {}))
    if commit:
        db.commit()


def record_activity(db: Session, event_type: str, *, account=None, account_email: str | None = None,
                    google_file_id: str | None = None, file_name: str | None = None,
                    details: dict | None = None, commit: bool = True) -> None:
    db.add(FileEvent(account_id=account.id if account else None,
                     account_email=account.email if account else account_email,
                     event_type=event_type, google_file_id=google_file_id,
                     file_name=file_name, details=details or {}))
    if commit:
        db.commit()


def prune(db: Session) -> None:
    from datetime import timedelta
    db.query(RealtimeEvent).filter(RealtimeEvent.created_at < utcnow() - timedelta(hours=24)).delete()
    db.query(FileEvent).filter(FileEvent.created_at < utcnow() - timedelta(days=365)).delete()
    db.commit()
