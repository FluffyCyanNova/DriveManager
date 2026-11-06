"""Share / Copy link: change who can open a Drive item. Google stays the source of truth; nothing is cached locally."""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive.client import DriveApiError, DriveClient
from app.services import accounts, events
from app.services.file_ops import _local, _need

ROLES = ("reader", "commenter", "writer")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_PEOPLE = 50


def _state(c: DriveClient, row) -> dict:
    perms = gfiles.list_permissions(c, row.google_file_id)
    link = next((p for p in perms if p.get("type") == "anyone"), None)
    people = [{"id": p["id"], "type": p.get("type"), "role": p.get("role"),
               "email": (p.get("emailAddress") or "").lower() or None, "name": p.get("displayName"),
               "domain": p.get("domain"), "pending_owner": bool(p.get("pendingOwner"))}
              for p in perms if p.get("type") != "anyone"]
    people.sort(key=lambda p: (p["role"] != "owner", p["email"] or p["domain"] or ""))
    return {"file_id": row.google_file_id, "name": row.name, "is_folder": row.is_folder, "web_view_link": row.web_view_link,
            "can_share": (row.capabilities or {}).get("canShare", True), "link": link["role"] if link else None,
            "people": people}


def _open(db: Session, account_id: str, file_id: str, change: bool):
    acc = accounts.get_account(db, account_id)
    row = _local(db, acc, file_id)
    if change:
        _need(row, "canShare", "change sharing for")
    return acc, row, DriveClient(acc)


def _check_role(role: str) -> None:
    if role not in ROLES:
        raise AppError(400, "BAD_ROLE", "Role must be reader, commenter or writer.")


def get(db: Session, account_id: str, file_id: str) -> dict:
    acc, row, c = _open(db, account_id, file_id, change=False)
    with accounts.drive_errors(db, acc):
        return _state(c, row)


def set_link(db: Session, account_id: str, file_id: str, role: str | None) -> dict:
    """role None = Restricted (only people added). Otherwise "anyone with the link" gets that role; never searchable."""
    if role is not None:
        _check_role(role)
    acc, row, c = _open(db, account_id, file_id, change=True)
    with accounts.drive_errors(db, acc):
        current = next((p for p in gfiles.list_permissions(c, file_id) if p.get("type") == "anyone"), None)
        if role is None and current:
            gfiles.delete_permission(c, file_id, current["id"])
        elif role and current and current.get("role") != role:
            gfiles.update_permission(c, file_id, current["id"], role)
        elif role and not current:
            gfiles.create_permission(c, file_id, {"type": "anyone", "role": role, "allowFileDiscovery": False})
        state = _state(c, row)
    events.record_activity(db, "share_link", account=acc, google_file_id=file_id, file_name=row.name, details={"role": role})
    return state


def add_people(db: Session, account_id: str, file_id: str, emails: list[str], role: str, notify: bool,
               message: str | None) -> dict:
    _check_role(role)
    clean = list(dict.fromkeys(e.strip().lower() for e in emails if e and e.strip()))
    bad = [e for e in clean if not EMAIL.match(e)]
    if bad or not clean:
        raise AppError(400, "BAD_EMAIL", f"Not a valid email address: {', '.join(bad)}" if bad else "Enter at least one email address.")
    if len(clean) > MAX_PEOPLE:
        raise AppError(400, "TOO_MANY", f"Add at most {MAX_PEOPLE} people at a time.")
    acc, row, c = _open(db, account_id, file_id, change=True)
    failed, added = [], 0
    note = (message or "").strip()[:2000] or None
    with accounts.drive_errors(db, acc):
        for email in clean:             # one by one, so one rejected address doesn't stop the rest
            try:
                gfiles.create_permission(c, file_id, {"type": "user", "role": role, "emailAddress": email}, notify=notify, message=note)
                added += 1
            except DriveApiError as e:
                if e.reason in ("userRateLimitExceeded", "rateLimitExceeded", "authError"):
                    raise
                failed.append({"email": email, "message": _share_error(e, notify)})
        state = _state(c, row)
    if added:
        events.record_activity(db, "share_add", account=acc, google_file_id=file_id, file_name=row.name,
                               details={"count": added, "role": role})
    return {**state, "failed": failed}


def update_person(db: Session, account_id: str, file_id: str, permission_id: str, role: str) -> dict:
    _check_role(role)
    acc, row, c = _open(db, account_id, file_id, change=True)
    with accounts.drive_errors(db, acc):
        gfiles.update_permission(c, file_id, permission_id, role)
        state = _state(c, row)
    events.record_activity(db, "share_role", account=acc, google_file_id=file_id, file_name=row.name, details={"role": role})
    return state


def remove_person(db: Session, account_id: str, file_id: str, permission_id: str) -> dict:
    acc, row, c = _open(db, account_id, file_id, change=True)
    with accounts.drive_errors(db, acc):
        target = next((p for p in gfiles.list_permissions(c, file_id) if p["id"] == permission_id), None)
        if target and target.get("role") == "owner":
            raise AppError(400, "CANNOT_REMOVE_OWNER", "The owner can't be removed.")
        if target:
            gfiles.delete_permission(c, file_id, permission_id)
        state = _state(c, row)
    events.record_activity(db, "share_remove", account=acc, google_file_id=file_id, file_name=row.name)
    return state


def _share_error(e: DriveApiError, notify: bool) -> str:
    if e.reason == "invalidSharingRequest" and not notify:
        return 'This address has no Google account. Turn on "Notify people" so Google can send them an invitation.'
    return {
        "publishOutNotPermitted": "This account's organisation doesn't allow sharing outside it.",
        "invalidSharingRequest": "Google rejected sharing with this address.",
        "sharingRateLimitExceeded": "Google is limiting how fast this account can share. Try again later.",
    }.get(e.reason, e.message)
