from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()  # Argon2id by default
_DUMMY_HASH = _ph.hash("not-the-password")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def burn_verify(password: str) -> None:
    """Equalize timing when the username is wrong."""
    verify_password(_DUMMY_HASH, password)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def safe_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


class LoginThrottle:
    """In-memory failed-login limiter (single backend process)."""

    def __init__(self, max_failures: int = 5, window: int = 900):
        self.max, self.window = max_failures, window
        self._fails: dict[str, list[float]] = defaultdict(list)

    def _prune(self, key: str) -> list[float]:
        cutoff = time.time() - self.window
        self._fails[key] = [t for t in self._fails[key] if t > cutoff]
        return self._fails[key]

    def blocked(self, key: str) -> int:
        fails = self._prune(key)
        if len(fails) >= self.max:
            return int(fails[0] + self.window - time.time()) + 1
        return 0

    def fail(self, key: str) -> None:
        self._prune(key).append(time.time())

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)


login_throttle = LoginThrottle()
