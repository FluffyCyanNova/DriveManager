# Database

SQLite in WAL mode at `/data/drive_manager.db` (volume `drive_manager_db`). Schema is managed by Alembic (`backend/migrations`); the backend runs `alembic upgrade head` on every start, serialised with a file lock, and the worker waits until the schema exists.

| Table | Purpose |
|---|---|
| `accounts` | Connected Google accounts: stable id (`google_sub` = Drive permissionId), email, **encrypted** refresh token, status (`ACTIVE`/`NEEDS_REAUTH`), root folder id, scan flag |
| `drives` | My Drive (one per account) and visible shared drives |
| `drive_files` | Metadata index (never contents). Unique `(account_id, google_file_id)`. `location`, `trashed`, `status` (`ACTIVE`/`REMOVED`), `capabilities` JSON |
| `drive_file_parents` | File to parent-folder links (Drive items can have several parents) |
| `quota_snapshots` | Per-account usage/limit history (unchanged readings within an hour are not stored again) |
| `sync_cursors` | Persisted `changes` page token per account (scope `ACCOUNT`, or `DRIVE`) |
| `sync_jobs` | Queue/history of sync runs |
| `upload_jobs` | Upload queue and history: state machine, staged path, encrypted resumable URL, error code/message, allocation reason |
| `file_events` | Activity history; keeps `account_email` so history survives account removal |
| `realtime_events` | Worker/backend to browser event bus (pruned after 24 h) |
| `virtual_folders`, `virtual_folder_items` | Your own folder tree and references to Drive items |
| `app_settings` | Key/value JSON: `allocation` (routing rules, priority, defaults), `password_hash` override, `key_fingerprint`, `worker_heartbeat` |
| `local_sessions` | Browser sessions (SHA-256 of token, CSRF token, expiry) |

Foreign keys are enforced (`PRAGMA foreign_keys=ON`). Removing an account cascades to its index, quota history, cursors, jobs' account link (set null) and virtual-folder references; activity history is kept.
