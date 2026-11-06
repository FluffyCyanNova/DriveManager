from __future__ import annotations

from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.core.exceptions import AppError
from app.database.database import get_db
from app.database.models import Account, Drive
from app.database.repositories import files as frepo
from app.services import file_ops

router = APIRouter(prefix="/api", tags=["files"], dependencies=[Depends(require_auth)])


class RenameBody(BaseModel):
    name: str = Field(min_length=1, max_length=1000)


class MoveBody(BaseModel):
    destination_id: str = Field(min_length=1, max_length=200)


class FolderBody(BaseModel):
    name: str = Field(min_length=1, max_length=1000)
    parent_id: str | None = None


@router.get("/files")
def list_files(account_id: str | None = None, location: str | None = Query(None, pattern="^(my_drive|shared_with_me|shared_drive)$"),
               parent_id: str | None = None, q: str | None = Query(None, max_length=200), type: str | None = None,
               modified_after: datetime | None = None, modified_before: datetime | None = None,
               min_size: int | None = Query(None, ge=0), max_size: int | None = Query(None, ge=0),
               trashed: bool = False, folders_only: bool = False,
               sort: str = Query("name", pattern="^(name|modified|size|type)$"), direction: str = Query("asc", pattern="^(asc|desc)$"),
               page: int = Query(1, ge=1), page_size: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    fq = frepo.FileQuery(account_id=account_id, location=location, parent_id=parent_id, q=q, type=type, modified_after=modified_after,
                         modified_before=modified_before, min_size=min_size, max_size=max_size, trashed=trashed,
                         folders_only=folders_only, sort=sort, direction=direction, page=page, page_size=page_size)
    rows, total = frepo.run(db, fq)
    return {"items": [frepo.to_dict(f, e) for f, e in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/drives")
def all_drives(db: Session = Depends(get_db)):
    q = select(Drive, Account.email).join(Account, Account.id == Drive.account_id).where(Drive.kind == "SHARED_DRIVE").order_by(Drive.name)
    return [{"id": d.google_drive_id, "name": d.name, "account_id": d.account_id, "account_email": e} for d, e in db.execute(q)]


@router.get("/drives/{account_id}")
def account_drives(account_id: str, db: Session = Depends(get_db)):
    return [x for x in all_drives(db) if x["account_id"] == account_id]


@router.post("/files/{account_id}/folders")
def create_folder(account_id: str, body: FolderBody, db: Session = Depends(get_db)):
    return frepo.to_dict(file_ops.create_folder(db, account_id, body.name, body.parent_id))


@router.patch("/files/{account_id}/{file_id}")
def rename(account_id: str, file_id: str, body: RenameBody, db: Session = Depends(get_db)):
    return frepo.to_dict(file_ops.rename(db, account_id, file_id, body.name))


@router.post("/files/{account_id}/{file_id}/move")
def move(account_id: str, file_id: str, body: MoveBody, db: Session = Depends(get_db)):
    return frepo.to_dict(file_ops.move(db, account_id, file_id, body.destination_id))


@router.post("/files/{account_id}/{file_id}/trash")
def trash(account_id: str, file_id: str, db: Session = Depends(get_db)):
    return frepo.to_dict(file_ops.trash(db, account_id, file_id))


@router.post("/files/{account_id}/{file_id}/restore")
def restore(account_id: str, file_id: str, db: Session = Depends(get_db)):
    return frepo.to_dict(file_ops.restore(db, account_id, file_id))


@router.delete("/files/{account_id}/{file_id}")
def delete(account_id: str, file_id: str, permanent: bool = False, confirm: bool = False, db: Session = Depends(get_db)):
    """Default: move to Google Drive trash (recoverable). permanent=true also requires confirm=true."""
    if not permanent:
        return frepo.to_dict(file_ops.trash(db, account_id, file_id))
    if not confirm:
        raise AppError(400, "CONFIRM_REQUIRED", "Permanent deletion cannot be undone. Confirm it explicitly.")
    file_ops.delete_permanently(db, account_id, file_id)
    return {"ok": True}


@router.post("/files/{account_id}/trash/empty")
def empty_trash(account_id: str, confirm: bool = False, db: Session = Depends(get_db)):
    """Permanently delete everything in this account's trash. Requires confirm=true."""
    if not confirm:
        raise AppError(400, "CONFIRM_REQUIRED", "Emptying the trash cannot be undone. Confirm it explicitly.")
    return {"ok": True, "removed": file_ops.empty_trash(db, account_id)}


@router.get("/files/{account_id}/{file_id}/download")
def download(account_id: str, file_id: str, format: str | None = Query(None, max_length=10), db: Session = Depends(get_db)):
    stream = file_ops.open_download(db, account_id, file_id, format)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(stream.filename)}", "Cache-Control": "no-store",
               "X-Content-Type-Options": "nosniff"}
    if stream.size:
        headers["Content-Length"] = str(stream.size)
    return StreamingResponse(stream.iter(), media_type=stream.mime, headers=headers)
