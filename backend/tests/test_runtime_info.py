def test_runtime_reports_build_info(authed, monkeypatch):
    monkeypatch.setenv("APP_COMMIT", "a88cac6")
    monkeypatch.setenv("APP_BUILD_DATE", "2026-11-07T10:00:00Z")
    r = authed.get("/api/settings/runtime").json()
    assert r["commit"] == "a88cac6" and r["build_date"] == "2026-11-07T10:00:00Z" and r["version"]


def test_runtime_build_info_absent_outside_docker(authed, monkeypatch):
    monkeypatch.delenv("APP_COMMIT", raising=False)
    monkeypatch.delenv("APP_BUILD_DATE", raising=False)
    r = authed.get("/api/settings/runtime").json()
    assert r["commit"] is None and r["build_date"] is None
