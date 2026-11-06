from __future__ import annotations

import logging
from contextlib import contextmanager
from types import SimpleNamespace

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.encryption import encrypt
from app.core.exceptions import AppError
from app.core.time import iso, utcnow
from app.database.models import (Account, Drive, DriveFile, QuotaSnapshot, SyncCursor, SyncJob, UploadJob)
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive.client import DriveApiError, DriveClient, ReauthRequired, forget
from app.services import events

log = logging.getLogger(__name__)

_FRIENDLY = {
    "insufficientFilePermissions": "You don't have permission to do that with this item.",
    "storageQuotaExceeded": "This Google account is out of storage space.",
    "notFound": "That item no longer exists in Google Drive. Sync the account to refresh the list.",
    "userRateLimitExceeded": "Google is rate-limiting this account. Wait a moment and try again.",
    "rateLimitExceeded": "Google is rate-limiting this account. Wait a moment and try again.",
    "cannotDownloadFile": "Google does not allow downloading this file.",
    "exportSizeLimitExceeded": "This Google document is too large to export (limit about 10 MB).",
}


def mark_reauth(db: Session, account_id: str, detail: str | None = None) -> None:
    acc = db.get(Account, account_id)
    if acc and acc.status != "NEEDS_REAUTH":
        acc.status = "NEEDS_REAUTH"
        acc.status_detail = "Google access was revoked or expired. Reconnect this account."
        db.commit()
        events.record_activity(db, "account_needs_reauth", account=acc)
        events.publish(db, "account.status_changed", {"account_id": acc.id, "status": "NEEDS_REAUTH"})
    forget(account_id)


@contextmanager
def drive_errors(db: Session, account: Account):
    """Translate Drive/auth failures into clear API errors."""
    try:
        yield
    except ReauthRequired:
        mark_reauth(db, account.id)
        raise AppError(409, "REAUTH_REQUIRED", f"{account.email} needs to be reconnected to Google.") from None
    except DriveApiError as e:
        status = 404 if e.status == 404 else 403 if e.status == 403 else 429 if e.status == 429 else 400 if e.status == 400 else 502
        msg = _FRIENDLY.get(e.reason) or e.message
        raise AppError(status, "DRIVE_" + e.reason.upper(), msg, {"google_status": e.status}) from None


def get_account(db: Session, account_id: str, require_active: bool = True) -> Account:
    acc = db.get(Account, account_id)
    if not acc:
        raise AppError(404, "ACCOUNT_NOT_FOUND", "Account was not found.")
    if require_active and acc.status != "ACTIVE":
        raise AppError(409, "REAUTH_REQUIRED", f"{acc.email} needs to be reconnected to Google.")
    return acc


def connect(db: Session, creds) -> tuple[Account, bool]:
    """Create or update an account from freshly authorized credentials. Returns (account, is_new)."""
    if not creds.refresh_token:
        raise AppError(400, "NO_REFRESH_TOKEN", "Google did not return offline access. Remove DriveManager from "
                       "https://myaccount.google.com/permissions and connect again.")
    temp = SimpleNamespace(id="connect-temp", encrypted_refresh_token=encrypt(creds.refresh_token))
    client = DriveClient(temp)
    client.creds = creds
    try:
        info = gfiles.about(client)
        root = gfiles.root_folder_id(client)
    except DriveApiError as e:
        raise AppError(502, "DRIVE_UNREACHABLE", f"Connected to Google, but the Drive API failed: {e.message}") from None
    user = info["user"]
    sub = user["permissionId"]
    acc = db.scalar(select(Account).where(Account.google_sub == sub))
    is_new = acc is None
    if is_new:
        acc = Account(google_sub=sub, email=user["emailAddress"], display_name=user.get("displayName"),
                      encrypted_refresh_token=temp.encrypted_refresh_token, scopes=" ".join(creds.scopes or []),
                      root_folder_id=root)
        db.add(acc)
        db.flush()
        db.add(Drive(account_id=acc.id, google_drive_id=root, kind="MY_DRIVE", name="My Drive"))
    else:
        acc.encrypted_refresh_token = temp.encrypted_refresh_token
        acc.email, acc.display_name, acc.root_folder_id = user["emailAddress"], user.get("displayName"), root
        acc.status, acc.status_detail = "ACTIVE", None
    db.commit()
    forget(acc.id)
    from app.services import quota
    quota.store_snapshot(db, acc, info.get("storageQuota", {}))
    queue_sync(db, acc, "INITIAL" if (is_new or not acc.initial_scan_complete) else "MANUAL")
    events.record_activity(db, "account_connected" if is_new else "account_reconnected", account=acc)
    events.publish(db, "account.status_changed", {"account_id": acc.id, "status": "ACTIVE"})
    return acc, is_new


