"""Sidebar order is saved on the server so every device shows the same order. Dashboard is pinned and not part of it."""

DEFAULT = ["files", "trash", "virtual", "uploads", "accounts", "activity", "analytics", "settings"]


def test_default_order(authed):
    assert authed.get("/api/settings/sidebar").json() == {"order": DEFAULT, "default": DEFAULT, "customized": False}


def test_save_normalises_and_persists(authed):
    r = authed.put("/api/settings/sidebar", json={"order": ["settings", "virtual", "bogus", "virtual", "dashboard", "files"]})
    # unknown and duplicate keys dropped, pinned dashboard ignored, missing items appended in default order
    want = ["settings", "virtual", "files", "trash", "uploads", "accounts", "activity", "analytics"]
    assert r.status_code == 200 and r.json()["order"] == want and r.json()["customized"] is True
    assert authed.get("/api/settings/sidebar").json()["order"] == want


def test_reset(authed):
    authed.put("/api/settings/sidebar", json={"order": ["settings"]})
    r = authed.delete("/api/settings/sidebar")
    assert r.json() == {"order": DEFAULT, "default": DEFAULT, "customized": False}


def test_rejects_oversized_payload(authed):
    assert authed.put("/api/settings/sidebar", json={"order": ["x"] * 100}).status_code == 422
