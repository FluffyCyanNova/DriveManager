# Architecture

```
 Browser ──HTTP/WS──► nginx (frontend container)
                         ├─ static React app
                         ├─ /api  ─┐
                         ├─ /auth ─┼─► FastAPI backend ──► SQLite (WAL) ◄── worker
                         └─ /ws   ─┘        │                                │
                                            └──────── Google Drive API ◄─────┘
```

* **Frontend**: React + TypeScript + Vite + Tailwind. TanStack Query for data, Zustand for tiny global state (auth, toasts, theme).
* **Backend**: FastAPI, synchronous SQLAlchemy 2, Alembic migrations. It never copies file contents except while *relaying* a download or *staging* an upload.
* **Worker**: a separate process (APScheduler + a dispatcher loop with a thread pool). Exactly one may run (file lock). It owns uploads and syncing.
* **Event bus**: both processes append rows to `realtime_events`; the backend's WebSocket tails that table once per second and pushes to the browser. This avoids Redis and survives restarts; rows are pruned after 24 h.

## Google accounts and credentials
* OAuth 2.0 web-server flow with `access_type=offline`, `prompt=consent`, PKCE. Scope: `drive` only. The PKCE verifier and anti-forgery state live in a signed, HttpOnly, 10-minute cookie, not in the URL.
* The callback requires an active local session, so nobody else on your network can attach an account.
* The account identity is Drive's stable `permissionId`; reconnecting an account updates the existing record instead of duplicating it.
* The refresh token is encrypted with Fernet (`APP_ENCRYPTION_KEY`) before storage. Access tokens are cached **in memory only** for their lifetime. An `invalid_grant` marks the account `NEEDS_REAUTH`, pauses its sync and uploads, and shows a banner; nothing else is affected.

## Metadata index and sync
* `drive_files` + `drive_file_parents` mirror names, types, sizes, times, parents, capabilities and location class (`MY_DRIVE`, `SHARED_WITH_ME`, `SHARED_DRIVE`). No contents.
* **Initial scan**: take a `changes` start token *first*, then page through `files.list` (user corpus, then each shared drive). Edits made during the scan are replayed by the first incremental run. Rows not touched by a complete scan are marked `REMOVED`.
* **Incremental sync**: `changes.list` from the stored cursor; the cursor is saved after every page and all writes are idempotent upserts, so a crash replays safely. An invalid/expired cursor triggers an automatic full rescan.
* Sync runs every `SYNC_INTERVAL_MINUTES`, or on demand. Quota snapshots run every `QUOTA_REFRESH_INTERVAL_MINUTES` and again after each upload.
* File operations call Google first and then refresh that row locally, so Google remains the source of truth. Capabilities reported by Google (`canRename`, `canTrash`, `canDelete`, …) are checked before attempting an action.

## Uploads
```
browser ──(multipart, progress)──► backend: sanitise name, stage to /staging/jobs/<id>/, create job QUEUED
worker claims job (atomic UPDATE QUEUED→VALIDATING)
  VALIDATING  staged file present and same size
  ALLOCATING  AUTO: choose account | MANUAL: use the chosen one;  live quota check;  destination folder check
  UPLOADING   Google resumable session, 8 MB chunks; session URL stored encrypted; progress events
  FINALIZING  verify size, index the file, record activity, refresh quota, delete staged copy
  COMPLETED | FAILED (retryable) | CANCELLED
```
Safety properties (each covered by tests in `backend/tests/test_upload_runner.py`):

| Situation | Behaviour |
|---|---|
| Network drops mid-chunk | Retries with backoff; asks Google how many bytes it holds and continues from there. |
| Worker/container restarts | In-flight jobs go back to QUEUED; the stored session is queried and the upload resumes at Google's offset. |
| Crash after Google finished but before we recorded it | Every file is tagged `appProperties.drivemanager_job_id`; a later attempt finds it instead of uploading again, so **no duplicates**. |
| Not enough space | Fails with the numbers, keeps the staged file, and offers "retry on another account". It never silently switches a chosen account. |
| Automatic mode, matching rule's account is full | Fails and explains. Rules are explicit user intent, so there is no silent fallback. |
| Automatic mode, no rule | Accounts are tried in *your* priority order; the first with room (file + safety margin) wins. Files are never split. |
| Destination folder deleted/read-only | Fails with `DESTINATION_INVALID`; retry with another folder/account. |
| Account needs reauth | Fails with an actionable message; staged file kept. |
| Cancel | Queued: immediate. Running: stops between chunks, cancels Google's session, deletes staged copy. |

The staging area is cleaned after completion/cancel, failed jobs after `STAGING_RETENTION_HOURS`, and orphans after an hour.

## Quotas are not pooled
Each Google account has its own limit. The UI shows accounts side by side and never presents a combined "free space" figure. The only sum shown is "stored in total", clearly labelled.

## Virtual folders
Pure references `(account_id, google_file_id)` with a cached name. Deleting a virtual folder or item never touches Google Drive. Items whose file disappears or is trashed stay visible with a status badge ("No longer in Drive", "In trash", "Account needs reconnecting").

## Security model
* Single local user. Password stored as an Argon2id hash (in `.env`; changes made in the app are stored in the DB and take precedence). Constant-time compare, equalised timing for wrong usernames, 5 failures per 15 minutes per IP.
* Sessions: random 256-bit token in an HttpOnly, SameSite=Lax cookie (`Secure` when `COOKIE_SECURE=true`); only its SHA-256 is stored. Sliding 24 h idle window, 14 day absolute cap. Changing the password signs out other browsers.
* CSRF: every state-changing request needs the per-session `X-CSRF-Token` header **and** an `Origin` matching the host (or `ALLOWED_ORIGINS`). WebSockets check Origin and session too.
* Uploaded names are reduced to a basename; staged paths are generated server-side. Downloads are `attachment` + `nosniff`.
* nginx adds CSP (`script-src 'self'`), `X-Frame-Options: DENY`, `nosniff`, and HSTS when TLS is on. Docs/OpenAPI are disabled unless `APP_ENV=development`.
* Logs pass through a redaction filter (access/refresh tokens, `code=`/`state=` query strings, client secret, passwords, bearer headers).
* The backend/worker containers run as a non-root user; secrets are never passed to the frontend container.

## Decisions and deviations from the original specification
* **SQLite with WAL** is used as specified. Two processes share it safely (`busy_timeout` 30 s; no read transaction is held across network calls).
* A file's location class is a **column on `drive_files`** rather than a separate `file_locations` table; it is a pure function of Drive metadata, so a table added nothing.
* **Pause/resume of an upload is not offered** in the UI. Cancel and retry are, and restarts resume automatically.
* **Downloads stream straight from Google** through the backend rather than being staged on disk first (no disk use, immediate start).
* An uploaded file is written to disk twice on the server (multipart parser temp file, then the staging path). Simple and robust; it costs some extra I/O for very large files.
* `changes.list` is used with one **account-level cursor** (which includes shared drives the account belongs to). The schema supports per-drive cursors if ever needed.
* **Moving or copying between accounts** is not supported (Google has no such operation; it would require download + re-upload).
* Google-native documents export through the Drive API, which limits exports to about 10 MB.
