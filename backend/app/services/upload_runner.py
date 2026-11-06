"""Executes one upload job: validate -> allocate -> resumable upload -> finalize.

Safety properties
  * Resumable session URI is stored encrypted, so a crash/restart resumes from the byte Google already has.
  * Every created file carries appProperties.drivemanager_job_id; before starting a fresh session after a
    previous attempt we look for an already-created file, so a retry can never create a duplicate.
  * The staged copy is deleted only after Google confirms the file (and its size).
  * Quota is re-checked live before upload. A pinned/manual account is never swapped for another.
"""
from __future__ import annotations

import logging
import os
import threading
import time

import requests
from sqlalchemy import select

from app.config import get_settings
from app.core.encryption import decrypt, encrypt
from app.core.exceptions import AppError
from app.core.time import utcnow
from app.database.database import session_scope
from app.database.models import Account, UploadJob
from app.database.repositories.settings import get_setting
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive import transfer
from app.integrations.google_drive.client import DriveApiError, DriveClient, ReauthRequired
from app.services import accounts, allocation, events, quota, sync
from app.services.uploads import cleanup_staging

log = logging.getLogger(__name__)
shutdown = threading.Event()


class _Stop(Exception):
    """Controlled early exit; the job row already reflects the outcome."""


class _Interrupted(Exception):
    pass


