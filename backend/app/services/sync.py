"""Metadata sync: initial scan + incremental changes feed, with persisted cursors. No file contents are ever copied."""
from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.time import parse_google_time, utcnow
from app.database.database import session_scope
from app.database.models import (FOLDER_MIME, Account, Drive, DriveFile, DriveFileParent, SyncCursor, SyncJob)
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive.client import DriveApiError, DriveClient, ReauthRequired
from app.services import accounts, events

log = logging.getLogger(__name__)


def classify(meta: dict) -> str:
    if meta.get("driveId"):
        return "SHARED_DRIVE"
    return "MY_DRIVE" if meta.get("ownedByMe", True) else "SHARED_WITH_ME"


def upsert_files(db: Session, account: Account, metas: Iterable[dict]) -> int:
    metas = [m for m in metas if m and m.get("id")]
    if not metas:
        return 0
    ids = [m["id"] for m in metas]
    existing = {f.google_file_id: f for f in db.scalars(
        select(DriveFile).where(DriveFile.account_id == account.id, DriveFile.google_file_id.in_(ids)))}
    parents_by_file: dict[str, set[str]] = {}
    if existing:
        for fid, pid in db.execute(select(DriveFileParent.file_id, DriveFileParent.parent_google_id)
                                   .where(DriveFileParent.file_id.in_([f.id for f in existing.values()]))):
            parents_by_file.setdefault(fid, set()).add(pid)
    now = utcnow()
    for m in metas:
        sc = m.get("shortcutDetails") or {}
        values = dict(
            name=m.get("name", ""), mime_type=m.get("mimeType", ""), is_folder=m.get("mimeType") == FOLDER_MIME,
            size=int(m["size"]) if m.get("size") else None, md5=m.get("md5Checksum"),
            created_time=parse_google_time(m.get("createdTime")), modified_time=parse_google_time(m.get("modifiedTime")),
            trashed=bool(m.get("trashed")), owned_by_me=bool(m.get("ownedByMe", True)),
            owner_email=((m.get("owners") or [{}])[0].get("emailAddress")), drive_id=m.get("driveId"),
            location=classify(m), web_view_link=m.get("webViewLink"), shortcut_target_id=sc.get("targetId"),
            shortcut_target_mime=sc.get("targetMimeType"), capabilities=m.get("capabilities"), status="ACTIVE", synced_at=now)
        row = existing.get(m["id"])
        if row:
            for k, v in values.items():
                setattr(row, k, v)
        else:
            row = DriveFile(account_id=account.id, google_file_id=m["id"], **values)
            db.add(row)
            db.flush()
            existing[m["id"]] = row
        want = set(m.get("parents") or [])
        have = parents_by_file.get(row.id, set())
        for pid in want - have:
            db.add(DriveFileParent(file_id=row.id, account_id=account.id, parent_google_id=pid))
        if have - want:
            db.query(DriveFileParent).filter(DriveFileParent.file_id == row.id,
                                             DriveFileParent.parent_google_id.in_(have - want)).delete(synchronize_session=False)
    db.commit()
    return len(metas)


def _mark_removed(db: Session, account: Account, google_ids: list[str]) -> None:
    if google_ids:
        db.execute(update(DriveFile).where(DriveFile.account_id == account.id, DriveFile.google_file_id.in_(google_ids))
                   .values(status="REMOVED", synced_at=utcnow()))
        db.commit()


def _set_cursor(db: Session, account_id: str, token: str) -> None:
    cur = db.scalar(select(SyncCursor).where(SyncCursor.account_id == account_id, SyncCursor.scope == "ACCOUNT",
                                             SyncCursor.drive_id == ""))
    if cur:
        cur.page_token = token
    else:
        db.add(SyncCursor(account_id=account_id, scope="ACCOUNT", drive_id="", page_token=token))
    db.commit()


def _sync_drives(db: Session, account: Account, client: DriveClient) -> list[str]:
    drives = gfiles.list_drives(client)
    seen = {d["id"] for d in drives}
    for d in drives:
        row = db.scalar(select(Drive).where(Drive.account_id == account.id, Drive.google_drive_id == d["id"]))
        if row:
            row.name, row.capabilities = d["name"], d.get("capabilities")
        else:
            db.add(Drive(account_id=account.id, google_drive_id=d["id"], kind="SHARED_DRIVE", name=d["name"],
                         capabilities=d.get("capabilities")))
    for row in db.scalars(select(Drive).where(Drive.account_id == account.id, Drive.kind == "SHARED_DRIVE")):
        if row.google_drive_id not in seen:
            db.delete(row)
    db.commit()
    return list(seen)


