from __future__ import annotations

import os
import shutil

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.config import get_settings
from app.core.exceptions import AppError
from app.database.database import get_db
from app.database.models import UploadJob
from app.services import events, uploads

router = APIRouter(prefix="/api/uploads", tags=["uploads"], dependencies=[Depends(require_auth)])
DISK_RESERVE = 512 * 1024 * 1024


class RetryBody(BaseModel):
    account_id: str | None = None
    folder_id: str | None = None
    folder_name: str | None = None


@router.post("")
def create_upload(request: Request, file: UploadFile = File(...), mode: str = Form("MANUAL"), account_id: str | None = Form(None),
                  folder_id: str | None = Form(None), folder_name: str | None = Form(None),
                  virtual_folder_id: str | None = Form(None), db: Session = Depends(get_db)):
    s = get_settings()
    declared = int(request.headers.get("content-length") or 0)
    os.makedirs(os.path.join(s.staging_dir, "jobs"), exist_ok=True)
    if declared and shutil.disk_usage(s.staging_dir).free < declared + DISK_RESERVE:
        raise AppError(507, "STAGING_FULL", "The server doesn't have enough free disk space to stage this file.")
    name = uploads.safe_filename(file.filename or "upload")
    job_id = uploads.new_job_id()
    path = uploads.staging_path(job_id, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, "wb") as out:
            shutil.copyfileobj(file.file, out, 1024 * 1024)
        size = os.path.getsize(path)
        job = uploads.create(db, job_id=job_id, filename=name, size=size, mime=file.content_type, path=path, mode=mode.upper(),
                             account_id=account_id, folder_id=folder_id, folder_name=folder_name,
                             virtual_folder_id=virtual_folder_id)
    except OSError:
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)
        raise AppError(507, "STAGING_FAILED", "Writing the file to the server failed (disk full?).") from None
    except Exception:
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)
        raise
    return uploads.to_dict(job, db)


@router.get("")
def list_jobs(state: str | None = None, limit: int = 100, db: Session = Depends(get_db)):
    q = select(UploadJob).order_by(UploadJob.created_at.desc()).limit(min(max(limit, 1), 500))
    if state:
        q = q.where(UploadJob.state.in_(state.split(",")))
    return [uploads.to_dict(j, db) for j in db.scalars(q)]


def _job(db: Session, job_id: str) -> UploadJob:
    j = db.get(UploadJob, job_id)
    if not j:
        raise AppError(404, "UPLOAD_NOT_FOUND", "Upload was not found.")
    return j


@router.get("/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    return uploads.to_dict(_job(db, job_id), db)


@router.post("/{job_id}/cancel")
def cancel(job_id: str, db: Session = Depends(get_db)):
    return uploads.to_dict(uploads.cancel(db, _job(db, job_id)), db)


@router.post("/{job_id}/retry")
def retry(job_id: str, body: RetryBody | None = None, db: Session = Depends(get_db)):
    b = body or RetryBody()
    return uploads.to_dict(uploads.retry(db, _job(db, job_id), b.account_id, b.folder_id, b.folder_name), db)


@router.delete("/{job_id}")
def remove(job_id: str, db: Session = Depends(get_db)):
    j = _job(db, job_id)
    if j.state in uploads.ACTIVE_STATES:
        raise AppError(409, "STILL_ACTIVE", "Cancel the upload before removing it from the list.")
    uploads.cleanup_staging(j)
    db.delete(j)
    db.commit()
    return {"ok": True}
