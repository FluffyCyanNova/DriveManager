"""Live file operations. Google is the source of truth: call Drive first, then refresh the local index."""
from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.database.models import Account, DriveFile, DriveFileParent
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive import transfer
from app.integrations.google_drive.client import DriveClient
from app.services import accounts, events, sync

log = logging.getLogger(__name__)


def _local(db: Session, acc: Account, google_file_id: str) -> DriveFile:
    row = db.scalar(select(DriveFile).where(DriveFile.account_id == acc.id, DriveFile.google_file_id == google_file_id))
    if row and row.status == "ACTIVE":
        return row
    with accounts.drive_errors(db, acc):   # not indexed yet (or stale): ask Google
        meta = gfiles.get_file(DriveClient(acc), google_file_id)
    sync.upsert_files(db, acc, [meta])
    return db.scalar(select(DriveFile).where(DriveFile.account_id == acc.id, DriveFile.google_file_id == google_file_id))


def _need(row: DriveFile, cap: str, verb: str) -> None:
    if (row.capabilities or {}).get(cap) is False:
        raise AppError(403, "NOT_ALLOWED", f"Google says you can't {verb} \"{row.name}\" with this account.")


def _done(db: Session, acc: Account, meta: dict, event: str, details: dict | None = None) -> DriveFile:
    sync.upsert_files(db, acc, [meta])
    events.record_activity(db, event, account=acc, google_file_id=meta["id"], file_name=meta.get("name"), details=details)
    events.publish(db, "files.changed", {"account_id": acc.id})
    return db.scalar(select(DriveFile).where(DriveFile.account_id == acc.id, DriveFile.google_file_id == meta["id"]))


def rename(db: Session, account_id: str, file_id: str, name: str) -> DriveFile:
    name = name.strip()
    if not name or "/" in name and False:
        raise AppError(400, "BAD_NAME", "Name can't be empty.")
    acc = accounts.get_account(db, account_id)
    row = _local(db, acc, file_id)
    _need(row, "canRename", "rename")
    old = row.name
    with accounts.drive_errors(db, acc):
        meta = gfiles.rename(DriveClient(acc), file_id, name)
    return _done(db, acc, meta, "rename", {"from": old, "to": name})


def trash(db: Session, account_id: str, file_id: str) -> DriveFile:
    acc = accounts.get_account(db, account_id)
    row = _local(db, acc, file_id)
    _need(row, "canTrash", "move to trash")
    with accounts.drive_errors(db, acc):
        meta = gfiles.set_trashed(DriveClient(acc), file_id, True)
    return _done(db, acc, meta, "trash")


def restore(db: Session, account_id: str, file_id: str) -> DriveFile:
    acc = accounts.get_account(db, account_id)
    row = _local(db, acc, file_id)
    _need(row, "canUntrash", "restore")
    with accounts.drive_errors(db, acc):
        meta = gfiles.set_trashed(DriveClient(acc), file_id, False)
    return _done(db, acc, meta, "restore")


def delete_permanently(db: Session, account_id: str, file_id: str) -> None:
    acc = accounts.get_account(db, account_id)
    row = _local(db, acc, file_id)
    _need(row, "canDelete", "permanently delete")
    name = row.name
    with accounts.drive_errors(db, acc):
        gfiles.delete_permanently(DriveClient(acc), file_id)
    row.status = "REMOVED"
    if row.is_folder:
        _remove_descendants(db, acc, row)
    db.commit()
    events.record_activity(db, "delete_permanent", account=acc, google_file_id=file_id, file_name=name)
    events.publish(db, "files.changed", {"account_id": acc.id})


