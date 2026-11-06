"""Thin wrappers around Drive v3 endpoints. All calls go through DriveClient.call (retries, error mapping)."""
from __future__ import annotations

from app.integrations.google_drive.client import DriveClient

FILE_FIELDS = ("id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,trashed,ownedByMe,parents,driveId,"
               "webViewLink,shortcutDetails(targetId,targetMimeType),capabilities,owners(emailAddress)")
FOLDER_MIME = "application/vnd.google-apps.folder"


def about(c: DriveClient) -> dict:
    return c.call(c.service().about().get(
        fields="user(displayName,emailAddress,permissionId),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)"))


def root_folder_id(c: DriveClient) -> str:
    return c.call(c.service().files().get(fileId="root", fields="id"))["id"]


def start_page_token(c: DriveClient) -> str:
    return c.call(c.service().changes().getStartPageToken(supportsAllDrives=True))["startPageToken"]


def list_page(c: DriveClient, page_token: str | None, drive_id: str | None = None) -> dict:
    kw = dict(pageSize=1000, pageToken=page_token, supportsAllDrives=True, includeItemsFromAllDrives=True,
              fields=f"nextPageToken,files({FILE_FIELDS})")
    if drive_id:
        kw.update(corpora="drive", driveId=drive_id)
    else:
        kw.update(corpora="user")
    return c.call(c.service().files().list(**kw))


def changes_page(c: DriveClient, token: str) -> dict:
    return c.call(c.service().changes().list(
        pageToken=token, pageSize=1000, includeItemsFromAllDrives=True, supportsAllDrives=True, includeRemoved=True,
        fields=f"nextPageToken,newStartPageToken,changes(fileId,removed,changeType,file({FILE_FIELDS}))"))


def list_drives(c: DriveClient) -> list[dict]:
    out, token = [], None
    while True:
        r = c.call(c.service().drives().list(pageSize=100, pageToken=token, fields="nextPageToken,drives(id,name,capabilities)"))
        out += r.get("drives", [])
        token = r.get("nextPageToken")
        if not token:
            return out


def get_file(c: DriveClient, file_id: str, fields: str = FILE_FIELDS) -> dict:
    return c.call(c.service().files().get(fileId=file_id, fields=fields, supportsAllDrives=True))


def rename(c: DriveClient, file_id: str, name: str) -> dict:
    return c.call(c.service().files().update(fileId=file_id, body={"name": name}, fields=FILE_FIELDS, supportsAllDrives=True))


def set_trashed(c: DriveClient, file_id: str, trashed: bool) -> dict:
    return c.call(c.service().files().update(fileId=file_id, body={"trashed": trashed}, fields=FILE_FIELDS, supportsAllDrives=True))


def delete_permanently(c: DriveClient, file_id: str) -> None:
    c.call(c.service().files().delete(fileId=file_id, supportsAllDrives=True))


def empty_trash(c: DriveClient) -> None:
    """Permanently deletes every item in this account's My Drive trash that the account owns."""
    c.call(c.service().files().emptyTrash())


def move(c: DriveClient, file_id: str, new_parent: str, old_parents: list[str]) -> dict:
    return c.call(c.service().files().update(
        fileId=file_id, addParents=new_parent, removeParents=",".join(old_parents), fields=FILE_FIELDS, supportsAllDrives=True))


def create_folder(c: DriveClient, name: str, parent_id: str | None) -> dict:
    body = {"name": name, "mimeType": FOLDER_MIME}
    if parent_id:
        body["parents"] = [parent_id]
    return c.call(c.service().files().create(body=body, fields=FILE_FIELDS, supportsAllDrives=True))


def find_by_job(c: DriveClient, job_id: str) -> dict | None:
    """Duplicate protection: look for a file this app already created for an upload job."""
    q = f"appProperties has {{ key='drivemanager_job_id' and value='{job_id}' }} and trashed=false"
    r = c.call(c.service().files().list(q=q, spaces="drive", corpora="allDrives", includeItemsFromAllDrives=True,
                                        supportsAllDrives=True, pageSize=5, fields=f"files({FILE_FIELDS})"))
    files = r.get("files", [])
    return files[0] if files else None


PERMISSION_FIELDS = "id,type,role,emailAddress,displayName,domain,allowFileDiscovery,pendingOwner"


def list_permissions(c: DriveClient, file_id: str) -> list[dict]:
    out, token = [], None
    while True:
        r = c.call(c.service().permissions().list(fileId=file_id, pageToken=token, supportsAllDrives=True,
                                                  fields=f"nextPageToken,permissions({PERMISSION_FIELDS})"))
        out += r.get("permissions", [])
        token = r.get("nextPageToken")
        if not token:
            return out


def create_permission(c: DriveClient, file_id: str, body: dict, notify: bool = False, message: str | None = None) -> dict:
    kw = dict(fileId=file_id, body=body, supportsAllDrives=True, fields=PERMISSION_FIELDS)
    if body.get("type") in ("user", "group"):
        kw["sendNotificationEmail"] = notify          # Google only accepts this flag for people and groups
        if notify and message:
            kw["emailMessage"] = message
    return c.call(c.service().permissions().create(**kw))


def update_permission(c: DriveClient, file_id: str, permission_id: str, role: str, pending_owner: bool | None = None,
                      transfer_ownership: bool = False) -> dict:
    """pending_owner=True offers ownership (personal accounts); the recipient accepts with role="owner", transfer_ownership=True."""
    body = {"role": role}
    if pending_owner is not None:
        body["pendingOwner"] = pending_owner
    kw = dict(fileId=file_id, permissionId=permission_id, body=body, supportsAllDrives=True, fields=PERMISSION_FIELDS)
    if transfer_ownership:
        kw["transferOwnership"] = True
    return c.call(c.service().permissions().update(**kw))


def delete_permission(c: DriveClient, file_id: str, permission_id: str) -> None:
    c.call(c.service().permissions().delete(fileId=file_id, permissionId=permission_id, supportsAllDrives=True))


def update_parents(c: DriveClient, file_id: str, add: str | None = None, remove: list[str] | None = None) -> dict:
    kw = dict(fileId=file_id, fields=FILE_FIELDS, supportsAllDrives=True)
    if add:
        kw["addParents"] = add
    if remove:
        kw["removeParents"] = ",".join(remove)
    return c.call(c.service().files().update(**kw))


def copy_file(c: DriveClient, file_id: str, name: str, parent_id: str | None) -> dict:
    """Server-side copy into the acting account's Drive; the copy is owned by that account."""
    body = {"name": name}
    if parent_id:
        body["parents"] = [parent_id]
    return c.call(c.service().files().copy(fileId=file_id, body=body, fields=FILE_FIELDS, supportsAllDrives=True))
