"""Virtual folders organise references to Drive items across accounts. They never change anything in Google Drive."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.time import iso
from app.database.models import Account, DriveFile, VirtualFolder, VirtualFolderItem
from app.database.repositories import files as frepo


def _get(db: Session, folder_id: str) -> VirtualFolder:
    f = db.get(VirtualFolder, folder_id)
    if not f:
        raise AppError(404, "FOLDER_NOT_FOUND", "Virtual folder was not found.")
    return f


def _check_name(db: Session, name: str, parent_id: str | None, exclude_id: str | None = None) -> str:
    name = name.strip()
    if not name:
        raise AppError(400, "BAD_NAME", "Folder name can't be empty.")
    q = select(VirtualFolder).where(VirtualFolder.name == name, VirtualFolder.parent_id == parent_id if parent_id else VirtualFolder.parent_id.is_(None))
    dup = db.scalar(q)
    if dup and dup.id != exclude_id:
        raise AppError(409, "DUPLICATE_NAME", f"A virtual folder named \"{name}\" already exists here.")
    return name


def tree(db: Session) -> list[dict]:
    rows = db.scalars(select(VirtualFolder).order_by(VirtualFolder.name)).all()
    counts = {}
    for fid, in db.execute(select(VirtualFolderItem.folder_id)):
        counts[fid] = counts.get(fid, 0) + 1
    return [{"id": r.id, "parent_id": r.parent_id, "name": r.name, "item_count": counts.get(r.id, 0), "created_at": iso(r.created_at)} for r in rows]


def create(db: Session, name: str, parent_id: str | None) -> VirtualFolder:
    if parent_id:
        _get(db, parent_id)
    f = VirtualFolder(name=_check_name(db, name, parent_id), parent_id=parent_id)
    db.add(f)
    db.commit()
    return f


def update(db: Session, folder_id: str, name: str | None, parent_id: str | None, move: bool) -> VirtualFolder:
    f = _get(db, folder_id)
    new_parent = parent_id if move else f.parent_id
    if move and parent_id:
        _get(db, parent_id)
        cur = parent_id          # moving a folder beneath itself or its descendants would create a cycle
        while cur:
            if cur == folder_id:
                raise AppError(400, "CYCLE", "A folder can't be moved inside itself.")
            cur = db.scalar(select(VirtualFolder.parent_id).where(VirtualFolder.id == cur))
    f.name = _check_name(db, name if name is not None else f.name, new_parent, exclude_id=f.id)
    f.parent_id = new_parent
    db.commit()
    return f


def delete(db: Session, folder_id: str) -> None:
    db.delete(_get(db, folder_id))   # cascades to child folders and item references only
    db.commit()


def add_items(db: Session, folder_id: str, items: list[dict]) -> int:
    _get(db, folder_id)
    added, seen = 0, set()
    for it in items:
        row = db.scalar(select(DriveFile).where(DriveFile.account_id == it["account_id"], DriveFile.google_file_id == it["google_file_id"]))
        if not row or row.status != "ACTIVE" or (row.account_id, row.google_file_id) in seen:
            continue
        seen.add((row.account_id, row.google_file_id))
        if db.scalar(select(VirtualFolderItem.id).where(VirtualFolderItem.folder_id == folder_id, VirtualFolderItem.account_id == row.account_id,
                                                         VirtualFolderItem.google_file_id == row.google_file_id)):
            continue
        db.add(VirtualFolderItem(folder_id=folder_id, account_id=row.account_id, google_file_id=row.google_file_id,
                                 cached_name=row.name, cached_mime=row.mime_type))
        added += 1
    db.commit()
    return added


def remove_item(db: Session, folder_id: str, item_id: str) -> None:
    it = db.get(VirtualFolderItem, item_id)
    if not it or it.folder_id != folder_id:
        raise AppError(404, "ITEM_NOT_FOUND", "Item was not found in this folder.")
    db.delete(it)
    db.commit()


def move_item(db: Session, item_id: str, target_folder_id: str) -> None:
    it = db.get(VirtualFolderItem, item_id)
    if not it:
        raise AppError(404, "ITEM_NOT_FOUND", "Item was not found.")
    _get(db, target_folder_id)
    if db.scalar(select(VirtualFolderItem.id).where(VirtualFolderItem.folder_id == target_folder_id, VirtualFolderItem.account_id == it.account_id,
                                                     VirtualFolderItem.google_file_id == it.google_file_id)):
        db.delete(it)          # already there: just drop the duplicate reference
    else:
        it.folder_id = target_folder_id
    db.commit()


def list_items(db: Session, folder_id: str) -> dict:
    folder = _get(db, folder_id)
    out = []
    for it in db.scalars(select(VirtualFolderItem).where(VirtualFolderItem.folder_id == folder_id).order_by(VirtualFolderItem.added_at.desc())):
        acc = db.get(Account, it.account_id)
        f = db.scalar(select(DriveFile).where(DriveFile.account_id == it.account_id, DriveFile.google_file_id == it.google_file_id))
        base = {"item_id": it.id, "account_id": it.account_id, "account_email": acc.email if acc else None, "google_file_id": it.google_file_id}
        if f is None or f.status != "ACTIVE":
            out.append({**base, "status": "missing", "name": it.cached_name, "mime_type": it.cached_mime, "file": None})
        elif acc and acc.status != "ACTIVE":
            out.append({**base, "status": "inaccessible", "name": f.name, "mime_type": f.mime_type, "file": frepo.to_dict(f, acc.email)})
        else:
            out.append({**base, "status": "trashed" if f.trashed else "ok", "name": f.name, "mime_type": f.mime_type,
                        "file": frepo.to_dict(f, acc.email if acc else None)})
            if it.cached_name != f.name:
                it.cached_name, it.cached_mime = f.name, f.mime_type
    db.commit()
    return {"folder": {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id}, "items": out}
