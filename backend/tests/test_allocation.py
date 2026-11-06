import pytest

from app.services.allocation import AllocationError, Candidate, decide

GB = 1024 ** 3


def C(i, free_gb, status="ACTIVE", limit=15):
    return Candidate(i, f"{i}@x.com", status, (limit - free_gb) * GB, limit * GB)


S = {"safety_margin_mb": 0, "priority": ["b", "a"], "rules": [], "account_defaults": {"b": {"folder_id": "F1", "folder_name": "Inbox"}}}


def test_priority_order_and_default_folder():
    d = decide(filename="a.bin", mime="x/y", size=1 * GB, candidates=[C("a", 10), C("b", 10)], settings=S)
    assert d.account_id == "b" and d.folder_id == "F1"


def test_skips_account_without_room():
    d = decide(filename="a.bin", mime="x/y", size=5 * GB, candidates=[C("a", 10), C("b", 1)], settings=S)
    assert d.account_id == "a"


def test_never_splits_files():
    with pytest.raises(AllocationError) as e:
        decide(filename="big.iso", mime="x/y", size=8 * GB, candidates=[C("a", 5), C("b", 5)], settings=S)
    assert e.value.code == "NO_ACCOUNT_HAS_SPACE"


def test_rule_wins_and_does_not_fall_back():
    s = {**S, "rules": [{"id": "1", "name": "Videos", "account_id": "a", "mime_prefixes": ["video/"]}]}
    ok = decide(filename="m.mp4", mime="video/mp4", size=1 * GB, candidates=[C("a", 10), C("b", 10)], settings=s)
    assert ok.account_id == "a"
    with pytest.raises(AllocationError) as e:
        decide(filename="m.mp4", mime="video/mp4", size=20 * GB, candidates=[C("a", 1), C("b", 14)], settings=s)
    assert e.value.code == "RULE_ACCOUNT_FULL"


def test_extension_rule_and_safety_margin():
    s = {**S, "safety_margin_mb": 1024, "rules": [{"id": "1", "name": "Docs", "account_id": "a", "extensions": ["pdf"]}]}
    assert decide(filename="x.PDF", mime="application/pdf", size=1, candidates=[C("a", 5), C("b", 5)], settings=s).account_id == "a"
    with pytest.raises(AllocationError):   # 0.5 GB free, 1 GB margin
        decide(filename="x.bin", mime="a/b", size=1, candidates=[Candidate("a", "a@x", "ACTIVE", 14.5 * GB, 15 * GB)], settings={**S, "safety_margin_mb": 1024})


def test_unlimited_and_reauth_accounts():
    unlimited = Candidate("u", "u@x", "ACTIVE", 10**15, None)
    broken = C("a", 10, status="NEEDS_REAUTH")
    assert decide(filename="a", mime="a/b", size=10**12, candidates=[broken, unlimited], settings=S).account_id == "u"