class _Fail(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _update(job_id: str, **fields) -> None:
    with session_scope() as db:
        db.query(UploadJob).filter(UploadJob.id == job_id).update(fields)
        db.commit()
        events.publish(db, "upload.updated", {"id": job_id})


def _progress(job_id: str, sent: int, size: int) -> None:
    with session_scope() as db:
        db.query(UploadJob).filter(UploadJob.id == job_id).update({"bytes_uploaded": sent})
        db.commit()
        events.publish(db, "upload.progress", {"id": job_id, "bytes_uploaded": sent, "size": size})


def _cancelled(job_id: str) -> bool:
    with session_scope() as db:
        return bool(db.scalar(select(UploadJob.cancel_requested).where(UploadJob.id == job_id)))


def run(job_id: str) -> None:
    try:
        _run(job_id)
    except _Stop:
        pass
    except _Interrupted:
        _update(job_id, state="QUEUED")           # worker is shutting down; resume on next start
    except _Fail as f:
        _fail(job_id, f.code, f.message)
    except ReauthRequired:
        with session_scope() as db:
            acc_id = db.scalar(select(UploadJob.account_id).where(UploadJob.id == job_id))
            if acc_id:
                accounts.mark_reauth(db, acc_id)
        _fail(job_id, "ACCOUNT_NEEDS_REAUTH", "This account needs to be reconnected. Reconnect it, then retry the upload.")
    except DriveApiError as e:
        if e.reason in ("storageQuotaExceeded",):
            _fail(job_id, "INSUFFICIENT_SPACE", "Google reports this account is out of storage. Free space or retry with another account.")
        else:
            _fail(job_id, "GOOGLE_" + e.reason.upper(), f"Google rejected the upload: {e.message}")
    except (transfer.TransientUploadError, requests.RequestException) as e:
        _fail(job_id, "NETWORK_ERROR", "The connection to Google kept failing. Retry later; the upload resumes where it stopped.")
        log.warning("Upload %s network failure: %s", job_id, e)
    except Exception:
        log.exception("Upload %s crashed", job_id)
        _fail(job_id, "INTERNAL_ERROR", "Unexpected error. Check the worker log, then retry.")


def _fail(job_id: str, code: str, message: str) -> None:
    with session_scope() as db:
        job = db.get(UploadJob, job_id)
        acc = db.get(Account, job.account_id) if job and job.account_id else None
        db.query(UploadJob).filter(UploadJob.id == job_id).update(
            {"state": "FAILED", "error_code": code, "error_message": message, "finished_at": utcnow()})
        db.commit()
        events.record_activity(db, "upload_failed", account=acc, account_email=job.account_email if job else None,
                               file_name=job.filename if job else None, details={"code": code, "message": message})
        events.publish(db, "upload.failed", {"id": job_id})


def _snapshot(job_id: str) -> dict:
    with session_scope() as db:
        j = db.get(UploadJob, job_id)
        return {c.name: getattr(j, c.name) for c in UploadJob.__table__.columns} if j else {}


def _run(job_id: str) -> None:
    settings = get_settings()
    job = _snapshot(job_id)
    if not job or job["state"] in ("COMPLETED", "FAILED", "CANCELLED"):
        return
    if job["cancel_requested"]:
        return _cancel(job, None, None)
    _update(job_id, state="VALIDATING", started_at=job["started_at"] or utcnow(), attempts=job["attempts"] + 1)
    job = _snapshot(job_id)

    if not job["google_file_id"]:
        if not os.path.isfile(job["staged_path"]):
            raise _Fail("STAGED_FILE_MISSING", "The staged file is missing on the server. Upload the file again.")
        if os.path.getsize(job["staged_path"]) != job["size"]:
            raise _Fail("STAGED_FILE_CHANGED", "The staged file changed size on disk. Upload the file again.")

    # ---------------- allocation ----------------
    _update(job_id, state="ALLOCATING")
    with session_scope() as db:
        if not job["account_id"]:
            _auto_allocate(db, job)
        job = _snapshot(job_id)
        acc = db.get(Account, job["account_id"])
        if not acc:
            raise _Fail("ACCOUNT_REMOVED", "The destination account was removed from DriveManager.")
        if acc.status != "ACTIVE":
            raise ReauthRequired()
        snap = quota.refresh(db, acc)         # live check right before uploading
        if snap is None:
            raise ReauthRequired()
        if not job["google_file_id"] and snap.limit is not None and snap.limit - snap.usage < job["size"]:
            free = max(snap.limit - snap.usage, 0)
            raise _Fail("INSUFFICIENT_SPACE", f"{acc.email} has {free / 1024**3:.2f} GB free but the file needs "
                        f"{job['size'] / 1024**3:.2f} GB. It was not sent anywhere else; choose another account and retry.")
        client = DriveClient(acc)
        account_email = acc.email

    # destination folder must exist and accept new items
    folder = job["destination_folder_id"]
    if folder and not job["google_file_id"]:
        try:
            f = gfiles.get_file(client, folder, "id,mimeType,trashed,capabilities")
        except DriveApiError as e:
            if e.status in (403, 404):
                raise _Fail("DESTINATION_INVALID", "The destination folder no longer exists or you can't access it. Pick another folder and retry.")
            raise
        if f.get("mimeType") != gfiles.FOLDER_MIME or f.get("trashed") or (f.get("capabilities") or {}).get("canAddChildren") is False:
            raise _Fail("DESTINATION_INVALID", "The destination folder can't accept uploads (deleted, trashed or read-only). Pick another folder and retry.")

    # ---------------- upload ----------------
    _update(job_id, state="UPLOADING")
    meta = _upload(job_id, job, client, settings.chunk_bytes) if not job["google_file_id"] else gfiles.get_file(client, job["google_file_id"])

    # ---------------- finalize ----------------
    _update(job_id, state="FINALIZING")
    if "capabilities" not in meta:
        meta = gfiles.get_file(client, meta["id"])
    if meta.get("size") is not None and int(meta["size"]) != job["size"]:
        raise _Fail("SIZE_MISMATCH", "Google reports a different file size than was sent. The file was kept; retry the upload.")
    with session_scope() as db:
        acc = db.get(Account, job["account_id"])
        sync.upsert_files(db, acc, [meta])
        db.query(UploadJob).filter(UploadJob.id == job_id).update(
            {"state": "COMPLETED", "google_file_id": meta["id"], "bytes_uploaded": job["size"], "finished_at": utcnow(),
             "error_code": None, "error_message": None, "resumable_uri_enc": None})
        db.commit()
        if job.get("virtual_folder_id"):
            _add_to_virtual_folder(db, job["virtual_folder_id"], acc.id, meta["id"])
        events.record_activity(db, "upload", account=acc, google_file_id=meta["id"], file_name=job["filename"],
                               details={"size": job["size"], "reason": job["allocation_reason"]})
        quota.refresh(db, acc)
        events.publish(db, "upload.completed", {"id": job_id})
        events.publish(db, "files.changed", {"account_id": acc.id})
    cleanup_staging(UploadJob(staged_path=job["staged_path"]))


def _add_to_virtual_folder(db, folder_id: str, account_id: str, google_file_id: str) -> None:
    """Best effort: the file is already safely in Drive, so a missing or removed virtual folder must not fail the upload."""
    from app.services import virtual_folders
    try:
        virtual_folders.add_items(db, folder_id, [{"account_id": account_id, "google_file_id": google_file_id}])
    except AppError:
        db.rollback()
        log.info("Virtual folder %s no longer exists; uploaded file %s was not added to it", folder_id, google_file_id)


def _auto_allocate(db, job: dict) -> None:
    accs = db.scalars(select(Account)).all()
    for a in accs:
        if a.status == "ACTIVE":
            try:
                quota.refresh(db, a)
            except Exception:
                log.warning("Quota refresh failed for %s during allocation", a.email)
    cands = []
    for a in accs:
        q = accounts.latest_quota(db, a.id)
        cands.append(allocation.Candidate(a.id, a.email, a.status, q.usage if q else None, q.limit if q else None))
    try:
        d = allocation.decide(filename=job["filename"], mime=job["mime_type"], size=job["size"], candidates=cands,
                              settings=get_setting(db, "allocation", {}) or {})
    except allocation.AllocationError as e:
        raise _Fail(e.code, e.message)
    email = next(c.email for c in cands if c.account_id == d.account_id)
    db.query(UploadJob).filter(UploadJob.id == job["id"]).update({
        "account_id": d.account_id, "account_email": email, "allocation_reason": d.reason,
        "destination_folder_id": job["destination_folder_id"] or d.folder_id,
        "destination_folder_name": job["destination_folder_name"] or d.folder_name})
    db.commit()


def _upload(job_id: str, job: dict, client: DriveClient, chunk: int) -> dict:
    size, path = job["size"], job["staged_path"]
    uri = decrypt(job["resumable_uri_enc"]) if job["resumable_uri_enc"] else None
    offset = 0

    def reconcile() -> dict | None:
        """A previous attempt may already have created the file (crash between 'done' and our DB write)."""
        found = gfiles.find_by_job(client, job_id)
        return found if found and int(found.get("size") or 0) == size else None

    if uri:
        try:
            state, offset, meta = transfer.query_status(client, uri, size)
            if state == "complete":
                return meta
        except transfer.SessionExpired:
            uri, offset = None, 0
            _update(job_id, resumable_uri_enc=None, bytes_uploaded=0)
    if uri is None:
        if job["attempts"] > 1 and (existing := reconcile()):
            return existing
        uri = transfer.start_session(client, name=job["filename"], size=size, mime=job["mime_type"],
                                     parent_id=job["destination_folder_id"], job_id=job_id)
        _update(job_id, resumable_uri_enc=encrypt(uri), bytes_uploaded=0)
        offset = 0

    retries = 0
    with open(path, "rb") as fh:
        while True:
            if shutdown.is_set():
                raise _Interrupted()
            if _cancelled(job_id):
                _cancel(_snapshot(job_id), client, uri)
                raise _Stop()
            fh.seek(offset)
            data = fh.read(min(chunk, size - offset)) if size else b""
            try:
                done, received, meta = transfer.send_chunk(client, uri, data, offset, size)
                retries = 0
            except transfer.SessionExpired:
                _update(job_id, resumable_uri_enc=None, bytes_uploaded=0)
                raise _Fail("SESSION_EXPIRED", "Google's upload session expired. Retry to start a fresh upload.")
            except (transfer.TransientUploadError, requests.RequestException) as e:
                retries += 1
                if retries > 6:
                    raise
                log.warning("Upload %s transient error (%s); retry %d", job_id, e, retries)
                time.sleep(min(2 ** retries, 60))
                try:   # find out what Google actually received, then continue from there
                    st, received, meta = transfer.query_status(client, uri, size)
                    done = st == "complete"
                except (transfer.TransientUploadError, requests.RequestException):
                    continue
            if done:
                return meta
            offset = received
            _progress(job_id, offset, size)


def _cancel(job: dict, client: DriveClient | None, uri: str | None) -> None:
    if client and uri:
        transfer.cancel_session(client, uri)
    with session_scope() as db:
        db.query(UploadJob).filter(UploadJob.id == job["id"]).update(
            {"state": "CANCELLED", "finished_at": utcnow(), "resumable_uri_enc": None, "cancel_requested": False})
        db.commit()
        events.record_activity(db, "upload_cancelled", account_email=job.get("account_email"), file_name=job["filename"])
        events.publish(db, "upload.updated", {"id": job["id"]})
    cleanup_staging(UploadJob(staged_path=job["staged_path"]))
