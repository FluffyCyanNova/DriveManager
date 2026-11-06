# API reference

All endpoints are under the same origin as the web app. JSON in, JSON out. Everything except `/api/health`, `/api/auth/login` and `/api/auth/session` needs the session cookie; unsafe methods (anything but GET) also need the `X-CSRF-Token` header returned by login/session. Errors look like `{"error": {"code": "...", "message": "...", "details": {}}}`.

Interactive docs (Swagger) are available at `/api/docs` only when `APP_ENV=development`.

WebSocket: `GET /ws/events` (session cookie, same-origin) streams `{id, type, payload, at}` events such as `upload.progress`, `upload.completed`, `storage.updated`, `files.changed`, `sync.progress`, `account.status_changed`.

Google redirect: `GET /auth/google/callback` (the OAuth redirect URI; browser only).

## Endpoints

### auth

| Method | Path |
|---|---|
| POST | `/api/auth/change-password` |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/session` |

### accounts

| Method | Path |
|---|---|
| GET | `/api/accounts` |
| POST | `/api/accounts/oauth/start` |
| DELETE | `/api/accounts/{account_id}` |
| GET | `/api/accounts/{account_id}` |
| POST | `/api/accounts/{account_id}/quota/refresh` |
| POST | `/api/accounts/{account_id}/sync` |

### oauth

| Method | Path |
|---|---|
| GET | `/auth/google/callback` |

### storage

| Method | Path |
|---|---|
| GET | `/api/analytics/summary` |
| GET | `/api/storage` |
| GET | `/api/storage/history` |
| POST | `/api/storage/refresh` |

### files

| Method | Path |
|---|---|
| GET | `/api/drives` |
| GET | `/api/drives/{account_id}` |
| GET | `/api/files` |
| POST | `/api/files/{account_id}/folders` |
| POST | `/api/files/{account_id}/trash/empty?confirm=true` |
| DELETE | `/api/files/{account_id}/{file_id}` |
| PATCH | `/api/files/{account_id}/{file_id}` |
| GET | `/api/files/{account_id}/{file_id}/download` |
| POST | `/api/files/{account_id}/{file_id}/move` |
| POST | `/api/files/{account_id}/{file_id}/move-to-account` |
| GET | `/api/files/{account_id}/{file_id}/sharing` |
| PUT | `/api/files/{account_id}/{file_id}/sharing/link` |
| POST | `/api/files/{account_id}/{file_id}/sharing/people` |
| PATCH | `/api/files/{account_id}/{file_id}/sharing/people/{permission_id}` |
| DELETE | `/api/files/{account_id}/{file_id}/sharing/people/{permission_id}` |
| POST | `/api/files/{account_id}/{file_id}/restore` |
| POST | `/api/files/{account_id}/{file_id}/trash` |

`GET /api/files` query parameters: `account_id`, `location` (`my_drive` | `shared_with_me` | `shared_drive`), `parent_id`, `q` (name search), `type` (`folder`, `document`, `spreadsheet`, `presentation`, `pdf`, `image`, `video`, `audio`, `archive`, `other`), `modified_after`, `modified_before`, `min_size`, `max_size`, `trashed`, `folders_only`, `all_files` (every file at any depth in `location`, folders hidden; each item gets `parent: {id, name}` or `null` at the top level), `sort` (`name` | `modified` | `size` | `type` | `account`), `direction` (`asc` | `desc`), `folders` (`first` | `last` | `mixed`, default `first`: where folders go relative to files), `page`, `page_size` (max 500).

`GET /api/files/{account_id}/{file_id}/download` streams the file (`?format=` picks the export format for Google Docs/Sheets/Slides) and records a *Downloaded* activity entry. With `?check=true` it only confirms the download can start and returns `{"ok": true, "filename": ...}` (or the usual error JSON). It sends no file data and records no activity. The web app calls it before starting the real download.

`GET /api/settings/runtime` includes `commit` and `build_date` (set when the Docker image is built by `scripts\start.ps1` / `update.ps1`; `null` otherwise).

**Sidebar order and pins.** `GET /api/settings/sidebar` returns `{order, pinned, default, default_pinned, customized}`. `PUT` takes `{"order": [...], "pinned": [...]}` using the keys `dashboard`, `uploads`, `files`, `trash`, `accounts`, `virtual`, `activity`, `analytics` (that's also the default order; `settings` from older versions is dropped, since Settings is now a fixed icon) (unknown or duplicate keys are dropped, missing ones appended to `order`), and `DELETE` resets both. Pinned items are shown first, in `pinned` order.

**Sharing.** `GET .../sharing` returns `{link, people, can_share, web_view_link, ...}`, where `link` is `null` (Restricted) or the role for *anyone with the link*. `PUT .../sharing/link` takes `{"role": "reader" | "commenter" | "writer" | null}`. `POST .../sharing/people` takes `{"emails": [...], "role", "notify", "message"}` and returns the new state plus `failed: [{email, message}]` for addresses Google rejected. `PATCH` changes one person's role and `DELETE` removes their access; the owner can't be removed.

**Move to another account.** `POST .../move-to-account` takes `{"target_account_id", "target_folder_id"}` (`null` = the target's My Drive) and returns `{"method": "transfer" | "copy", "file": {...}}`. It returns `409 INSUFFICIENT_SPACE` if the file doesn't fit, and refuses folders, shortcuts, trashed items and the same account.

`DELETE /api/files/{account_id}/{file_id}` moves the item to the trash. `?permanent=true&confirm=true` deletes it permanently (it doesn't need to be in the trash first).

### uploads

| Method | Path |
|---|---|
| GET | `/api/uploads` |
| POST | `/api/uploads` |
| DELETE | `/api/uploads/{job_id}` |
| GET | `/api/uploads/{job_id}` |
| POST | `/api/uploads/{job_id}/cancel` |
| POST | `/api/uploads/{job_id}/retry` |

Upload jobs include `destination_path` (e.g. `"My Drive / Work / Projects"`, or a shared drive's name first) once the account is known; it's `null` while Automatic hasn't chosen yet. `allocation_reason` explains Automatic's choice.

`POST /api/uploads` is `multipart/form-data`: `file`, `mode` (`MANUAL` | `AUTO`), `account_id` (required for MANUAL), optional `folder_id` / `folder_name` (Drive destination), and optional `virtual_folder_id` (adds the finished file to that virtual folder; 404 `FOLDER_NOT_FOUND` if it doesn't exist).

### virtual-folders

| Method | Path |
|---|---|
| GET | `/api/virtual-folders` |
| POST | `/api/virtual-folders` |
| POST | `/api/virtual-folders/items/{item_id}/move` |
| DELETE | `/api/virtual-folders/{folder_id}` |
| PATCH | `/api/virtual-folders/{folder_id}` |
| GET | `/api/virtual-folders/{folder_id}/items` |
| POST | `/api/virtual-folders/{folder_id}/items` |
| DELETE | `/api/virtual-folders/{folder_id}/items/{item_id}` |

### activity

| Method | Path |
|---|---|
| GET | `/api/activity` |

### settings

| Method | Path |
|---|---|
| GET | `/api/settings/allocation` |
| PUT | `/api/settings/allocation` |
| GET | `/api/settings/runtime` |
| GET | `/api/settings/sidebar` |
| PUT | `/api/settings/sidebar` |
| DELETE | `/api/settings/sidebar` |

### health

| Method | Path |
|---|---|
| GET | `/api/health` |
| GET | `/api/health/details` |

## Notable behaviours
* `GET /api/files` parameters: `account_id`, `location` (`my_drive|shared_with_me|shared_drive`), `parent_id` (Google folder id or shared-drive id), `q` (name search, escapes wildcards), `type`, `modified_after/before`, `min_size/max_size`, `trashed`, `folders_only`, `all_files`, `sort` (`name|modified|size|type|account`), `direction`, `page`, `page_size` (max 500).
* `DELETE /api/files/{account}/{file}` moves to Google's trash. `?permanent=true` also requires `&confirm=true`.
* `GET /api/files/{account}/{file}/download?format=pdf|docx|xlsx|pptx|txt|csv` (format only for Google-native docs).
* `POST /api/uploads` is multipart: `file`, `mode` (`MANUAL|AUTO`), `account_id`, `folder_id`, `folder_name`.
* `POST /api/uploads/{id}/retry` accepts `{account_id}` to retry on another account.
* `PATCH /api/virtual-folders/{id}`: include `parent_id` (even `null`) to move the folder; cycles are rejected.
