"""Maintenance CLI:  python -m app.cli <hash-password | backup | restore FILE | check>"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import zipfile
from app.core.time import utcnow


def hash_password() -> int:
    from app.core.security import hash_password as hp
    pw = sys.stdin.readline().rstrip("\r\n")
    if len(pw) < 10:
        print("ERROR: password must be at least 10 characters", file=sys.stderr)
        return 2
    print(hp(pw))
    return 0


def _db_path() -> str:
    from sqlalchemy.engine import make_url
    from app.config import get_settings
    return make_url(get_settings().database_url).database


def backup() -> int:
    from app.config import get_settings
    from app.core.encryption import key_fingerprint, load_key
    from app import config
    s = get_settings()
    os.makedirs(s.backup_dir, exist_ok=True)
    stamp = utcnow().strftime("%Y%m%d-%H%M%S")
    snap = os.path.join(s.backup_dir, f".snapshot-{stamp}.db")
    src, dst = sqlite3.connect(_db_path()), sqlite3.connect(snap)
    with dst:
        src.backup(dst)          # consistent online copy, safe while the app is running
    src.close(); dst.close()
    out = os.path.join(s.backup_dir, f"drivemanager-backup-{stamp}.zip")
    manifest = {"created_utc": stamp, "app_version": config.VERSION, "key_fingerprint": key_fingerprint()}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(snap, "drive_manager.db")
        z.writestr("encryption.key", load_key() + "\n")
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        z.writestr("README.txt", "This archive contains the database AND the encryption key needed to read the stored Google "
                   "credentials. Treat it like a password manager export: keep it private and offline.\n")
    os.remove(snap)
    os.chmod(out, 0o600)
    print(out)
    return 0


def restore(archive: str) -> int:
    from app.core.encryption import key_fingerprint
    with zipfile.ZipFile(archive) as z:
        manifest = json.loads(z.read("manifest.json"))
        if manifest["key_fingerprint"] != key_fingerprint():
            print("ERROR: the backup was made with a different APP_ENCRYPTION_KEY than the one in your .env.\n"
                  "Open the backup zip, copy the line from 'encryption.key' into APP_ENCRYPTION_KEY in .env, then run restore again.", file=sys.stderr)
            return 3
        db = _db_path()
        if os.path.exists(db):
            shutil.copy2(db, f"{db}.pre-restore-{utcnow():%Y%m%d-%H%M%S}")
        for ext in ("-wal", "-shm"):
            if os.path.exists(db + ext):
                os.remove(db + ext)
        with z.open("drive_manager.db") as src, open(db, "wb") as dst:
            shutil.copyfileobj(src, dst)
    print(f"Restored database from {archive}")
    return 0


def check() -> int:
    from app.config import get_settings
    from app.core.encryption import key_fingerprint
    s = get_settings()
    print(f"database: {_db_path()}\nencryption key fingerprint: {key_fingerprint()}\ngoogle configured: {s.google_configured}")
    return 0


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "hash-password":
        return hash_password()
    if cmd == "backup":
        return backup()
    if cmd == "restore" and len(argv) > 2:
        return restore(argv[2])
    if cmd == "check":
        return check()
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