def queue_sync(db: Session, acc: Account, kind: str = "INCREMENTAL") -> SyncJob | None:
    busy = db.scalar(select(SyncJob.id).where(SyncJob.account_id == acc.id, SyncJob.state.in_(["QUEUED", "RUNNING"])))
    if busy:
        return None
    job = SyncJob(account_id=acc.id, kind=kind)
    db.add(job)
    db.commit()
    return job


def disconnect(db: Session, acc: Account) -> None:
    """Remove the account from DriveManager. Files in Google Drive are untouched."""
    active = db.scalar(select(func.count()).select_from(UploadJob).where(
        UploadJob.account_id == acc.id, UploadJob.state.in_(["QUEUED", "VALIDATING", "ALLOCATING", "UPLOADING", "FINALIZING"])))
    if active:
        raise AppError(409, "UPLOADS_ACTIVE", "This account has uploads in progress. Cancel or finish them before removing the account.")
    try:  # best-effort revocation so the app disappears from the user's Google permissions page
        from app.core.encryption import decrypt
        import requests
        requests.post("https://oauth2.googleapis.com/revoke", params={"token": decrypt(acc.encrypted_refresh_token)}, timeout=10)
    except Exception:
        log.info("Token revocation skipped for %s", acc.email)
    email, aid = acc.email, acc.id
    events.record_activity(db, "account_removed", account_email=email, commit=False)
    forget(aid)
    db.delete(acc)   # FK cascades remove its index, quota history, cursors and virtual-folder references
    db.commit()
    events.publish(db, "account.removed", {"account_id": aid})


def latest_quota(db: Session, account_id: str) -> QuotaSnapshot | None:
    return db.scalar(select(QuotaSnapshot).where(QuotaSnapshot.account_id == account_id)
                     .order_by(QuotaSnapshot.taken_at.desc()).limit(1))


def quota_dict(q: QuotaSnapshot | None) -> dict | None:
    if not q:
        return None
    return {"usage": q.usage, "limit": q.limit, "usage_in_drive": q.usage_in_drive, "usage_in_trash": q.usage_in_trash,
            "free": (q.limit - q.usage) if q.limit is not None else None, "taken_at": iso(q.taken_at)}


def account_dict(db: Session, a: Account, detail: bool = False) -> dict:
    d = {"id": a.id, "email": a.email, "display_name": a.display_name, "status": a.status, "status_detail": a.status_detail,
         "initial_scan_complete": a.initial_scan_complete, "last_sync_at": iso(a.last_sync_at),
         "last_quota_at": iso(a.last_quota_at), "created_at": iso(a.created_at), "quota": quota_dict(latest_quota(db, a.id))}
    running = db.scalar(select(SyncJob).where(SyncJob.account_id == a.id, SyncJob.state.in_(["QUEUED", "RUNNING"])))
    d["syncing"] = bool(running)
    d["files_indexed"] = db.scalar(select(func.count()).select_from(DriveFile).where(
        DriveFile.account_id == a.id, DriveFile.status == "ACTIVE", DriveFile.is_folder.is_(False)))
    if detail:
        d["shared_drives"] = [{"id": x.google_drive_id, "name": x.name} for x in db.scalars(
            select(Drive).where(Drive.account_id == a.id, Drive.kind == "SHARED_DRIVE").order_by(Drive.name))]
        last = db.scalar(select(SyncJob).where(SyncJob.account_id == a.id).order_by(SyncJob.requested_at.desc()).limit(1))
        d["last_sync_job"] = {"state": last.state, "kind": last.kind, "files_processed": last.files_processed,
                              "error": last.error, "finished_at": iso(last.finished_at)} if last else None
        d["has_cursor"] = db.scalar(select(SyncCursor.id).where(SyncCursor.account_id == a.id)) is not None
    return d
