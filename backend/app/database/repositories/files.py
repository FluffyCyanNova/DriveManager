"""Query builder for the local file index (search, filters, sorting, pagination)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.database.models import FOLDER_MIME, Account, DriveFile, DriveFileParent

TYPE_FILTERS: dict[str, list[str]] = {
    "image": ["image/%"], "video": ["video/%"], "audio": ["audio/%"],
    "pdf": ["application/pdf"],
    "document": ["application/vnd.google-apps.document", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml%",
                 "application/vnd.oasis.opendocument.text", "text/%", "application/rtf"],
    "spreadsheet": ["application/vnd.google-apps.spreadsheet", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml%",
                    "application/vnd.oasis.opendocument.spreadsheet", "text/csv"],
    "presentation": ["application/vnd.google-apps.presentation", "application/vnd.ms-powerpoint",
                     "application/vnd.openxmlformats-officedocument.presentationml%"],
    "archive": ["application/zip", "application/x-zip%", "application/x-rar%", "application/vnd.rar", "application/x-7z%",
                "application/x-tar", "application/gzip", "application/x-gzip"],
}
SORTS = {"name": func.lower(DriveFile.name), "modified": DriveFile.modified_time, "size": DriveFile.size, "type": DriveFile.mime_type,
         "account": func.lower(Account.email)}


@dataclass
class FileQuery:
    account_id: str | None = None
    location: str | None = None          # my_drive | shared_with_me | shared_drive
    parent_id: str | None = None
    q: str | None = None
    type: str | None = None
    modified_after: datetime | None = None
    modified_before: datetime | None = None
    min_size: int | None = None
    max_size: int | None = None
    trashed: bool = False
    folders_only: bool = False
    all_files: bool = False              # every file at any depth in `location` (folders hidden), instead of one folder level
    sort: str = "name"
    direction: str = "asc"
    folders: str = "first"               # first | last | mixed: where folders go relative to files
    page: int = 1
    page_size: int = 100


def _type_clause(t: str):
    if t == "folder":
        return DriveFile.mime_type == FOLDER_MIME
    if t == "other":
        known = [p for v in TYPE_FILTERS.values() for p in v] + [FOLDER_MIME]
        return and_(*[~DriveFile.mime_type.like(p) for p in known])
    return or_(*[DriveFile.mime_type.like(p) for p in TYPE_FILTERS.get(t, [])]) if t in TYPE_FILTERS else None


def build(fq: FileQuery) -> Select:
    stmt = select(DriveFile, Account.email).join(Account, Account.id == DriveFile.account_id).where(DriveFile.status == "ACTIVE")
    stmt = stmt.where(DriveFile.trashed.is_(fq.trashed))
    if fq.account_id:
        stmt = stmt.where(DriveFile.account_id == fq.account_id)
    if fq.q:
        like = "%" + fq.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(DriveFile.name.ilike(like, escape="\\"))
    elif fq.all_files:
        stmt = stmt.where(DriveFile.is_folder.is_(False))
    elif fq.parent_id:
        stmt = stmt.where(exists().where(DriveFileParent.file_id == DriveFile.id, DriveFileParent.parent_google_id == fq.parent_id))
    elif not fq.trashed and fq.location:
        if fq.location == "my_drive":
            stmt = stmt.where(exists().where(DriveFileParent.file_id == DriveFile.id,
                                             DriveFileParent.parent_google_id == Account.root_folder_id))
        elif fq.location == "shared_with_me":
            P, PF = aliased(DriveFileParent), aliased(DriveFile)
            has_indexed_parent = exists().where(P.file_id == DriveFile.id).where(
                or_(P.parent_google_id == Account.root_folder_id,
                    exists().where(PF.account_id == DriveFile.account_id, PF.google_file_id == P.parent_google_id, PF.status == "ACTIVE")))
            stmt = stmt.where(DriveFile.location == "SHARED_WITH_ME", ~has_indexed_parent)
    if fq.location and (fq.q or fq.trashed or fq.all_files):
        loc = {"my_drive": "MY_DRIVE", "shared_with_me": "SHARED_WITH_ME", "shared_drive": "SHARED_DRIVE"}.get(fq.location)
        if loc:
            stmt = stmt.where(DriveFile.location == loc)
    if fq.folders_only:
        stmt = stmt.where(DriveFile.is_folder.is_(True))
    if fq.type and (c := _type_clause(fq.type)) is not None:
        stmt = stmt.where(c)
    if fq.modified_after:
        stmt = stmt.where(DriveFile.modified_time >= fq.modified_after)
    if fq.modified_before:
        stmt = stmt.where(DriveFile.modified_time <= fq.modified_before)
    if fq.min_size is not None:
        stmt = stmt.where(DriveFile.size >= fq.min_size)
    if fq.max_size is not None:
        stmt = stmt.where(DriveFile.size <= fq.max_size)
    return stmt


def run(db: Session, fq: FileQuery) -> tuple[list[tuple[DriveFile, str]], int]:
    stmt = build(fq)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    col = SORTS.get(fq.sort, SORTS["name"])
    order = col.desc() if fq.direction == "desc" else col.asc()
    keys = [order]
    if fq.folders == "first":
        keys.insert(0, DriveFile.is_folder.desc())
    elif fq.folders == "last":
        keys.insert(0, DriveFile.is_folder.asc())
    if fq.sort != "name":   # tie-break by name so equal values (same account, same size) stay readable
        keys.append(SORTS["name"].asc())
    stmt = stmt.order_by(*keys, DriveFile.id).offset((fq.page - 1) * fq.page_size).limit(fq.page_size)
    return [(f, e) for f, e in db.execute(stmt).all()], total


def to_dict(f: DriveFile, email: str | None = None) -> dict:
    from app.core.time import iso
    caps = f.capabilities or {}
    return {"id": f.id, "account_id": f.account_id, "account_email": email, "google_file_id": f.google_file_id, "name": f.name,
            "mime_type": f.mime_type, "is_folder": f.is_folder, "size": f.size, "modified_time": iso(f.modified_time),
            "created_time": iso(f.created_time), "trashed": f.trashed, "location": f.location, "owner_email": f.owner_email,
            "owned_by_me": f.owned_by_me, "web_view_link": f.web_view_link, "drive_id": f.drive_id,
            "shortcut_target_id": f.shortcut_target_id,
            "can": {"rename": caps.get("canRename", True), "trash": caps.get("canTrash", True), "delete": caps.get("canDelete", False),
                    "download": caps.get("canDownload", True), "add_children": caps.get("canAddChildren", f.is_folder),
                    "move": caps.get("canMoveItemWithinDrive", True), "untrash": caps.get("canUntrash", True),
                    "share": caps.get("canShare", True)}}


def parents_for(db: Session, files: list[DriveFile]) -> dict[str, dict | None]:
    """For the all-files view: the indexed folder each file sits in (first parent), or None at the top level."""
    if not files:
        return {}
    links = db.execute(select(DriveFileParent.file_id, DriveFileParent.parent_google_id)
                       .where(DriveFileParent.file_id.in_([f.id for f in files]))).all()
    first: dict[str, str] = {}
    for fid, pid in links:
        first.setdefault(fid, pid)
    acc_of = {f.id: f.account_id for f in files}
    wanted = {(acc_of[fid], pid) for fid, pid in first.items()}
    names = {(a, g): n for a, g, n in db.execute(select(DriveFile.account_id, DriveFile.google_file_id, DriveFile.name).where(
        DriveFile.google_file_id.in_({g for _, g in wanted}), DriveFile.status == "ACTIVE", DriveFile.is_folder.is_(True)))}
    out = {}
    for f in files:
        pid = first.get(f.id)
        name = names.get((f.account_id, pid)) if pid else None
        out[f.id] = {"id": pid, "name": name} if name else None
    return out


def folder_path(db: Session, account_id: str, folder_google_id: str | None, max_depth: int = 30) -> str | None:
    """Human path of a destination folder from the local index, e.g. "My Drive / Work / Projects" or
    "Team Drive / Reports". None if the account has no root yet; the bare folder name if its parents aren't indexed."""
    acc = db.get(Account, account_id)
    if not acc:
        return None
    if not folder_google_id or folder_google_id in ("root", acc.root_folder_id):
        return "My Drive"
    names: list[str] = []
    current = folder_google_id
    for _ in range(max_depth):
        row = db.scalar(select(DriveFile).where(DriveFile.account_id == account_id, DriveFile.google_file_id == current))
        if row is None:
            from app.database.models import Drive
            drive = db.scalar(select(Drive).where(Drive.account_id == account_id, Drive.google_drive_id == current))
            if drive:
                names.append(drive.name)
            break
        names.append(row.name)
        parent = db.scalar(select(DriveFileParent.parent_google_id).where(DriveFileParent.file_id == row.id))
        if not parent:
            break
        if parent == acc.root_folder_id:
            names.append("My Drive")
            break
        current = parent
    return " / ".join(reversed(names)) if names else None
