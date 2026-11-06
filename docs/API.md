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
| DELETE | `/api/files/{account_id}/{file_id}` |
| PATCH | `/api/files/{account_id}/{file_id}` |
| GET | `/api/files/{account_id}/{file_id}/download` |
| POST | `/api/files/{account_id}/{file_id}/move` |
| POST | `/api/files/{account_id}/{file_id}/restore` |
| POST | `/api/files/{account_id}/{file_id}/trash` |

### uploads

| Method | Path |
|---|---|
| GET | `/api/uploads` |
| POST | `/api/uploads` |
| DELETE | `/api/uploads/{job_id}` |
| GET | `/api/uploads/{job_id}` |
| POST | `/api/uploads/{job_id}/cancel` |
| POST | `/api/uploads/{job_id}/retry` |

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

### health

| Method | Path |
|---|---|
| GET | `/api/health` |
| GET | `/api/health/details` |

## Notable behaviours
* `GET /api/files` parameters: `account_id`, `location` (`my_drive|shared_with_me|shared_drive`), `parent_id` (Google folder id or shared-drive id), `q` (name search, escapes wildcards), `type`, `modified_after/before`, `min_size/max_size`, `trashed`, `folders_only`, `sort` (`name|modified|size|type`), `direction`, `page`, `page_size` (max 500).
* `DELETE /api/files/{account}/{file}` moves to Google's trash. `?permanent=true` also requires `&confirm=true`.
* `GET /api/files/{account}/{file}/download?format=pdf|docx|xlsx|pptx|txt|csv` (format only for Google-native docs).
* `POST /api/uploads` is multipart: `file`, `mode` (`MANUAL|AUTO`), `account_id`, `folder_id`, `folder_name`.
* `POST /api/uploads/{id}/retry` accepts `{account_id}` to retry on another account.
* `PATCH /api/virtual-folders/{id}`: include `parent_id` (even `null`) to move the folder; cycles are rejected.
