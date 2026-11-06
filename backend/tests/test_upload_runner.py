import os

import pytest

from app.core.encryption import encrypt
from app.database.models import Account, UploadJob
from app.database.repositories.settings import set_setting
from app.integrations.google_drive import transfer
from app.services import accounts, quota, upload_runner, uploads
from app.config import get_settings

MB = 1024 * 1024
GB = 1024 ** 3


class FakeDrive:
    """Pretends to be Google's resumable upload endpoint."""
    def __init__(self):
        self.data = bytearray(); self.started = 0; self.fail_once_at = None; self.existing = None; self.limits = {}

    def meta(self, size, name="f.bin"):
        return {"id": "G1", "name": name, "mimeType": "application/octet-stream", "size": str(size), "parents": [],
                "ownedByMe": True, "capabilities": {"canRename": True}}

    def start_session(self, c, *, name, size, mime, parent_id, job_id):
        self.started += 1
        return "https://upload.example/session?upload_id=SECRET"

    def query_status(self, c, uri, size):
        return ("complete", size, self.meta(size)) if len(self.data) == size else ("partial", len(self.data), None)

    def send_chunk(self, c, uri, data, start, total):
        if self.fail_once_at is not None and start >= self.fail_once_at:
            self.fail_once_at = None
            raise transfer.TransientUploadError("HTTP 503")
        assert start == len(self.data), "client sent from the wrong offset"
        self.data += data
        return (len(self.data) == total), len(self.data), (self.meta(total) if len(self.data) == total else None)


@pytest.fixture
def g(monkeypatch):
    fake = FakeDrive()
    monkeypatch.setattr(upload_runner, "DriveClient", lambda acc: object())
    for n in ("start_session", "query_status", "send_chunk"):
        monkeypatch.setattr(transfer, n, getattr(fake, n))
    monkeypatch.setattr(transfer, "cancel_session", lambda *a, **k: None)
    monkeypatch.setattr(upload_runner.gfiles, "find_by_job", lambda c, jid: fake.existing)
    monkeypatch.setattr(upload_runner.gfiles, "get_file", lambda c, fid, fields=None: {"id": fid, "mimeType": "application/vnd.google-apps.folder",
                                                                                         "trashed": False, "capabilities": {"canAddChildren": True}})
    def fake_refresh(db, acc):
        lim, used = fake.limits.get(acc.id, (15 * GB, 1 * GB))
        return quota.store_snapshot(db, acc, {"limit": str(lim) if lim else None, "usage": str(used)})
    monkeypatch.setattr(upload_runner.quota, "refresh", fake_refresh)
    monkeypatch.setattr(upload_runner.time, "sleep", lambda s: None)
    return fake


