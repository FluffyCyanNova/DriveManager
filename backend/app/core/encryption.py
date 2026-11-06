"""Application-level encryption for OAuth refresh tokens and resumable-upload URIs (Fernet)."""
from __future__ import annotations

import hashlib
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class EncryptionKeyError(RuntimeError):
    pass


def load_key() -> str:
    s = get_settings()
    key = (s.app_encryption_key or "").strip()
    if key and not key.startswith("replace_with"):
        return key
    if os.path.exists(s.encryption_key_file):
        return open(s.encryption_key_file).read().strip()
    raise EncryptionKeyError("APP_ENCRYPTION_KEY is not set (and no key file was found). Run scripts\\setup.ps1 or restore your key.")


@lru_cache
def _fernet() -> Fernet:
    try:
        return Fernet(load_key().encode())
    except (ValueError, TypeError) as e:
        raise EncryptionKeyError("APP_ENCRYPTION_KEY is not a valid Fernet key (32 url-safe base64 bytes).") from e


def key_fingerprint() -> str:
    return hashlib.sha256(load_key().encode()).hexdigest()[:12]


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise EncryptionKeyError("Stored credentials cannot be decrypted with the current APP_ENCRYPTION_KEY. "
                                 "Restore the original key from your backup.") from e
