"""Application settings, loaded from environment variables (the root .env via Docker Compose)."""
from __future__ import annotations

import re
from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

VERSION = "1.0.0"
_PLACEHOLDER = re.compile(r"^replace_with|^your_", re.I)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    app_name: str = "DriveManager"
    app_env: str = "production"
    app_port: int = 8000
    app_secret_key: str = ""
    app_encryption_key: str | None = None
    encryption_key_file: str = "/secrets/encryption.key"
    tz: str = "UTC"

    app_username: str = "admin"
    app_password_hash: str = ""
    cookie_secure: bool = False
    session_ttl_hours: int = 24
    session_absolute_days: int = 14
    allowed_origins: str = ""

    database_url: str = "sqlite:////data/drive_manager.db"

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"
    google_drive_scopes: str = "https://www.googleapis.com/auth/drive"

    worker_enabled: bool = True
    sync_interval_minutes: int = 5
    quota_refresh_interval_minutes: int = 5
    upload_concurrency: int = 2
    upload_chunk_mb: int = 8
    staging_retention_hours: int = 72

    staging_dir: str = "/staging"
    log_dir: str = "/logs"
    backup_dir: str = "/backups"
    service_name: str = "backend"

    @field_validator("app_password_hash", "app_secret_key", "app_username", "google_client_id",
                     "google_client_secret", "app_encryption_key", mode="before")
    @classmethod
    def _clean(cls, v):
        if v is None:
            return v
        v = str(v).strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        return v

    @field_validator("app_password_hash")
    @classmethod
    def _unescape_dollars(cls, v: str) -> str:
        return v.replace("$$", "$")  # tolerate Compose-style escaped dollars

    @field_validator("upload_chunk_mb")
    @classmethod
    def _chunk(cls, v: int) -> int:
        if v < 1 or v > 256:
            raise ValueError("UPLOAD_CHUNK_MB must be between 1 and 256")
        return v

    @model_validator(mode="after")
    def _check(self):
        if len(self.app_secret_key) < 32 or _PLACEHOLDER.match(self.app_secret_key):
            raise ValueError("APP_SECRET_KEY must be set to a random value of at least 32 characters (run scripts\\setup.ps1).")
        return self

    # ---- convenience ----
    @property
    def scopes(self) -> list[str]:
        return [s for s in re.split(r"[\s,]+", self.google_drive_scopes) if s]

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret
                    and not _PLACEHOLDER.match(self.google_client_id)
                    and not _PLACEHOLDER.match(self.google_client_secret))

    @property
    def extra_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def chunk_bytes(self) -> int:
        return self.upload_chunk_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
