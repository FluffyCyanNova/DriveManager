from __future__ import annotations

import shutil
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.config import VERSION, get_settings
from app.core.encryption import key_fingerprint
from app.core.time import utcnow
from app.database.database import get_db
from app.database.repositories.settings import get_setting

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health():
    """Unauthenticated liveness probe. Reveals nothing but 'ok'."""
    return {"status": "ok"}


@router.get("/health/details", dependencies=[Depends(require_auth)])
def details(request: Request, db: Session = Depends(get_db)):
    s = get_settings()
    db.execute(text("SELECT 1"))
    hb = get_setting(db, "worker_heartbeat")
    worker_ok = False
    if hb:
        from datetime import datetime
        worker_ok = utcnow() - datetime.fromisoformat(hb["at"]) < timedelta(seconds=90)
    disk = shutil.disk_usage(s.staging_dir) if _exists(s.staging_dir) else None
    return {"version": VERSION, "database": "ok", "worker": {"enabled": s.worker_enabled, "alive": worker_ok, "last_seen": hb["at"] if hb else None},
            "google_configured": s.google_configured, "redirect_uri": s.google_redirect_uri,
            "encryption_key_ok": not getattr(request.app.state, "key_mismatch", False),
            "staging_free_bytes": disk.free if disk else None}


def _exists(p: str) -> bool:
    import os
    return os.path.isdir(p)