def stage(db, account, size, mode="MANUAL", name="f.bin", content=None, **kw):
    job_id = uploads.new_job_id()
    path = uploads.staging_path(job_id, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    content = content if content is not None else os.urandom(size)
    open(path, "wb").write(content)
    job = uploads.create(db, job_id=job_id, filename=name, size=len(content), mime=None, path=path, mode=mode,
                         account_id=account.id if mode == "MANUAL" else None, folder_id=kw.get("folder_id"), folder_name=None)
    return job, content


def fresh(db, job):
    db.expire_all()
    return db.get(UploadJob, job.id)


def test_happy_path_uploads_all_bytes_and_cleans_staging(db, account, g, monkeypatch):
    job, content = stage(db, account, int(3.5 * MB))
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "COMPLETED" and j.google_file_id == "G1" and j.bytes_uploaded == len(content)
    assert bytes(g.data) == content and g.started == 1
    assert not os.path.exists(j.staged_path) and j.resumable_uri_enc is None


def test_network_failure_mid_upload_resumes_from_servers_offset(db, account, g):
    job, content = stage(db, account, int(3.5 * MB))
    g.fail_once_at = 2 * MB
    upload_runner.run(job.id)
    assert fresh(db, job).state == "COMPLETED" and bytes(g.data) == content and g.started == 1


def test_restart_resumes_existing_session_without_new_one(db, account, g):
    job, content = stage(db, account, int(3.5 * MB))
    g.data += content[: 2 * MB]                       # Google already has the first 2 MB
    job.resumable_uri_enc = encrypt("https://upload.example/session?upload_id=SECRET"); job.attempts = 1
    db.commit()
    upload_runner.run(job.id)
    assert fresh(db, job).state == "COMPLETED" and bytes(g.data) == content and g.started == 0


def test_retry_never_creates_duplicate_if_file_already_exists(db, account, g):
    job, content = stage(db, account, 1 * MB)
    g.existing = g.meta(len(content)); job.attempts = 1; db.commit()      # earlier attempt finished server-side
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "COMPLETED" and g.started == 0 and len(g.data) == 0


def test_insufficient_space_does_not_switch_accounts_and_keeps_file(db, account, g):
    other = Account(google_sub="s2", email="roomy@example.com", encrypted_refresh_token=encrypt("x"), root_folder_id="R2")
    db.add(other); db.commit()
    g.limits[account.id] = (2 * GB, int(1.9 * GB))
    job, _ = stage(db, account, 300 * MB)
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "FAILED" and j.error_code == "INSUFFICIENT_SPACE" and j.account_id == account.id
    assert os.path.exists(j.staged_path) and g.started == 0
    assert "choose another account" in j.error_message


def test_failed_job_can_be_retried_on_another_account(db, account, g):
    other = Account(google_sub="s2", email="roomy@example.com", encrypted_refresh_token=encrypt("x"), root_folder_id="R2")
    db.add(other); db.commit()
    g.limits[account.id] = (2 * GB, int(1.9 * GB))
    job, content = stage(db, account, 300 * MB // 100)
    g.limits[account.id] = (2 * GB, int(2 * GB - 1000))
    upload_runner.run(job.id)
    assert fresh(db, job).state == "FAILED"
    uploads.retry(db, fresh(db, job), account_id=other.id)
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "COMPLETED" and j.account_id == other.id and bytes(g.data) == content


def test_auto_allocation_uses_priority_and_records_reason(db, account, g):
    other = Account(google_sub="s2", email="second@example.com", encrypted_refresh_token=encrypt("x"), root_folder_id="R2")
    db.add(other); db.commit()
    set_setting(db, "allocation", {"safety_margin_mb": 0, "priority": [other.id, account.id], "rules": [], "account_defaults": {}})
    job, _ = stage(db, account, 1 * MB, mode="AUTO")
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "COMPLETED" and j.account_id == other.id and "priority #1" in j.allocation_reason


def test_auto_rule_target_full_fails_clearly(db, account, g):
    set_setting(db, "allocation", {"safety_margin_mb": 0, "priority": [], "account_defaults": {},
                                   "rules": [{"id": "r", "name": "Big", "account_id": account.id, "extensions": [".bin"]}]})
    g.limits[account.id] = (1 * GB, int(0.99 * GB))
    job, _ = stage(db, account, 50 * MB, mode="AUTO")
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "FAILED" and j.error_code == "RULE_ACCOUNT_FULL" and g.started == 0


def test_cancel_queued_removes_staging(db, account, g):
    job, _ = stage(db, account, 1 * MB)
    uploads.cancel(db, job)
    j = fresh(db, job)
    assert j.state == "CANCELLED" and not os.path.exists(j.staged_path)


def test_cancel_requested_during_upload_stops_cleanly(db, account, g):
    job, _ = stage(db, account, int(3.5 * MB))
    job.cancel_requested = True; db.commit()
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "CANCELLED" and g.started == 0 and not os.path.exists(j.staged_path)


def test_account_needing_reauth_fails_with_actionable_message(db, account, g):
    job, _ = stage(db, account, 1 * MB)
    account.status = "NEEDS_REAUTH"; db.commit()
    upload_runner.run(job.id)
    j = fresh(db, job)
    assert j.state == "FAILED" and j.error_code == "ACCOUNT_NEEDS_REAUTH" and os.path.exists(j.staged_path)


def test_staged_file_missing_is_reported(db, account, g):
    job, _ = stage(db, account, 1 * MB)
    os.remove(job.staged_path)
    upload_runner.run(job.id)
    assert fresh(db, job).error_code == "STAGED_FILE_MISSING"


def test_upload_api_validation_and_flow(authed, account, g):
    no_acct = authed.post("/api/uploads", files={"file": ("a.txt", b"hello")}, data={"mode": "MANUAL"})
    assert no_acct.status_code == 400 and no_acct.json()["error"]["code"] == "ACCOUNT_REQUIRED"
    ok = authed.post("/api/uploads", files={"file": ("../../etc/passwd", b"hello")}, data={"mode": "MANUAL", "account_id": account.id})
    assert ok.status_code == 200
    body = ok.json()
    assert body["filename"] == "passwd" and body["state"] == "QUEUED" and body["size"] == 5       # path traversal neutralised
    assert authed.post(f"/api/uploads/{body['id']}/cancel").json()["state"] == "CANCELLED"
    assert authed.delete(f"/api/uploads/{body['id']}").status_code == 200
