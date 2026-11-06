"""Upload job creation, cancel and retry (API side). The worker performs the actual upload."""
from __future__ import annotations

import mimetypes
import os
import re
import shutil
import uuid

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import AppError
from app.database.models import UploadJob, VirtualFolder
from app.database.repositories.settings import get_setting
from app.services import accounts, events

ACTIVE_STATES = ["QUEUED", "VALIDATING", "ALLOCATING", "UPLOADING", "FINALIZING"]
TERMINAL = ["COMPLETED", "FAILED", "CANCELLED"]


def safe_filename(name: str) -> str:
    name = os.path.basename((name or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f]", "", name).strip().strip(".")
    return (name or "upload")[:240]


def staging_path(job_id: str, filename: str) -> str:
    return os.path.join(get_settings().staging_dir, "jobs", job_id, filename)


def new_job_id() -> str:
    return str(uuid.uuid4())


def create(db: Session, *, job_id: str, filename: str, size: int, mime: str | None, path: str, mode: str,
           account_id: str | None, folder_id: str | None, folder_name: str | None,
           virtual_folder_id: str | None = None) -> UploadJob:
    if mode not in ("MANUAL", "AUTO"):
        raise AppError(400, "BAD_MODE", "mode must be MANUAL or AUTO.")
    virtual_folder_id = virtual_folder_id or None
    if virtual_folder_id and not db.get(VirtualFolder, virtual_folder_id):
        raise AppError(404, "FOLDER_NOT_FOUND", "Virtual folder was not found.")
    acc = None
    if mode == "MANUAL":
        if not account_id:
            raise AppError(400, "ACCOUNT_REQUIRED", "Choose which account to upload to, or use automatic allocation.")
        acc = accounts.get_account(db, account_id)
    job = UploadJob(id=job_id, filename=filename, size=size, staged_path=path, mode=mode,
                    mime_type=mime or mimetypes.guess_type(filename)[0] or "application/octet-stream",
                    requested_account_id=account_id if mode == "MANUAL" else None,
                    account_id=acc.id if acc else None, account_email=acc.email if acc else None,
                    destination_folder_id=None if folder_id in (None, "", "root") else folder_id,
                    destination_folder_name=folder_name, virtual_folder_id=virtual_folder_id)
    db.add(job)
    db.commit()
    events.publish(db, "upload.queued", {"id": job.id})
    return job


def cleanup_staging(job: UploadJob) -> None:
    d = os.path.dirname(job.staged_path)
    if d.startswith(os.path.join(get_settings().staging_dir, "jobs")):
        shutil.rmtree(d, ignore_errors=True)


def cancel(db: Session, job: UploadJob) -> UploadJob:
    if job.state in TERMINAL:
        raise AppError(409, "ALREADY_FINISHED", "This upload has already finished.")
    if job.state == "QUEUED":
        from app.core.time import utcnow
        job.state, job.finished_at = "CANCELLED", utcnow()
        db.commit()
        cleanup_staging(job)
        events.publish(db, "upload.updated", {"id": job.id})
    else:
        job.cancel_requested = True     # the worker notices between chunks and stops cleanly
        db.commit()
    return job


def retry(db: Session, job: UploadJob, account_id: str | None = None, folder_id: str | None = None, folder_name: str | None = None) -> UploadJob:
    if job.state not in ("FAILED", "CANCELLED"):
        raise AppError(409, "NOT_RETRYABLE", "Only failed or cancelled uploads can be retried.")
    if not os.path.isfile(job.staged_path):
        raise AppError(410, "STAGED_FILE_GONE", "The staged copy of this file was already cleaned up. Upload the file again.")
    if account_id:
        acc = accounts.get_account(db, account_id)
        job.mode, job.requested_account_id, job.account_id, job.account_email = "MANUAL", acc.id, acc.id, acc.email
        job.resumable_uri_enc = None; job.bytes_uploaded = 0         # a session belongs to one account
        if folder_id is not None or job.destination_folder_id:
            job.destination_folder_id = None if folder_id in (None, "", "root") else folder_id
            job.destination_folder_name = folder_name
    elif job.mode == "AUTO":
        job.account_id = None; job.account_email = None; job.resumable_uri_enc = None; job.bytes_uploaded = 0
    job.state, job.error_code, job.error_message, job.cancel_requested, job.finished_at = "QUEUED", None, None, False, None
    db.commit()
    events.publish(db, "upload.updated", {"id": job.id})
    return job


def to_dict(j: UploadJob) -> dict:
    from app.core.time import iso
    pct = round(100 * j.bytes_uploaded / j.size, 1) if j.size else (100.0 if j.state == "COMPLETED" else 0.0)
    return {"id": j.id, "filename": j.filename, "size": j.size, "mime_type": j.mime_type, "mode": j.mode, "state": j.state,
            "account_id": j.account_id, "account_email": j.account_email, "destination_folder_id": j.destination_folder_id,
            "destination_folder_name": j.destination_folder_name, "virtual_folder_id": j.virtual_folder_id, "bytes_uploaded": j.bytes_uploaded, "progress": pct,
            "google_file_id": j.google_file_id, "error_code": j.error_code, "error_message": j.error_message,
            "allocation_reason": j.allocation_reason, "attempts": j.attempts, "cancel_requested": j.cancel_requested,
            "created_at": iso(j.created_at), "finished_at": iso(j.finished_at), "retryable": j.state in ("FAILED", "CANCELLED")}