def _remove_descendants(db: Session, acc: Account, folder: DriveFile) -> None:
    """Mirror Drive in the local index: deleting a folder also deletes everything under it that the account owns
    (in a shared drive, everything under it). Items owned by others just lose this parent; the next sync settles them."""
    pending, seen = [folder.google_file_id], {folder.google_file_id}
    while pending:
        parent = pending.pop()
        kids = db.scalars(select(DriveFile).join(DriveFileParent, DriveFileParent.file_id == DriveFile.id).where(
            DriveFileParent.account_id == acc.id, DriveFileParent.parent_google_id == parent, DriveFile.status == "ACTIVE")).all()
        for k in kids:
            if folder.drive_id or k.owned_by_me:
                k.status = "REMOVED"
            if k.is_folder and k.google_file_id not in seen:
                seen.add(k.google_file_id)
                pending.append(k.google_file_id)


def empty_trash(db: Session, account_id: str) -> int:
    """Empty one account's Google Drive trash. Returns how many indexed items were removed.

    Google's emptyTrash only deletes trashed items the account owns in My Drive; shared-drive trash and
    files owned by other people are left alone, so the local index is updated the same way.
    """
    acc = accounts.get_account(db, account_id)
    where = [DriveFile.account_id == acc.id, DriveFile.status == "ACTIVE", DriveFile.trashed.is_(True),
             DriveFile.drive_id.is_(None), DriveFile.owned_by_me.is_(True)]
    count = len(db.scalars(select(DriveFile.id).where(*where)).all())
    with accounts.drive_errors(db, acc):
        gfiles.empty_trash(DriveClient(acc))
    db.execute(update(DriveFile).where(*where).values(status="REMOVED"))
    db.commit()
    events.record_activity(db, "empty_trash", account=acc, details={"count": count})
    events.publish(db, "files.changed", {"account_id": acc.id})
    try:   # best effort: freed space shows up sooner (Google can still lag a few minutes)
        from app.services import quota
        quota.refresh(db, acc)
    except Exception as e:  # noqa: BLE001
        log.warning("Quota refresh after emptying trash failed for %s: %s", acc.email, e)
    return count


def move(db: Session, account_id: str, file_id: str, destination_id: str) -> DriveFile:
    acc = accounts.get_account(db, account_id)
    row = _local(db, acc, file_id)
    _need(row, "canMoveItemWithinDrive", "move")
    dest = acc.root_folder_id if destination_id == "root" else destination_id
    if dest == file_id:
        raise AppError(400, "BAD_DESTINATION", "A folder can't be moved into itself.")
    client = DriveClient(acc)
    with accounts.drive_errors(db, acc):
        live = gfiles.get_file(client, file_id, "id,parents")
        target = gfiles.get_file(client, dest, "id,mimeType,capabilities")
        if target.get("mimeType") != gfiles.FOLDER_MIME and destination_id != "root":
            raise AppError(400, "BAD_DESTINATION", "The destination is not a folder.")
        if (target.get("capabilities") or {}).get("canAddChildren") is False:
            raise AppError(403, "NOT_ALLOWED", "You can't add items to that folder.")
        meta = gfiles.move(client, file_id, dest, live.get("parents", []))
    return _done(db, acc, meta, "move", {"destination": dest})


def create_folder(db: Session, account_id: str, name: str, parent_id: str | None) -> DriveFile:
    name = name.strip()
    if not name:
        raise AppError(400, "BAD_NAME", "Folder name can't be empty.")
    acc = accounts.get_account(db, account_id)
    with accounts.drive_errors(db, acc):
        meta = gfiles.create_folder(DriveClient(acc), name, None if parent_id in (None, "root") else parent_id)
    return _done(db, acc, meta, "create_folder")


def open_download(db: Session, account_id: str, file_id: str, fmt: str | None):
    acc = accounts.get_account(db, account_id)
    row = _local(db, acc, file_id)
    if row.is_folder:
        raise AppError(400, "IS_FOLDER", "Folders can't be downloaded. Download the files inside instead.")
    _need(row, "canDownload", "download")
    client = DriveClient(acc)
    with accounts.drive_errors(db, acc):
        meta = gfiles.get_file(client, row.shortcut_target_id or file_id, "id,name,mimeType,size")
        stream = transfer.open_download(client, meta, fmt)
    events.record_activity(db, "download", account=acc, google_file_id=file_id, file_name=row.name)
    return stream
