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
  FINALIZING  verify size, index the file, add it to the chosen virtual folder (optional), record activity,
              refresh quota, delete staged copy
  COMPLETED | FAILED (retryable) | CANCELLED
```
**Where Automatic puts a file:** the first matching routing rule decides the account (and its folder, if the rule has one). Otherwise the first account in priority order with room is used, with its default folder from Settings, or My Drive. The reason is stored in `allocation_reason`, and the destination's full path (`destination_path`) is worked out from the local index for display.

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
Each Google account has its own limit, and a file is never split across accounts. The dashboard shows one combined bar for convenience (used space plus each account's free space in its own colour), but always next to the **largest single free space**, since that is the biggest file that can actually be uploaded. Per-account cards show each quota on its own.

## Virtual folders
Pure references `(account_id, google_file_id)` with a cached name. Deleting a virtual folder or item never touches Google Drive. Items whose file disappears or is trashed stay visible with a status badge ("No longer in Drive", "In trash", "Account needs reconnecting").

An upload can name a virtual folder (`upload_jobs.virtual_folder_id`). The worker adds the file once the Google upload completes. If that virtual folder was deleted in the meantime, the upload still completes and the add is skipped.

## Sharing
*Share…* reads and changes the item's Drive permissions directly; nothing about sharing is stored locally. *Anyone with the link* is created with `allowFileDiscovery=false` (not searchable). People are added one address at a time, so one rejected address (for example no Google account while *Notify people* is off, or a Workspace policy that blocks outside sharing) is reported without stopping the rest. Changes are recorded in Activity (`share_link`, `share_add`, `share_role`, `share_remove`). *Copy link* copies the item's `webViewLink` and reports whether link sharing is on.

## Moving a file to another account
Nothing passes through this server. Steps:
1. Check the target's latest quota snapshot; refuse up front if the file doesn't fit.
2. **Transfer ownership** (when the source owns the file in My Drive). As the source: give the target writer access, then offer ownership (`pendingOwner`). As the target (also connected): accept (`role=owner`, `transferOwnership`). Then remove the file from the source's folders, add it to the target folder, and drop the source's leftover access. Same file ID and link.
3. **Copy fallback** if Google refuses the transfer (400/403: other domain, Workspace policy, not owner, shared drive): the half-made offer is withdrawn. The target gets temporary read access and makes a server-side `files.copy` into its own Drive. The original goes to the source's Trash, and the temporary access is removed. New file ID.
4. The local index and any virtual-folder references are updated to the moved file, both quotas are refreshed, and a `move_account` activity entry records the target and the method used.

Folders, shortcuts and trashed items are refused for now.

## Deleting
*Move to trash* is the default and is recoverable. *Delete permanently* (row menu, right-click or bulk bar, from anywhere, not only Trash) and *Empty trash* always need **two confirmations**. The first explains what will happen and, for items not yet in the trash, offers *Move to trash instead*. The second ("Are you sure?") lists every item that will be deleted, with sizes, and its button only unlocks after a 3-second countdown. The API also requires `confirm=true`. Permanently deleting a folder also removes its descendants from the local index, the same way Google does: items the account owns, or everything in a shared drive. Items owned by other people just lose that parent, and the next sync settles them.

## Sidebar order and pins
Stored server-side in `app_settings` (`ui.sidebar`) as `{order, pinned}`, so every browser and device shows the same sidebar. Pinned items are drawn first, in pin order, and can't be dragged. The rest follow `order`. Dashboard is pinned by default but can be unpinned. The server normalises what it's sent: unknown or duplicate keys are dropped, and items added in a later version are appended. The older `ui.sidebar_order` list, from before pins existed, is still read. Settings is not in the list: it is a fixed gear icon between the theme switch and Sign out, and a `settings` key saved by an older version is dropped. Changes update the UI immediately and roll back if the save fails. `DELETE /api/settings/sidebar` restores the default order and pins.

## Global search
The sidebar search box writes its text to the Files page's URL (`/files?q=…`), so the sidebar box and the Files search box always show the same text, and a search can be bookmarked. A sidebar search clears the account filter and searches every location except Trash.

## Privacy mode (hides emails)
A switch in the sidebar replaces every email address shown in the UI with a stable alias such as `user-k3f9x2`. That includes chips, lists, charts, server messages and notifications. It also hides Google display names. The same address always gets the same alias, and account colours stay the same, so accounts remain easy to tell apart. It is **display only**, meant for screenshots and screen sharing: the API, the logs and the database still hold the real addresses. The setting is stored per browser.

## Fake file and folder names (Settings → Developer)
A developer option for demos and recordings, only switched on from Settings → Developer (no sidebar shortcut). Every file, folder, shared drive and virtual folder name in the UI is replaced by a name built from two or three ordinary words (and sometimes a year), picked by an FNV-1a hash of the real name, so the same name always maps to the same fake one. The extension is kept, so icons and types still match. It is applied when rendering (`useMask().file()` / `.path()` in `src/utils/privacy.ts`), so it is **display only**: the API, search, sorting and the database use the real names, sizes and storage numbers are real, and the Rename dialog shows the real name so a fake one is never saved. Stored per browser (`dm-fake-names`); a **Demo** badge in the sidebar shows while it is on. Toasts and server error messages that quote a file name may still show the real name.

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
* **Moving between accounts** works for single files by ownership transfer, with a server-side copy as the fallback (see above). Folders aren't supported yet: transferring a folder doesn't carry its contents, so it would have to be rebuilt item by item.
* Google-native documents export through the Drive API, which limits exports to about 10 MB.
