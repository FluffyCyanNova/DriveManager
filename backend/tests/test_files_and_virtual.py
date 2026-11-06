import pytest

from app.database.repositories.files import FileQuery, run
from app.core.encryption import encrypt
from app.database.models import Account
from app.services import sync


def meta(id_, name, parents, mime="text/plain", owned=True, drive=None, trashed=False, size="10"):
    m = {"id": id_, "name": name, "mimeType": mime, "parents": parents, "ownedByMe": owned, "trashed": trashed, "size": size,
         "modifiedTime": "2025-01-02T03:04:05.000Z", "capabilities": {"canRename": True}}
    if drive:
        m["driveId"] = drive
    return m


FOLDER = "application/vnd.google-apps.folder"


@pytest.fixture
def indexed(db, account):
    sync.upsert_files(db, account, [
        meta("f1", "Projects", ["ROOT1"], FOLDER, size=None), meta("r1", "root.txt", ["ROOT1"]),
        meta("c1", "child.txt", ["f1"]), meta("t1", "old.txt", ["ROOT1"], trashed=True),
        meta("s1", "Shared Folder", [], FOLDER, owned=False, size=None), meta("s2", "inside.txt", ["s1"], owned=False),
        meta("d1", "drive-root.txt", ["DRIVE1"], drive="DRIVE1"), meta("img", "photo.jpg", ["f1"], mime="image/jpeg"),
    ])
    return account


def names(db, **kw):
    rows, total = run(db, FileQuery(**kw))
    return [f.name for f, _ in rows]


def test_my_drive_root_and_children(db, indexed):
    assert names(db, location="my_drive") == ["Projects", "root.txt"]
    assert names(db, account_id=indexed.id, parent_id="f1") == ["child.txt", "photo.jpg"]


def test_shared_with_me_shows_only_top_level(db, indexed):
    assert names(db, location="shared_with_me") == ["Shared Folder"]
    assert names(db, account_id=indexed.id, parent_id="s1") == ["inside.txt"]


def test_shared_drive_children_by_drive_id(db, indexed):
    assert names(db, account_id=indexed.id, parent_id="DRIVE1") == ["drive-root.txt"]


def test_trash_search_and_type_filters(db, indexed):
    assert names(db, trashed=True) == ["old.txt"]
    assert names(db, q="CHILD") == ["child.txt"]
    assert names(db, type="image") == ["photo.jpg"]
    assert names(db, type="folder", location="my_drive") == ["Projects"]


def test_search_escapes_wildcards(db, indexed):
    assert names(db, q="%") == []


def test_removed_items_are_hidden_and_reappear_on_upsert(db, indexed):
    sync._mark_removed(db, indexed, ["r1"])
    assert "root.txt" not in names(db, location="my_drive")
    sync.upsert_files(db, indexed, [meta("r1", "root.txt", ["ROOT1"])])
    assert "root.txt" in names(db, location="my_drive")


def test_reparenting_updates_parent_rows(db, indexed):
    sync.upsert_files(db, indexed, [meta("c1", "child.txt", ["ROOT1"])])
    assert "child.txt" in names(db, location="my_drive") and "child.txt" not in names(db, account_id=indexed.id, parent_id="f1")


def test_virtual_folder_lifecycle(authed, indexed):
    a = authed.post("/api/virtual-folders", json={"name": "A"}).json()
    b = authed.post("/api/virtual-folders", json={"name": "B", "parent_id": a["id"]}).json()
    assert authed.post("/api/virtual-folders", json={"name": "A"}).status_code == 409           # duplicate sibling name
    cyc = authed.patch(f"/api/virtual-folders/{a['id']}", json={"parent_id": b["id"]})
    assert cyc.status_code == 400 and cyc.json()["error"]["code"] == "CYCLE"
    assert authed.post(f"/api/virtual-folders/{b['id']}/items", json={"items": [{"account_id": indexed.id, "google_file_id": "r1"},
                                                                                  {"account_id": indexed.id, "google_file_id": "r1"}]}).json()["added"] == 1
    items = authed.get(f"/api/virtual-folders/{b['id']}/items").json()["items"]
    assert items[0]["status"] == "ok" and items[0]["name"] == "root.txt"


def test_virtual_item_survives_drive_removal_and_folder_delete_keeps_drive_files(authed, db, indexed):
    f = authed.post("/api/virtual-folders", json={"name": "Keep"}).json()
    authed.post(f"/api/virtual-folders/{f['id']}/items", json={"items": [{"account_id": indexed.id, "google_file_id": "r1"}]})
    sync._mark_removed(db, indexed, ["r1"])
    it = authed.get(f"/api/virtual-folders/{f['id']}/items").json()["items"][0]
    assert it["status"] == "missing" and it["name"] == "root.txt"          # cached name keeps it recognisable
    assert authed.delete(f"/api/virtual-folders/{f['id']}").status_code == 200
    assert names(db, location="my_drive") == ["Projects"]      # Drive index untouched by deleting the virtual folder
    assert names(db, account_id=indexed.id, parent_id="f1") == ["child.txt", "photo.jpg"]


def test_files_api_pagination_and_filters(authed, indexed):
    r = authed.get("/api/files", params={"location": "my_drive", "page_size": 1}).json()
    assert r["total"] == 2 and len(r["items"]) == 1 and r["items"][0]["name"] == "Projects"
    assert authed.get("/api/files", params={"location": "bogus"}).status_code == 422


