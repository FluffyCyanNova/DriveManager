"""Move a file to another connected account without downloading it: transfer ownership, or fall back to a server-side copy."""
import pytest

from app.database.models import Account, DriveFile, FileEvent, VirtualFolderItem
from app.core.encryption import encrypt
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive.client import DriveApiError
from app.services import cross_account, quota, sync, virtual_folders

from tests.test_files_and_virtual import FOLDER, meta

GB = 1024 ** 3


class FakeGoogle:
    """One shared Drive 'world'. The client passed to each call is the acting account's id."""
    def __init__(self, src, dst, transfer_ok=True):
        self.src, self.dst, self.transfer_ok = src, dst, transfer_ok
        self.files = {"F1": {"id": "F1", "name": "video.mp4", "mimeType": "video/mp4", "size": str(2 * GB), "parents": ["SRCFOLDER"],
                             "owner": src.id, "trashed": False}}
        self.perms = {}          # (file_id, perm_id) -> perm
        self.calls = []

    def meta_for(self, acting, f):
        return {"id": f["id"], "name": f["name"], "mimeType": f["mimeType"], "size": f["size"], "parents": f["parents"],
                "ownedByMe": f["owner"] == acting, "trashed": f["trashed"], "capabilities": {"canShare": True}}

    # --- gfiles fakes ---
    def about(self, c):
        return {"user": {"permissionId": f"perm-{c}"}}

    def create_permission(self, c, fid, body, notify=False, message=None):
        pid = f"perm-{self.dst.id}" if body.get("emailAddress") == self.dst.email else f"perm-{body.get('emailAddress')}"
        self.perms[(fid, pid)] = {"id": pid, **body}
        self.calls.append(("share", c, body["role"]))
        return self.perms[(fid, pid)]

    def update_permission(self, c, fid, pid, role, pending_owner=None, transfer_ownership=False):
        if pending_owner and not self.transfer_ok:
            raise DriveApiError(403, "ownershipChangeAcrossDomainNotPermitted", "nope")
        if transfer_ownership:
            self.files[fid]["owner"] = c
            self.calls.append(("accept", c))
        elif pending_owner:
            self.calls.append(("offer", c))
        return {"id": pid, "role": role}

    def delete_permission(self, c, fid, pid):
        self.perms.pop((fid, pid), None)
        self.calls.append(("unshare", c, pid))

    def get_file(self, c, fid, fields=None):
        return self.meta_for(c, self.files[fid])

    def update_parents(self, c, fid, add=None, remove=None):
        f = self.files[fid]
        f["parents"] = [p for p in f["parents"] if p not in (remove or [])] + ([add] if add else [])
        self.calls.append(("parents", c, add, tuple(remove or [])))
        return self.meta_for(c, f)

    def copy_file(self, c, fid, name, parent):
        new = {**self.files[fid], "id": "F1COPY", "owner": c, "parents": [parent or "DSTROOT"]}
        self.files["F1COPY"] = new
        self.calls.append(("copy", c))
        return self.meta_for(c, new)

    def set_trashed(self, c, fid, trashed):
        self.files[fid]["trashed"] = trashed
        self.calls.append(("trash", c))
        return self.meta_for(c, self.files[fid])


@pytest.fixture
def world(db, account, monkeypatch):
    dst = Account(google_sub="sub-2", email="b@example.com", encrypted_refresh_token=encrypt("rt"), root_folder_id="DSTROOT")
    db.add(dst); db.commit()
    g = FakeGoogle(account, dst)
    monkeypatch.setattr(cross_account, "DriveClient", lambda acc: acc.id)
    for n in ("about", "create_permission", "update_permission", "delete_permission", "get_file", "update_parents", "copy_file", "set_trashed"):
        monkeypatch.setattr(gfiles, n, getattr(g, n))
    monkeypatch.setattr(quota, "refresh", lambda db, acc: None)
    for a, used in ((account, 1 * GB), (dst, 1 * GB)):
        quota.store_snapshot(db, a, {"limit": str(15 * GB), "usage": str(used)})
    sync.upsert_files(db, account, [{**meta("F1", "video.mp4", ["SRCFOLDER"], mime="video/mp4", size=str(2 * GB)), "capabilities": {"canShare": True}}])
    return account, dst, g


