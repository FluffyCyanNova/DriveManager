"""Move a file from one connected account to another without downloading it through this server.

1. Transfer ownership (preferred): the source offers ownership to the target account, the target accepts (both are
   connected, so DriveManager can act as each), the file is re-parented into the target's folder and the source's
   leftover access is removed. Same file ID, link, comments, history and sharing. Google allows this between personal
   accounts (or inside one Workspace organisation) for files the source owns in My Drive.
2. Copy (fallback): the target gets temporary read access, makes a server-side copy into its own Drive, the original
   goes to the source's Trash, and the temporary access is removed. New file ID and link; comments/history aren't kept.

Only single files for now. The target's free space is checked before anything changes.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.database.models import Account, DriveFile, DriveFileParent, VirtualFolderItem
from app.database.repositories import files as frepo
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive.client import DriveClient
from app.services import accounts, events, quota, sync
from app.services.file_ops import _local

log = logging.getLogger(__name__)


def move(db: Session, account_id: str, file_id: str, target_account_id: str, target_folder_id: str | None) -> dict:
    if account_id == target_account_id:
        raise AppError(400, "SAME_ACCOUNT", "Choose a different account to move it to. Use Move to… within one account.")
    src = accounts.get_account(db, account_id)
    dst = accounts.get_account(db, target_account_id)
    row = _local(db, src, file_id)
    if row.is_folder:
        raise AppError(400, "FOLDERS_NOT_SUPPORTED", "Folders can't be moved between accounts yet. Move the files inside instead.")
    if row.shortcut_target_id:
        raise AppError(400, "SHORTCUT", "This is a shortcut. Move the original file instead.")
    if row.trashed:
        raise AppError(400, "IN_TRASH", "Restore the file before moving it to another account.")
    _check_space(db, dst, row)
    folder = None if target_folder_id in (None, "", "root") else target_folder_id

    method, new_meta = None, None
    if row.owned_by_me and not row.drive_id:
        try:
            new_meta = _transfer(db, src, dst, row, folder)
            method = "transfer"
        except _Fallback as e:
            log.info("Ownership transfer of %s refused (%s); copying instead", file_id, e)
    if method is None:
        new_meta = _copy(db, src, dst, row, folder)
        method = "copy"

    # local index + virtual-folder references follow the file
    sync.upsert_files(db, dst, [new_meta])
    if method == "transfer":
        row.status = "REMOVED"
    for it in db.scalars(select(VirtualFolderItem).where(VirtualFolderItem.account_id == src.id, VirtualFolderItem.google_file_id == file_id)):
        clash = db.scalar(select(VirtualFolderItem.id).where(VirtualFolderItem.folder_id == it.folder_id,
                                                             VirtualFolderItem.account_id == dst.id, VirtualFolderItem.google_file_id == new_meta["id"]))
        if clash:
            db.delete(it)
        else:
            it.account_id, it.google_file_id = dst.id, new_meta["id"]
    db.commit()
    events.record_activity(db, "move_account", account=src, google_file_id=file_id, file_name=row.name,
                           details={"to": dst.email, "method": method})
    for a in (src, dst):
        events.publish(db, "files.changed", {"account_id": a.id})
        try:
            quota.refresh(db, a)
        except Exception as e:  # noqa: BLE001 - best effort, Google can lag anyway
            log.warning("Quota refresh after cross-account move failed for %s: %s", a.email, e)
    moved = db.scalar(select(DriveFile).where(DriveFile.account_id == dst.id, DriveFile.google_file_id == new_meta["id"]))
    return {"method": method, "file": frepo.to_dict(moved, dst.email)}


class _Fallback(Exception):
    """Google refused the ownership transfer in a way that a copy can still handle."""


def _check_space(db: Session, dst: Account, row: DriveFile) -> None:
    q = accounts.latest_quota(db, dst.id)
    if q and q.limit is not None and row.size and q.limit - q.usage < row.size:
        free = max(q.limit - q.usage, 0)
        raise AppError(409, "INSUFFICIENT_SPACE", f"{dst.email} has {free / 1024**3:.2f} GB free but the file needs "
                       f"{row.size / 1024**3:.2f} GB. Nothing was changed.")


def _transfer(db: Session, src: Account, dst: Account, row: DriveFile, folder: str | None) -> dict:
    fid = row.google_file_id
    cs, cd = DriveClient(src), DriveClient(dst)
    offered = None
    try:
        with accounts.drive_errors(db, src):
            perm = gfiles.create_permission(cs, fid, {"type": "user", "role": "writer", "emailAddress": dst.email}, notify=False)
            offered = perm["id"]
            gfiles.update_permission(cs, fid, offered, "writer", pending_owner=True)
        with accounts.drive_errors(db, dst):
            gfiles.update_permission(cd, fid, offered, "owner", transfer_ownership=True)
    except AppError as e:
        if e.status in (400, 403):            # cross-domain, Workspace policy, file type not transferable, ...
            if offered:                       # undo the half-done offer so the copy path starts clean
                try:
                    with accounts.drive_errors(db, src):
                        gfiles.delete_permission(cs, fid, offered)
                except AppError:
                    pass
            raise _Fallback(e.code) from None
        raise
    # Ownership is now with dst. Take it out of src's folders, put it where dst wants it, drop src's leftover access.
    old_parents = list(db.scalars(select(DriveFileParent.parent_google_id).where(DriveFileParent.file_id == row.id)))
    with accounts.drive_errors(db, src):
        if old_parents:
            gfiles.update_parents(cs, fid, remove=old_parents)
    with accounts.drive_errors(db, dst):
        meta = gfiles.update_parents(cd, fid, add=folder or dst.root_folder_id or "root")
    try:
        with accounts.drive_errors(db, src):
            gfiles.delete_permission(cs, fid, gfiles.about(cs)["user"]["permissionId"])
    except AppError as e:                     # harmless leftover: src can still see the file via "Shared with me"
        log.warning("Couldn't remove %s's leftover access to %s: %s", src.email, fid, e.message)
    return meta


def _copy(db: Session, src: Account, dst: Account, row: DriveFile, folder: str | None) -> dict:
    fid = row.google_file_id
    cs, cd = DriveClient(src), DriveClient(dst)
    with accounts.drive_errors(db, src):
        temp = gfiles.create_permission(cs, fid, {"type": "user", "role": "reader", "emailAddress": dst.email}, notify=False)
    try:
        with accounts.drive_errors(db, dst):
            meta = gfiles.copy_file(cd, fid, row.name, folder or dst.root_folder_id)
    except AppError:
        _drop(db, src, cs, fid, temp["id"])
        raise
    with accounts.drive_errors(db, src):
        trashed = gfiles.set_trashed(cs, fid, True)
    sync.upsert_files(db, src, [trashed])
    _drop(db, src, cs, fid, temp["id"])
    return meta


def _drop(db: Session, src: Account, c: DriveClient, fid: str, permission_id: str) -> None:
    try:
        with accounts.drive_errors(db, src):
            gfiles.delete_permission(c, fid, permission_id)
    except AppError as e:
        log.warning("Couldn't remove temporary access on %s: %s", fid, e.message)

