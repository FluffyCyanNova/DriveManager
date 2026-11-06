from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app.api.routes import accounts, activity, auth, files, health, settings as settings_routes, storage, uploads, virtual
from app.config import VERSION, get_settings
from app.core.encryption import EncryptionKeyError, key_fingerprint
from app.core.exceptions import install_handlers
from app.core.logging import setup_logging
from app.database.database import SessionLocal
from app.database.repositories.settings import get_setting, set_setting
from app.websocket import events as ws_events

log = logging.getLogger("drivemanager")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    setup_logging("backend", s.log_dir)
    app.state.key_mismatch = False
    try:
        fp = key_fingerprint()
        with SessionLocal() as db:
            stored = get_setting(db, "key_fingerprint")
            if stored is None:
                set_setting(db, "key_fingerprint", fp)
            elif stored != fp:
                app.state.key_mismatch = True
                log.error("APP_ENCRYPTION_KEY does not match the key this database was created with. "
                          "Stored Google credentials cannot be decrypted until the original key is restored.")
    except EncryptionKeyError as e:
        app.state.key_mismatch = True
        log.error("%s", e)
    if not s.google_configured:
        log.warning("Google OAuth credentials are not configured; accounts can't be connected yet (docs/GOOGLE_OAUTH.md).")
    log.info("DriveManager %s backend started", VERSION)
    yield


def create_app() -> FastAPI:
    s = get_settings()
    dev = s.app_env == "development"
    app = FastAPI(title=s.app_name, version=VERSION, lifespan=lifespan,
                  docs_url="/api/docs" if dev else None, redoc_url=None, openapi_url="/api/openapi.json" if dev else None)
    install_handlers(app)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        if request.url.path.startswith("/api/") and "Cache-Control" not in resp.headers:
            resp.headers["Cache-Control"] = "no-store"
        return resp

    for r in (health.router, auth.router, accounts.router, accounts.callback_router, storage.router, files.router,
              uploads.router, virtual.router, activity.router, settings_routes.router, ws_events.router):
        app.include_router(r)
    return app


app = create_app()