def initial_scan(account_id: str, job_id: str) -> int:
    """Full metadata scan. The changes cursor is taken BEFORE scanning so edits made during the scan are replayed."""
    with session_scope() as db:
        account = db.get(Account, account_id)
        client = DriveClient(account)
        scan_start = utcnow()
        account.root_folder_id = account.root_folder_id or gfiles.root_folder_id(client)
        _set_cursor(db, account.id, gfiles.start_page_token(client))
        drive_ids = _sync_drives(db, account, client)
        total = 0
        for scope in [None] + drive_ids:
            token = None
            while True:
                page = gfiles.list_page(client, token, drive_id=scope)
                total += upsert_files(db, account, page.get("files", []))
                db.execute(update(SyncJob).where(SyncJob.id == job_id).values(files_processed=total))
                db.commit()
                events.publish(db, "sync.progress", {"account_id": account.id, "processed": total})
                token = page.get("nextPageToken")
                if not token:
                    break
        # anything not touched by this complete scan no longer exists / is no longer accessible
        db.execute(update(DriveFile).where(DriveFile.account_id == account.id, DriveFile.synced_at < scan_start,
                                           DriveFile.status == "ACTIVE").values(status="REMOVED"))
        account.initial_scan_complete = True
        db.commit()
        return total


def incremental(account_id: str, job_id: str) -> int:
    with session_scope() as db:
        account = db.get(Account, account_id)
        client = DriveClient(account)
        cur = db.scalar(select(SyncCursor).where(SyncCursor.account_id == account_id, SyncCursor.scope == "ACCOUNT"))
        if not cur:
            raise LookupError("no cursor")
        _sync_drives(db, account, client)
        token, total = cur.page_token, 0
        while True:
            page = gfiles.changes_page(client, token)
            changes = [c for c in page.get("changes", []) if c.get("changeType", "file") == "file"]
            removed = [c["fileId"] for c in changes if c.get("removed") or not c.get("file")]
            total += upsert_files(db, account, [c["file"] for c in changes if not c.get("removed") and c.get("file")])
            _mark_removed(db, account, removed)
            total += len(removed)
            token = page.get("nextPageToken") or page.get("newStartPageToken")
            _set_cursor(db, account_id, token)          # progress is durable page by page; replays are idempotent
            db.execute(update(SyncJob).where(SyncJob.id == job_id).values(files_processed=total))
            db.commit()
            if not page.get("nextPageToken"):
                return total


def run_sync_job(job_id: str) -> None:
    with session_scope() as db:
        job = db.get(SyncJob, job_id)
        if not job or job.state != "RUNNING":
            return
        account_id = job.account_id
        account = db.get(Account, account_id)
        if not account or account.status != "ACTIVE":
            job.state, job.error, job.finished_at = "FAILED", "Account needs to be reconnected.", utcnow()
            db.commit()
            return
        needs_scan = (not account.initial_scan_complete) or job.kind == "INITIAL"
    processed, error = 0, None
    try:
        try:
            processed = initial_scan(account_id, job_id) if needs_scan else incremental(account_id, job_id)
        except (LookupError, DriveApiError) as e:
            # missing/expired cursor -> rebuild from a fresh scan
            if isinstance(e, DriveApiError) and e.status not in (400, 404, 410):
                raise
            log.warning("Cursor unusable for account %s (%s); running a full scan", account_id, e)
            processed = initial_scan(account_id, job_id)
    except ReauthRequired:
        with session_scope() as db:
            accounts.mark_reauth(db, account_id)
        error = "Account needs to be reconnected."
    except DriveApiError as e:
        error = f"Google API error: {e.message}"
    except Exception as e:  # keep the worker alive
        log.exception("Sync crashed for account %s", account_id)
        error = f"Unexpected error: {e}"
    with session_scope() as db:
        job = db.get(SyncJob, job_id)
        job.finished_at, job.files_processed = utcnow(), processed
        job.state, job.error = ("FAILED", error) if error else ("COMPLETED", None)
        if not error:
            acc = db.get(Account, account_id)
            if acc:
                acc.last_sync_at = utcnow()
        db.commit()
        if not error:
            events.publish(db, "files.changed", {"account_id": account_id})
        events.publish(db, "sync.finished", {"account_id": account_id, "ok": error is None})
