def test_health_is_public(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_api_requires_login(client):
    assert client.get("/api/accounts").status_code == 401


def test_login_bad_password(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "BAD_CREDENTIALS"


def test_login_and_session(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "correct horse battery"})
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower() and "samesite=lax" in r.headers["set-cookie"].lower()
    assert client.get("/api/auth/session").json()["authenticated"] is True
    assert client.get("/api/accounts").status_code == 200


def test_csrf_enforced_on_unsafe_methods(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "correct horse battery"})
    r = client.post("/api/virtual-folders", json={"name": "x"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "CSRF"


def test_foreign_origin_rejected(authed):
    r = authed.post("/api/virtual-folders", json={"name": "x"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "BAD_ORIGIN"
    ok = authed.post("/api/virtual-folders", json={"name": "x"}, headers={"Origin": "http://testserver"})
    assert ok.status_code == 200


def test_login_throttle(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    r = client.post("/api/auth/login", json={"username": "admin", "password": "correct horse battery"})
    assert r.status_code == 429


def test_logout_invalidates_session(authed):
    assert authed.post("/api/auth/logout").status_code == 200
    assert authed.get("/api/accounts").status_code == 401


def test_change_password(authed):
    r = authed.post("/api/auth/change-password", json={"current_password": "correct horse battery", "new_password": "a brand new passphrase"})
    assert r.status_code == 200
    authed.post("/api/auth/logout")
    assert authed.post("/api/auth/login", json={"username": "admin", "password": "a brand new passphrase"}).status_code == 200
    # restore for other tests
    authed.headers["X-CSRF-Token"] = authed.get("/api/auth/session").json()["csrf_token"]
    authed.post("/api/auth/change-password", json={"current_password": "a brand new passphrase", "new_password": "correct horse battery"})
