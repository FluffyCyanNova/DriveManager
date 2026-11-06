import pytest

from app.database.repositories.files import FileQuery, run
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
