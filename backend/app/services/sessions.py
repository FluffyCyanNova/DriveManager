from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import new_token, token_digest
from app.core.time import utcnow
from app.database.models import LocalSession


def create(db: Session, ip: str | None, ua: str | None) -> tuple[str, LocalSession]:
    s = get_settings()
    token = new_token()
    now = utcnow()
    row = LocalSession(id=token_digest(token), csrf_token=new_token(), expires_at=now + timedelta(hours=s.session_ttl_hours),
                       absolute_expires_at=now + timedelta(days=s.session_absolute_days), ip=ip, user_agent=(ua or "")[:300])
    db.add(row)
    db.commit()
    return token, row


def get_valid(db: Session, token: str | None) -> LocalSession | None:
    if not token:
        return None
    row = db.get(LocalSession, token_digest(token))
    if not row:
        return None
    now = utcnow()
    if row.expires_at < now or row.absolute_expires_at < now:
        db.delete(row)
        db.commit()
        return None
    # sliding expiry, throttled to one write per minute
    new_exp = min(now + timedelta(hours=get_settings().session_ttl_hours), row.absolute_expires_at)
    if (new_exp - row.expires_at).total_seconds() > 60:
        row.expires_at = new_exp
        db.commit()
    return row


def destroy(db: Session, token: str | None) -> None:
    if token:
        row = db.get(LocalSession, token_digest(token))
        if row:
            db.delete(row)
            db.commit()


def destroy_all(db: Session, except_id: str | None = None) -> None:
    q = db.query(LocalSession)
    if except_id:
        q = q.filter(LocalSession.id != except_id)
    q.delete()
    db.commit()


def purge_expired(db: Session) -> None:
    now = utcnow()
    db.query(LocalSession).filter((LocalSession.expires_at < now) | (LocalSession.absolute_expires_at < now)).delete()
    db.commit()
