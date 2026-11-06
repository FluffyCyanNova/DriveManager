"""Share / Copy link: general access ("anyone with the link") and specific people, against a fake Drive permissions API."""
import pytest

from app.database.models import FileEvent
from app.integrations.google_drive import files as gfiles
from app.integrations.google_drive.client import DriveApiError
from app.services import sharing, sync

from tests.test_files_and_virtual import meta


class FakePerms:
    def __init__(self):
        self.perms = {"own": {"id": "own", "type": "user", "role": "owner", "emailAddress": "a@example.com", "displayName": "Owner"}}
        self.n = 0
        self.notified = []

    def list(self, c, fid):
        return list(self.perms.values())

    def create(self, c, fid, body, notify=False, message=None):
        if body.get("emailAddress") == "nogoogle@example.com" and not notify:
            raise DriveApiError(400, "invalidSharingRequest", "no Google account")
        self.n += 1
        p = {"id": f"p{self.n}", **body}
        self.perms[p["id"]] = p
        if notify:
            self.notified.append((body.get("emailAddress"), message))
        return p

    def update(self, c, fid, pid, role):
        self.perms[pid]["role"] = role
        return self.perms[pid]

    def delete(self, c, fid, pid):
        del self.perms[pid]


@pytest.fixture
def fake(monkeypatch, db, account):
    f = FakePerms()
    monkeypatch.setattr(sharing, "DriveClient", lambda acc: object())
    monkeypatch.setattr(gfiles, "list_permissions", f.list)
    monkeypatch.setattr(gfiles, "create_permission", f.create)
    monkeypatch.setattr(gfiles, "update_permission", f.update)
    monkeypatch.setattr(gfiles, "delete_permission", f.delete)
    m = meta("f1", "report.pdf", ["ROOT1"], mime="application/pdf")
    m["webViewLink"] = "https://drive.google.com/file/d/f1/view"
    m["capabilities"] = {"canShare": True}
    sync.upsert_files(db, account, [m])
    return f


def events(db, kind):
    return [e.details for e in db.query(FileEvent).filter(FileEvent.event_type == kind)]


def test_get_sharing_starts_private(db, account, fake):
    s = sharing.get(db, account.id, "f1")
    assert s["link"] is None and s["web_view_link"].endswith("/view") and s["can_share"] is True
    assert [p["role"] for p in s["people"]] == ["owner"]


def test_anyone_with_link_on_change_role_and_off(db, account, fake):
    s = sharing.set_link(db, account.id, "f1", "reader")
    assert s["link"] == "reader" and fake.perms["p1"] == {"id": "p1", "type": "anyone", "role": "reader", "allowFileDiscovery": False}
    assert sharing.set_link(db, account.id, "f1", "writer")["link"] == "writer" and len(fake.perms) == 2  # updated, not duplicated
    assert sharing.set_link(db, account.id, "f1", None)["link"] is None and "p1" not in fake.perms
    assert events(db, "share_link") == [{"role": "reader"}, {"role": "writer"}, {"role": None}]


def test_add_people_validates_emails_and_reports_per_person_failures(db, account, fake):
    with pytest.raises(Exception) as e:
        sharing.add_people(db, account.id, "f1", ["not-an-email"], "reader", notify=False, message=None)
    assert getattr(e.value, "code", "") == "BAD_EMAIL"
    s = sharing.add_people(db, account.id, "f1", ["B@Example.com", "b@example.com", "nogoogle@example.com"], "writer", notify=False, message=None)
    added = [p for p in s["people"] if p["role"] != "owner"]
    assert [(p["email"], p["role"]) for p in added] == [("b@example.com", "writer")]          # deduplicated, lower-cased
    assert len(s["failed"]) == 1 and s["failed"][0]["email"] == "nogoogle@example.com" and "notify" in s["failed"][0]["message"].lower()
    assert events(db, "share_add") == [{"count": 1, "role": "writer"}]


def test_notify_passes_message_and_people_can_be_changed_and_removed(db, account, fake):
    sharing.add_people(db, account.id, "f1", ["c@example.com"], "reader", notify=True, message="Here you go")
    assert fake.notified == [("c@example.com", "Here you go")]
    pid = next(p["id"] for p in sharing.get(db, account.id, "f1")["people"] if p["email"] == "c@example.com")
    assert next(p for p in sharing.update_person(db, account.id, "f1", pid, "commenter")["people"] if p["id"] == pid)["role"] == "commenter"
    assert all(p["id"] != pid for p in sharing.remove_person(db, account.id, "f1", pid)["people"])
    with pytest.raises(Exception) as e:
        sharing.remove_person(db, account.id, "f1", "own")
    assert getattr(e.value, "code", "") == "CANNOT_REMOVE_OWNER"


def test_sharing_blocked_when_google_says_no(db, account, fake):
    from app.database.models import DriveFile
    row = db.query(DriveFile).filter_by(google_file_id="f1").one()
    row.capabilities = {"canShare": False}; db.commit()
    with pytest.raises(Exception) as e:
        sharing.set_link(db, account.id, "f1", "reader")
    assert getattr(e.value, "code", "") == "NOT_ALLOWED"


def test_sharing_api_routes(authed, account, fake):
    base = f"/api/files/{account.id}/f1/sharing"
    assert authed.get(base).json()["link"] is None
    assert authed.put(f"{base}/link", json={"role": "reader"}).json()["link"] == "reader"
    assert authed.put(f"{base}/link", json={"role": "owner"}).status_code == 422
    r = authed.post(f"{base}/people", json={"emails": ["d@example.com"], "role": "reader", "notify": False}).json()
    pid = next(p["id"] for p in r["people"] if p["email"] == "d@example.com")
    assert authed.patch(f"{base}/people/{pid}", json={"role": "writer"}).status_code == 200
    assert authed.delete(f"{base}/people/{pid}").status_code == 200
