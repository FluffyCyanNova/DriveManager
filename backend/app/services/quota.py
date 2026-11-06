from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.database.models import Account, QuotaSnapshot
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive.client import DriveApiError, DriveClient, ReauthRequired
from app.services import accounts, events

log = logging.getLogger(__name__)


def store_snapshot(db: Session, acc: Account, q: dict) -> QuotaSnapshot:
    usage = int(q.get("usage", 0) or 0)
    limit = int(q["limit"]) if q.get("limit") else None
    new = dict(usage=usage, limit=limit, usage_in_drive=int(q.get("usageInDrive", 0) or 0),
               usage_in_trash=int(q.get("usageInDriveTrash", 0) or 0))
    prev = accounts.latest_quota(db, acc.id)
    acc.last_quota_at = utcnow()
    if prev and prev.taken_at > utcnow() - timedelta(hours=1) and all(getattr(prev, k) == v for k, v in new.items()):
        db.commit()   # unchanged: don't grow the history table
        return prev
    snap = QuotaSnapshot(account_id=acc.id, **new)
    db.add(snap)
    db.commit()
    events.publish(db, "storage.updated", {"account_id": acc.id})
    return snap


def refresh(db: Session, acc: Account) -> QuotaSnapshot | None:
    """Fetch live quota from Google. Returns None if the account needs reauthorization."""
    try:
        info = gfiles.about(DriveClient(acc))
    except ReauthRequired:
        accounts.mark_reauth(db, acc.id)
        return None
    return store_snapshot(db, acc, info.get("storageQuota", {}))


def refresh_all_active(db: Session) -> None:
    for acc in db.query(Account).filter(Account.status == "ACTIVE").all():
        try:
            refresh(db, acc)
        except DriveApiError as e:
            log.warning("Quota refresh failed for %s: %s", acc.email, e.message)
        except Exception:
            log.exception("Quota refresh crashed for %s", acc.email)


def prune(db: Session) -> None:
    db.query(QuotaSnapshot).filter(QuotaSnapshot.taken_at < utcnow() - timedelta(days=400)).delete()
    db.commit()
