# DriveManager

A private, self-hosted dashboard for managing several Google Drive accounts from one place. It runs on your own Windows PC in Docker and talks to Google only through the official Drive API.

**What it does**

* Connect multiple Google accounts (My Drive, Shared with me, shared drives) and see **each account's own storage quota** side by side, with history charts.
* **Browse and search everything** in one list: rename, move, create folders, download (Google Docs/Sheets/Slides export to Office/PDF), trash, restore, delete permanently (with confirmation).
* **Upload** with live progress, to an account you choose or **automatically** (routing rules by file type/name, then your account priority, never splitting a file, never silently switching a chosen account). Uploads **resume** after network drops or restarts and **never duplicate**.
* **Virtual folders**: organise links to files across accounts without moving anything in Drive.
* Activity history, analytics, encrypted credentials, backup and restore scripts.

DriveManager shows accounts as separate quotas. It does not merge them into one big drive.

## Quick start (Windows 10/11)

1. Install and start **Docker Desktop**.
2. Open **PowerShell** in this folder and run:
   ```powershell
   scripts\setup.ps1     # creates secrets, asks for a username and password
   scripts\start.ps1     # builds, starts and opens http://localhost:8000
   ```
   (If PowerShell refuses to run scripts: `Set-ExecutionPolicy -Scope Process Bypass`, then try again.)
3. Create your Google credentials once by following **[docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md)**, put them in `.env` (or re-run `scripts\setup.ps1`), then `scripts\start.ps1` again.
4. Sign in, open **Accounts**, click **Connect account**.

The first start builds images and can take several minutes. Back up regularly with `scripts\backup.ps1`.

## Documentation
| | |
|---|---|
| [docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md) | Step-by-step Google Cloud setup (read the 7-day token note) |
| [docs/DOCKER.md](docs/DOCKER.md) | Operating it: volumes, backup/restore, HTTPS, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works, safety guarantees, security model, deviations from the spec |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables |
| [docs/API.md](docs/API.md) | HTTP API |

## Project layout
```
docker-compose.yml  .env.example
docker/        Dockerfiles + nginx configs (backend, worker, frontend)
backend/       FastAPI app (app/), Alembic migrations, tests
  app/api  app/core  app/database  app/integrations/google_drive  app/services  app/workers  app/websocket
frontend/      React + TypeScript + Vite + Tailwind
scripts/       setup / start / stop / logs / backup / restore / update / make-cert (PowerShell)
docs/
```

## Development
```powershell
# backend tests (Python 3.11+)
cd backend; pip install -e ".[dev]"; pytest
# frontend with hot reload (proxies to a backend on :8000)
cd frontend; npm ci; npm run dev
```
For local backend runs set the variables from `.env.example` in your shell (at least `APP_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `APP_PASSWORD_HASH`, `DATABASE_URL`, `STAGING_DIR`, `LOG_DIR`), run `alembic upgrade head`, then `uvicorn app.main:app`.

## Honest status of this build
Verified here: the backend test suite (43 tests: auth/CSRF/origin, encryption and log redaction, allocation rules, file index queries, virtual folders, the upload runner against a simulated Google, sync incl. cursor recovery), a live uvicorn + migrations + login + backup/restore run, the worker boot/heartbeat/shutdown, TypeScript type-check and a production frontend build.

**Not** verifiable in the environment it was written in, so please treat first run as a shakedown: the Docker image builds and compose wiring, the nginx configs (`nginx -t`), the PowerShell scripts on Windows, the UI in a real browser, and **real Google API calls** (everything Google-facing was tested against fakes). If something misbehaves, `scripts\logs.ps1` is the first place to look.

## Known limitations
No pause button for uploads (cancel/retry/auto-resume exist); no cross-account move/copy; single user; Google-native exports are limited to ~10 MB by Google; the app must be opened at the registered redirect address (`http://localhost:8000`) to connect accounts.
