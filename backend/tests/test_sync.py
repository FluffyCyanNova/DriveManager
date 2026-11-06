import pytest
from sqlalchemy import select

from app.database.models import DriveFile, SyncCursor, SyncJob
from app.integrations.google_drive.client import DriveApiError
from app.services import sync


def m(id_, name, parents=("ROOT1",), **kw):
    return {"id": id_, "name": name, "mimeType": "text/plain", "parents": list(parents), "ownedByMe": True, "size": "5",
            "modifiedTime": "2025-01-01T00:00:00Z", **kw}


class FakeGoogle:
    def __init__(self):
        self.pages = {None: {"files": [m("a", "a.txt"), m("b", "b.txt")], "nextPageToken": "p2"}, "p2": {"files": [m("c", "c.txt")]}}
        self.changes = {"T0": {"changes": [{"fileId": "a", "removed": True, "changeType": "file"},
                                           {"fileId": "d", "changeType": "file", "file": m("d", "d.txt")},
                                           {"fileId": "x", "changeType": "drive"}], "nextPageToken": "T1"},
                        "T1": {"changes": [{"fileId": "b", "changeType": "file", "file": m("b", "renamed.txt")}], "newStartPageToken": "T2"}}

    def install(self, monkeypatch):
        g = sync.gfiles
        monkeypatch.setattr(sync, "DriveClient", lambda acc: object())
        monkeypatch.setattr(g, "root_folder_id", lambda c: "ROOT1")
        monkeypatch.setattr(g, "start_page_token", lambda c: "T0")
        monkeypatch.setattr(g, "list_drives", lambda c: [{"id": "SD1", "name": "Team"}])
        monkeypatch.setattr(g, "list_page", lambda c, tok, drive_id=None: ({"files": [m("sd", "team.txt", ("SD1",), driveId="SD1")]} if drive_id else self.pages[tok]))
        monkeypatch.setattr(g, "changes_page", lambda c, tok: self.changes[tok])


def run_job(db, account, kind="INCREMENTAL"):
    job = SyncJob(account_id=account.id, kind=kind, state="RUNNING")
    db.add(job); db.commit()
    sync.run_sync_job(job.id)
    db.expire_all()
    return db.get(SyncJob, job.id)


def active(db, account):
    return sorted(f.name for f in db.scalars(select(DriveFile).where(DriveFile.account_id == account.id, DriveFile.status == "ACTIVE")))


def test_initial_scan_then_incremental_changes(db, account, monkeypatch):
    FakeGoogle().install(monkeypatch)
    j = run_job(db, account)
    assert j.state == "COMPLETED" and active(db, account) == ["a.txt", "b.txt", "c.txt", "team.txt"]
    assert account.initial_scan_complete or db.get(type(account), account.id).initial_scan_complete
    cur = db.scalar(select(SyncCursor).where(SyncCursor.account_id == account.id))
    assert cur.page_token == "T0"                                    # cursor taken before the scan started
    j2 = run_job(db, account)
    assert j2.state == "COMPLETED"
    assert active(db, account) == ["c.txt", "d.txt", "renamed.txt", "team.txt"]
    db.expire_all()
    assert db.scalar(select(SyncCursor).where(SyncCursor.account_id == account.id)).page_token == "T2"


def test_invalid_cursor_falls_back_to_full_scan_and_marks_vanished_files(db, account, monkeypatch):
    fake = FakeGoogle(); fake.install(monkeypatch)
    run_job(db, account)
    def boom(c, tok):
        raise DriveApiError(400, "invalid", "Invalid token")
    monkeypatch.setattr(sync.gfiles, "changes_page", boom)
    fake.pages[None] = {"files": [m("c", "c.txt")]}                   # a and b vanished on Google's side
    j = run_job(db, account)
    assert j.state == "COMPLETED" and active(db, account) == ["c.txt", "team.txt"]


def test_failed_sync_is_recorded_and_worker_survives(db, account, monkeypatch):
    FakeGoogle().install(monkeypatch)
    monkeypatch.setattr(sync.gfiles, "start_page_token", lambda c: (_ for _ in ()).throw(RuntimeError("boom")))
    j = run_job(db, account)
    assert j.state == "FAILED" and "boom" in j.error
