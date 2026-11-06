from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.time import utcnow


class Base(DeclarativeBase):
    pass


def uid() -> str:
    return str(uuid.uuid4())


FOLDER_MIME = "application/vnd.google-apps.folder"
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    google_sub: Mapped[str] = mapped_column(String(64), unique=True)       # Drive permissionId (stable)
    email: Mapped[str] = mapped_column(String(320), index=True)
    display_name: Mapped[str | None] = mapped_column(String(255))
    encrypted_refresh_token: Mapped[str] = mapped_column(Text)
    scopes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")      # ACTIVE | NEEDS_REAUTH
    status_detail: Mapped[str | None] = mapped_column(Text)
    root_folder_id: Mapped[str | None] = mapped_column(String(128))
    initial_scan_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_quota_at: Mapped[datetime | None] = mapped_column(DateTime)


class Drive(Base):
    """My Drive (one per account) and shared drives the account can see."""
    __tablename__ = "drives"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    google_drive_id: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(20))                          # MY_DRIVE | SHARED_DRIVE
    name: Mapped[str] = mapped_column(String(512))
    capabilities: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (UniqueConstraint("account_id", "google_drive_id"),)


class DriveFile(Base):
    """Local metadata index of Drive items. Never contains file contents."""
    __tablename__ = "drive_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    google_file_id: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(1024))
    mime_type: Mapped[str] = mapped_column(String(255))
    is_folder: Mapped[bool] = mapped_column(Boolean, default=False)
    size: Mapped[int | None] = mapped_column(BigInteger)
    md5: Mapped[str | None] = mapped_column(String(64))
    created_time: Mapped[datetime | None] = mapped_column(DateTime)
    modified_time: Mapped[datetime | None] = mapped_column(DateTime)
    trashed: Mapped[bool] = mapped_column(Boolean, default=False)
    owned_by_me: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_email: Mapped[str | None] = mapped_column(String(320))
    drive_id: Mapped[str | None] = mapped_column(String(128))              # shared drive id, if any
    location: Mapped[str] = mapped_column(String(20), default="MY_DRIVE")  # MY_DRIVE | SHARED_WITH_ME | SHARED_DRIVE
    web_view_link: Mapped[str | None] = mapped_column(Text)
    shortcut_target_id: Mapped[str | None] = mapped_column(String(128))
    shortcut_target_mime: Mapped[str | None] = mapped_column(String(255))
    capabilities: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")      # ACTIVE | REMOVED
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (
        UniqueConstraint("account_id", "google_file_id"),
        Index("ix_files_listing", "account_id", "location", "trashed", "status"),
        Index("ix_files_name", "account_id", "name"),
        Index("ix_files_modified", "account_id", "modified_time"),
    )


class DriveFileParent(Base):
    __tablename__ = "drive_file_parents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("drive_files.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    parent_google_id: Mapped[str] = mapped_column(String(128))
    __table_args__ = (UniqueConstraint("file_id", "parent_google_id"), Index("ix_parent_lookup", "account_id", "parent_google_id"))


class QuotaSnapshot(Base):
    __tablename__ = "quota_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    taken_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    usage: Mapped[int] = mapped_column(BigInteger, default=0)
    limit: Mapped[int | None] = mapped_column(BigInteger)                  # None = unlimited / not reported
    usage_in_drive: Mapped[int] = mapped_column(BigInteger, default=0)
    usage_in_trash: Mapped[int] = mapped_column(BigInteger, default=0)
    __table_args__ = (Index("ix_quota_account_time", "account_id", "taken_at"),)


class SyncCursor(Base):
    __tablename__ = "sync_cursors"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    scope: Mapped[str] = mapped_column(String(20), default="ACCOUNT")      # ACCOUNT | DRIVE
    drive_id: Mapped[str] = mapped_column(String(128), default="")
    page_token: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (UniqueConstraint("account_id", "scope", "drive_id"),)


class SyncJob(Base):
    __tablename__ = "sync_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="INCREMENTAL")   # INITIAL | INCREMENTAL | MANUAL
    state: Mapped[str] = mapped_column(String(20), default="QUEUED", index=True)  # QUEUED|RUNNING|COMPLETED|FAILED
    files_processed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class UploadJob(Base):
    __tablename__ = "upload_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    filename: Mapped[str] = mapped_column(String(1024))
    size: Mapped[int] = mapped_column(BigInteger)
    mime_type: Mapped[str] = mapped_column(String(255), default="application/octet-stream")
    staged_path: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(10), default="MANUAL")        # MANUAL | AUTO
    requested_account_id: Mapped[str | None] = mapped_column(String(36))
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    account_email: Mapped[str | None] = mapped_column(String(320))
    destination_folder_id: Mapped[str | None] = mapped_column(String(128))
    destination_folder_name: Mapped[str | None] = mapped_column(String(1024))
    # optional DriveManager virtual folder to add the finished file to (plain id: deleting the folder never breaks the job)
    virtual_folder_id: Mapped[str | None] = mapped_column(String(36))
    state: Mapped[str] = mapped_column(String(20), default="QUEUED", index=True)
    # QUEUED VALIDATING ALLOCATING UPLOADING FINALIZING COMPLETED FAILED CANCELLED
    bytes_uploaded: Mapped[int] = mapped_column(BigInteger, default=0)
    resumable_uri_enc: Mapped[str | None] = mapped_column(Text)
    google_file_id: Mapped[str | None] = mapped_column(String(128))
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    allocation_reason: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class FileEvent(Base):
    """User-visible activity history. Survives account removal (account_email is cached)."""
    __tablename__ = "file_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), index=True)
    account_email: Mapped[str | None] = mapped_column(String(320))
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    google_file_id: Mapped[str | None] = mapped_column(String(128))
    file_name: Mapped[str | None] = mapped_column(String(1024))
    details: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class RealtimeEvent(Base):
    """Cross-process event bus (worker -> backend -> browser WebSocket). Pruned automatically."""
    __tablename__ = "realtime_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class VirtualFolder(Base):
    __tablename__ = "virtual_folders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("virtual_folders.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class VirtualFolderItem(Base):
    """A reference to a Drive item. Deleting a virtual folder or item never touches Google Drive."""
    __tablename__ = "virtual_folder_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    folder_id: Mapped[str] = mapped_column(ForeignKey("virtual_folders.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    google_file_id: Mapped[str] = mapped_column(String(128))
    cached_name: Mapped[str | None] = mapped_column(String(1024))
    cached_mime: Mapped[str | None] = mapped_column(String(255))
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("folder_id", "account_id", "google_file_id"),)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict | list | str | int | bool | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class LocalSession(Base):
    __tablename__ = "local_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)          # sha256(token)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