def test_empty_trash_requires_confirm_and_removes_owned_my_drive_trash(authed, db, indexed, monkeypatch):
    from app.integrations.google_drive import files as gfiles
    calls = []
    monkeypatch.setattr(gfiles, "empty_trash", lambda c: calls.append("empty"))
    monkeypatch.setattr(gfiles, "about", lambda c: {"storageQuota": {"usage": "5", "limit": "100", "usageInDrive": "5", "usageInDriveTrash": "0"}})
    sync.upsert_files(db, indexed, [meta("t2", "not-mine.txt", ["ROOT1"], owned=False, trashed=True),
                                    meta("t3", "drive-trash.txt", ["DRIVE1"], drive="DRIVE1", trashed=True)])
    r = authed.post(f"/api/files/{indexed.id}/trash/empty")
    assert r.status_code == 400 and r.json()["error"]["code"] == "CONFIRM_REQUIRED" and calls == []
    r = authed.post(f"/api/files/{indexed.id}/trash/empty?confirm=true")
    assert r.status_code == 200 and r.json() == {"ok": True, "removed": 1} and calls == ["empty"]
    db.expire_all()
    assert sorted(names(db, trashed=True)) == ["drive-trash.txt", "not-mine.txt"]


def test_folder_placement_toggle(db, indexed):
    assert names(db, account_id=indexed.id, location="my_drive") == ["Projects", "root.txt"]
    assert names(db, account_id=indexed.id, location="my_drive", folders="last") == ["root.txt", "Projects"]
    sync.upsert_files(db, indexed, [meta("a1", "aaa.txt", ["ROOT1"]), meta("z1", "Zeta", ["ROOT1"], FOLDER, size=None)])
    assert names(db, account_id=indexed.id, location="my_drive", folders="mixed") == ["aaa.txt", "Projects", "root.txt", "Zeta"]
    assert names(db, account_id=indexed.id, location="my_drive", folders="first", direction="desc") == ["Zeta", "Projects", "root.txt", "aaa.txt"]


def test_sort_by_account_and_api_params(authed, db, indexed):
    other = Account(google_sub="sub-0", email="zed@example.com", encrypted_refresh_token=encrypt("rt"), root_folder_id="ROOT0")
    db.add(other); db.commit()
    sync.upsert_files(db, other, [meta("o1", "aaa.txt", ["ROOT0"])])
    r = authed.get("/api/files", params={"location": "my_drive", "sort": "account", "folders": "mixed"}).json()
    assert [i["name"] for i in r["items"]] == ["Projects", "root.txt", "aaa.txt"]   # by account, then name
    assert authed.get("/api/files", params={"folders": "sideways"}).status_code == 422


def test_permanent_delete_of_folder_removes_owned_contents_from_index(authed, db, indexed, monkeypatch):
    from app.integrations.google_drive import files as gfiles
    monkeypatch.setattr(gfiles, "delete_permanently", lambda c, fid: None)
    sync.upsert_files(db, indexed, [meta("sub", "Sub", ["f1"], FOLDER, size=None), meta("deep", "deep.txt", ["sub"]),
                                    meta("theirs", "theirs.txt", ["f1"], owned=False)])
    r = authed.delete(f"/api/files/{indexed.id}/f1", params={"permanent": "true", "confirm": "true"})
    assert r.status_code == 200
    db.expire_all()
    from app.database.models import DriveFile
    from sqlalchemy import select
    status = dict(db.execute(select(DriveFile.google_file_id, DriveFile.status)).all())
    assert [status[k] for k in ("f1", "c1", "img", "sub", "deep")] == ["REMOVED"] * 5
    assert status["theirs"] == "ACTIVE" and status["r1"] == "ACTIVE"


def test_download_check_does_not_record_activity(authed, db, indexed, monkeypatch):
    """The UI first checks a download can start (to show errors as a toast), then starts the real one.
    Only the real download may appear in Activity; the check must not count as a second download."""
    from app.database.models import FileEvent
    from app.integrations.google_drive import files as gfiles, transfer
    from app.services import file_ops

    class FakeResp:
        closed = False
        def iter_content(self, chunk_size):
            yield b"hello"
        def close(self):
            FakeResp.closed = True

    monkeypatch.setattr(file_ops, "DriveClient", lambda acc: object())
    monkeypatch.setattr(gfiles, "get_file", lambda c, fid, fields=None: {"id": fid, "name": "root.txt", "mimeType": "text/plain", "size": "5"})
    monkeypatch.setattr(transfer, "open_download", lambda c, meta, fmt: transfer.DownloadStream(FakeResp(), meta["name"], meta["mimeType"], 5))
    downloads = lambda: db.query(FileEvent).filter(FileEvent.event_type == "download").count()

    r = authed.get(f"/api/files/{indexed.id}/r1/download", params={"check": "true"})
    assert r.status_code == 200 and r.json() == {"ok": True, "filename": "root.txt"}
    assert FakeResp.closed, "the check must close the Google stream it opened"
    assert downloads() == 0

    r = authed.get(f"/api/files/{indexed.id}/r1/download")
    assert r.status_code == 200 and r.content == b"hello"
    assert downloads() == 1
