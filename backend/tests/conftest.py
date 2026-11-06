import os
import secrets
import tempfile

_tmp = tempfile.mkdtemp(prefix="dm-test-")
os.environ.update({
    "APP_SECRET_KEY": secrets.token_urlsafe(48),
    "DATABASE_URL": f"sqlite:///{_tmp}/test.db",
    "STAGING_DIR": f"{_tmp}/staging", "LOG_DIR": f"{_tmp}/logs", "BACKUP_DIR": f"{_tmp}/backups",
    "APP_USERNAME": "admin", "GOOGLE_CLIENT_ID": "id.apps.googleusercontent.com", "GOOGLE_CLIENT_SECRET": "secret",
})
from cryptography.fernet import Fernet  # noqa: E402
os.environ["APP_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
from app.core.security import hash_password  # noqa: E402
os.environ["APP_PASSWORD_HASH"] = hash_password("correct horse battery")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database.database import SessionLocal, engine  # noqa: E402
from app.database.models import Account, Base  # noqa: E402
from app.core.encryption import encrypt  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from app.core.security import login_throttle
    login_throttle._fails.clear()
    yield


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


@pytest.fixture
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def authed(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "correct horse battery"})
    assert r.status_code == 200
    client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return client


@pytest.fixture
def account(db):
    a = Account(google_sub="sub-1", email="a@example.com", encrypted_refresh_token=encrypt("rt"), root_folder_id="ROOT1")
    db.add(a)
    db.commit()
    return a
