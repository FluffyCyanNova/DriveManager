"""Sidebar order and pins are saved on the server so every device shows the same sidebar.
Pinned items sit in a group at the top (in pin order) and can't be dragged; Dashboard is pinned by default."""

DEFAULT = ["dashboard", "uploads", "files", "trash", "accounts", "virtual", "activity", "analytics"]


def test_defaults(authed):
    assert authed.get("/api/settings/sidebar").json() == {"order": DEFAULT, "pinned": ["dashboard"], "default": DEFAULT,
                                                          "default_pinned": ["dashboard"], "customized": False}


def test_save_normalises_and_persists(authed):
    r = authed.put("/api/settings/sidebar", json={"order": ["analytics", "virtual", "bogus", "virtual", "files"],
                                                   "pinned": ["uploads", "nope", "uploads", "dashboard"]})
    body = r.json()
    # unknown/duplicate keys dropped, missing items appended in default order; pins keep their own order
    assert body["order"] == ["analytics", "virtual", "files", "dashboard", "uploads", "trash", "accounts", "activity"]
    assert body["pinned"] == ["uploads", "dashboard"] and body["customized"] is True
    assert authed.get("/api/settings/sidebar").json() == body


def test_unpinning_dashboard_is_allowed(authed):
    body = authed.put("/api/settings/sidebar", json={"order": DEFAULT, "pinned": []}).json()
    assert body["pinned"] == [] and body["customized"] is True


def test_reset_restores_order_and_pins(authed):
    authed.put("/api/settings/sidebar", json={"order": ["analytics"], "pinned": ["analytics"]})
    assert authed.delete("/api/settings/sidebar").json()["pinned"] == ["dashboard"]
    assert authed.get("/api/settings/sidebar").json()["customized"] is False


def test_old_saved_format_still_loads(authed, db):
    from app.database.repositories.settings import set_setting
    set_setting(db, "ui.sidebar_order", ["analytics", "files"])          # format before pins existed
    body = authed.get("/api/settings/sidebar").json()
    assert body["order"][:3] == ["dashboard", "analytics", "files"] and body["pinned"] == ["dashboard"]


def test_settings_entry_from_older_versions_is_dropped(authed):
    # Settings moved out of the list (it's an icon next to the theme switch); old saved orders and pins lose it.
    body = authed.put("/api/settings/sidebar", json={"order": ["settings", "files"], "pinned": ["settings", "dashboard"]}).json()
    assert "settings" not in body["order"] and body["pinned"] == ["dashboard"]


def test_rejects_oversized_payload(authed):
    assert authed.put("/api/settings/sidebar", json={"order": ["x"] * 100, "pinned": []}).status_code == 422
