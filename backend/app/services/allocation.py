"""Automatic account selection for uploads. Pure logic: easy to test, never touches the network.

Rules (configurable in Settings):
  1. The first enabled routing rule that matches the file picks the account (and optionally a folder).
     If that account can't hold the file the upload FAILS with an explanation - it never silently
     goes to a different account.
  2. Otherwise accounts are tried in the user's priority order; the first one with room is used.
Files are never split across accounts. Quotas are separate and are never treated as a pooled total.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


class AllocationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass
class Candidate:
    account_id: str
    email: str
    status: str
    usage: int | None
    limit: int | None


@dataclass
class Decision:
    account_id: str
    folder_id: str | None
    folder_name: str | None
    reason: str


def has_room(c: Candidate, size: int, margin: int) -> bool:
    if c.status != "ACTIVE":
        return False
    if c.limit is None:          # unlimited / unreported (e.g. some Workspace plans)
        return True
    return (c.limit - (c.usage or 0) - margin) >= size


def free_text(c: Candidate) -> str:
    if c.limit is None:
        return "unlimited"
    return f"{max(c.limit - (c.usage or 0), 0) / 1024**3:.2f} GB free"


def rule_matches(rule: dict, filename: str, mime: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    checks = []
    if rule.get("extensions"):
        checks.append(ext in [e.lower() if e.startswith(".") else "." + e.lower() for e in rule["extensions"]])
    if rule.get("mime_prefixes"):
        checks.append(any(mime.lower().startswith(p.lower()) for p in rule["mime_prefixes"]))
    if rule.get("name_contains"):
        checks.append(rule["name_contains"].lower() in filename.lower())
    return bool(checks) and all(checks)


def decide(*, filename: str, mime: str, size: int, candidates: list[Candidate], settings: dict) -> Decision:
    margin = int(settings.get("safety_margin_mb", 512)) * 1024 * 1024
    by_id = {c.account_id: c for c in candidates}
    defaults = settings.get("account_defaults", {})

    for rule in settings.get("rules", []):
        if not rule.get("enabled", True) or not rule_matches(rule, filename, mime):
            continue
        c = by_id.get(rule.get("account_id"))
        if c is None:
            raise AllocationError("RULE_ACCOUNT_MISSING", f"Rule \"{rule.get('name', 'unnamed')}\" points to an account that is no longer connected. Fix the rule in Settings.")
        if not has_room(c, size, margin):
            why = "needs to be reconnected" if c.status != "ACTIVE" else f"has {free_text(c)}"
            raise AllocationError("RULE_ACCOUNT_FULL",
                                  f"Rule \"{rule.get('name', 'unnamed')}\" sends this file to {c.email}, which {why}. "
                                  "Choose another account and retry; nothing was uploaded.")
        return Decision(c.account_id, rule.get("folder_id"), rule.get("folder_name"),
                        f"Matched rule \"{rule.get('name', 'unnamed')}\" -> {c.email} ({free_text(c)})")

    order = [a for a in settings.get("priority", []) if a in by_id] + sorted(
        [a for a in by_id if a not in settings.get("priority", [])], key=lambda a: by_id[a].email)
    for n, aid in enumerate(order, 1):
        c = by_id[aid]
        if has_room(c, size, margin):
            d = defaults.get(aid) or {}
            return Decision(aid, d.get("folder_id"), d.get("folder_name"),
                            f"Account priority #{n}: {c.email} has room ({free_text(c)})")
    if not candidates:
        raise AllocationError("NO_ACCOUNTS", "No connected accounts are available. Connect or reconnect an account first.")
    detail = "; ".join(f"{c.email}: {'reconnect needed' if c.status != 'ACTIVE' else free_text(c)}" for c in candidates)
    raise AllocationError("NO_ACCOUNT_HAS_SPACE", f"No single account has enough room for this file ({detail}). "
                          "Files are never split across accounts. Free up space or connect another account.")
