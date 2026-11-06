from __future__ import annotations

from datetime import timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.time import iso, utcnow
from app.database.models import Account, DriveFile, FileEvent, QuotaSnapshot, UploadJob
from app.database.repositories import files as frepo
from app.services import accounts


def category_expr():
    m = DriveFile.mime_type
    whens = []
    for name, pats in frepo.TYPE_FILTERS.items():
        from sqlalchemy import or_
        whens.append((or_(*[m.like(p) for p in pats]), name))
    return case(*whens, else_="other")


def summary(db: Session) -> dict:
    live = [DriveFile.status == "ACTIVE", DriveFile.trashed.is_(False), DriveFile.is_folder.is_(False)]
    cat = category_expr()
    by_type = [{"type": t, "files": n, "bytes": int(b or 0)} for t, n, b in db.execute(
        select(cat, func.count(), func.sum(DriveFile.size)).where(*live).group_by(cat).order_by(func.sum(DriveFile.size).desc()))]
    per_account = []
    for a in db.scalars(select(Account).order_by(Account.email)):
        n, b = db.execute(select(func.count(), func.coalesce(func.sum(DriveFile.size), 0)).where(DriveFile.account_id == a.id, *live)).one()
        per_account.append({"account_id": a.id, "email": a.email, "files": n, "indexed_bytes": int(b),
                            "quota": accounts.quota_dict(accounts.latest_quota(db, a.id))})
    largest = [frepo.to_dict(f, e) for f, e in db.execute(
        select(DriveFile, Account.email).join(Account, Account.id == DriveFile.account_id).where(*live).order_by(DriveFile.size.desc().nullslast()).limit(15))]
    since = utcnow() - timedelta(days=30)
    day = func.date(UploadJob.finished_at)
    uploads = [{"day": d, "count": n, "bytes": int(b or 0)} for d, n, b in db.execute(
        select(day, func.count(), func.sum(UploadJob.size)).where(UploadJob.state == "COMPLETED", UploadJob.finished_at >= since).group_by(day).order_by(day))]
    return {"by_type": by_type, "per_account": per_account, "largest": largest, "uploads_per_day": uploads}


def history(db: Session, account_id: str | None, days: int) -> list[dict]:
    since = utcnow() - timedelta(days=days)
    q = select(QuotaSnapshot, Account.email).join(Account, Account.id == QuotaSnapshot.account_id).where(QuotaSnapshot.taken_at >= since)
    if account_id:
        q = q.where(QuotaSnapshot.account_id == account_id)
    return [{"account_id": s.account_id, "email": e, "taken_at": iso(s.taken_at), "usage": s.usage, "limit": s.limit}
            for s, e in db.execute(q.order_by(QuotaSnapshot.taken_at))]
