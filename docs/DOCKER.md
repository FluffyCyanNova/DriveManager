# Running and maintaining DriveManager (Docker)

## Containers
| Service | Purpose | Published port |
|---|---|---|
| `frontend` | nginx: serves the web app, proxies `/api`, `/auth`, `/ws` to the backend | `APP_PORT` (default 8000) and `TLS_PORT` (8443, only active with HTTPS enabled) |
| `backend` | FastAPI API, WebSocket, runs database migrations on start | none (internal only) |
| `worker` | scheduler + job runner: quota refresh, sync, uploads, housekeeping | none |

The backend and worker are never reachable from your network directly. Only nginx is.

## Volumes (your data)
| Volume | Contains |
|---|---|
| `drive_manager_db` | SQLite database (accounts, encrypted tokens, file index, history) |
| `drive_manager_secrets` | optional key file location (`/secrets/encryption.key`) |
| `drive_manager_staging` | uploaded files waiting to go to Google, plus temp files |
| `drive_manager_logs` | rotating log files (secrets are redacted) |
| `drive_manager_backups` | backups made by the backup command |

> **Never run `docker compose down -v`.** The `-v` flag deletes these volumes, including the database. Use `scripts\stop.ps1` (which runs `docker compose stop`) instead. `docker compose down` without `-v` is safe.

## Daily commands (PowerShell, from the project folder)
| Task | Command |
|---|---|
| First-time setup | `scripts\setup.ps1` |
| Start | `scripts\start.ps1` |
| Stop (data kept) | `scripts\stop.ps1` |
| Live logs | `scripts\logs.ps1` or `scripts\logs.ps1 worker` |
| Update to the latest version | `git switch main`, `git pull`, then `scripts\update.ps1` (backs up first, rebuilds, migrates). The script builds from the files in this folder, so pull first. |
| Back up | `scripts\backup.ps1` |
| Restore | `scripts\restore.ps1 -File backups\drivemanager-backup-XXXX.zip` |

All services restart automatically after a reboot (`restart: unless-stopped`) once Docker Desktop is running.

## Backups
`scripts\backup.ps1` makes a consistent snapshot of the database while the app is running and zips it **together with the encryption key**, into `.\backups`. Keep 14 by default (`-Keep N`).

* The key is required: without it the stored Google logins in a restored database can't be decrypted (you would simply reconnect your accounts, but nothing else is lost).
* Because the zip contains the key, treat it like a password-manager export. Don't put it in a public or shared cloud folder.
* The uploaded-file staging area is intentionally not backed up; it only holds files that are in transit.

Restore asks you to type `RESTORE`, stops the app, checks the key matches your `.env` (if not, it tells you which line to copy from the zip), swaps in the database, and starts again. A copy of the previous database is kept in the volume as `drive_manager.db.pre-restore-<time>`.

## HTTPS on your LAN (optional)
1. `scripts\make-cert.ps1 -Hostname drivemanager.home.arpa -Ip 192.168.1.50` (use your own name and IP).
2. In `.env`: `ENABLE_TLS=true`, `COOKIE_SECURE=true`, and `GOOGLE_REDIRECT_URI=https://drivemanager.home.arpa:8443/auth/google/callback` (add the same URI in Google Cloud).
3. `scripts\start.ps1`, then open `https://drivemanager.home.arpa:8443`. Plain port 8000 then redirects to HTTPS.

The certificate is self-signed, so browsers warn until you trust `certs\server.crt`. If you use a real hostname that isn't `localhost`, also set `ALLOWED_ORIGINS=https://drivemanager.home.arpa:8443` only if you see "origin not allowed" errors (normally the Host header already matches).

## Health and monitoring
* Docker health checks cover all three services (`docker compose ps`).
* **Settings, System** in the app shows worker status, encryption-key match, last worker heartbeat and free staging disk.
* A red banner appears in the app if the worker stops responding or an account needs reconnecting.

## Troubleshooting
| Symptom | What to check |
|---|---|
| `start.ps1` says setup incomplete | Run `scripts\setup.ps1`. |
| Page doesn't load | `docker compose ps`; then `scripts\logs.ps1 backend`. |
| Backend restarts in a loop with "APP_SECRET_KEY must be set" | `.env` still has placeholders; run setup. |
| Login says "No password is configured" | `APP_PASSWORD_HASH` is empty or lost its single quotes (it contains `$`). Re-run setup and choose to change the password. |
| Banner "encryption key doesn't match" | `.env` has a different `APP_ENCRYPTION_KEY` than the database was created with. Put the original back (it's in every backup zip). |
| Uploads stay "Waiting for the worker" | Worker down: `scripts\logs.ps1 worker`. |
| `database is locked` in logs | Rare and temporary (SQLite shared by two processes with a 30 s wait). Persistent cases usually mean the volume is on a network drive; keep it on Docker's local volumes. |
| Disk filling up | Large uploads wait in `drive_manager_staging` until sent. Failed jobs are kept `STAGING_RETENTION_HOURS` (72 h) so you can retry, then cleaned automatically. |