def row(db, acc, fid):
    db.expire_all()
    return db.query(DriveFile).filter_by(account_id=acc.id, google_file_id=fid).one_or_none()


def test_transfer_ownership_keeps_the_same_file(db, world):
    src, dst, g = world
    vf = virtual_folders.create(db, "Keep", None)
    virtual_folders.add_items(db, vf.id, [{"account_id": src.id, "google_file_id": "F1"}])
    r = cross_account.move(db, src.id, "F1", dst.id, "DSTFOLDER")
    assert r["method"] == "transfer" and r["file"]["google_file_id"] == "F1" and r["file"]["account_id"] == dst.id
    assert g.files["F1"]["owner"] == dst.id and g.files["F1"]["parents"] == ["DSTFOLDER"]
    assert [x[0] for x in g.calls] == ["share", "offer", "accept", "parents", "parents", "unshare"]
    assert ("unshare", src.id, f"perm-{src.id}") in g.calls           # the old owner's leftover access is removed
    assert row(db, src, "F1").status == "REMOVED" and row(db, dst, "F1").status == "ACTIVE"
    item = db.query(VirtualFolderItem).one()
    assert (item.account_id, item.google_file_id) == (dst.id, "F1")      # virtual folder link follows the file
    ev = db.query(FileEvent).filter_by(event_type="move_account").one()
    assert ev.details == {"to": "b@example.com", "method": "transfer"}


def test_falls_back_to_copy_when_transfer_is_refused(db, world):
    src, dst, g = world
    g.transfer_ok = False
    vf = virtual_folders.create(db, "Keep", None)
    virtual_folders.add_items(db, vf.id, [{"account_id": src.id, "google_file_id": "F1"}])
    r = cross_account.move(db, src.id, "F1", dst.id, None)
    assert r["method"] == "copy" and r["file"]["google_file_id"] == "F1COPY" and r["file"]["account_id"] == dst.id
    assert g.files["F1"]["trashed"] is True and g.files["F1COPY"]["owner"] == dst.id and g.files["F1COPY"]["parents"] == ["DSTROOT"]
    assert ("F1", f"perm-{dst.id}") not in g.perms                        # temporary access cleaned up
    assert row(db, src, "F1").trashed is True and row(db, dst, "F1COPY").status == "ACTIVE"
    item = db.query(VirtualFolderItem).one()
    assert (item.account_id, item.google_file_id) == (dst.id, "F1COPY")


def test_refuses_when_target_lacks_space_before_touching_anything(db, world):
    src, dst, g = world
    quota.store_snapshot(db, dst, {"limit": str(15 * GB), "usage": str(14 * GB)})
    with pytest.raises(Exception) as e:
        cross_account.move(db, src.id, "F1", dst.id, None)
    assert e.value.code == "INSUFFICIENT_SPACE" and g.calls == []


def test_rejects_same_account_folders_and_shortcuts(db, world):
    src, dst, g = world
    with pytest.raises(Exception) as e:
        cross_account.move(db, src.id, "F1", src.id, None)
    assert e.value.code == "SAME_ACCOUNT"
    sync.upsert_files(db, src, [meta("D1", "Folder", ["SRCFOLDER"], FOLDER, size=None)])
    with pytest.raises(Exception) as e:
        cross_account.move(db, src.id, "D1", dst.id, None)
    assert e.value.code == "FOLDERS_NOT_SUPPORTED" and g.calls == []


def test_move_api_route(authed, world):
    src, dst, g = world
    r = authed.post(f"/api/files/{src.id}/F1/move-to-account", json={"target_account_id": dst.id})
    assert r.status_code == 200 and r.json()["method"] == "transfer"
