# DriveManager

A private, self-hosted dashboard for managing several Google Drive accounts in one place. It runs on your own Windows PC in Docker and talks to Google only through the official Drive API.

![Dashboard: combined storage bar and one card per account, with emails hidden](docs/screenshots/dashboard.png)

<sub>Screenshots use sample accounts with **Privacy mode** switched on.</sub>

## Features

DriveManager keeps each account as its own quota. It doesn't merge them into one big drive.

### Storage at a glance
- Every account's quota side by side: used, free and in the trash
- One combined bar, plus the **largest free space**: the biggest file you can still upload
- Charts for storage over time, space by file type, largest files and uploads per day

### Files
- **My Drive, Shared with me, Shared drives and Trash** of every account in one list
- **Search everything** at any depth (**Ctrl + K**)
- Filter, sort, resize columns, or **show all files** as one flat list
- Select with **Shift + click**, right-click for actions
- Rename, move, create folders and download (Google Docs export to Office or PDF)
- **Share** with people or by link, and copy links
- **Move to another account** without downloading anything
- Trash, restore and **delete permanently** with a two-step confirmation

### Uploads
- **Automatic**: picks an account by your rules and free space, or choose the account and folder yourself
- **Drag and drop** files onto any page
- A progress panel like Google Drive's that shows where each file goes
- Resumes after network drops, never duplicates, and can retry failed uploads on another account

### Virtual folders
- Your own folder tree of links to files from any account. Nothing moves in Google Drive.

### Privacy and security
- **Privacy mode** hides every email address on screen, for screenshots and screen sharing
- **Fake file and folder names** (Settings → Developer) for demos and recordings
- Single local user, hashed password, CSRF and origin checks
- Google tokens encrypted at rest and redacted from logs
- Activity history, plus backup and restore scripts

### Your way
- Pin, reorder and resize the sidebar, or shrink it to icons only
- Light and dark theme
- Works on phones

**→ The [User guide](docs/USER_GUIDE.md) explains how to use each feature, with every shortcut.**

## Quick start (Windows 10/11)

1. Install and start **Docker Desktop**.
2. Open **PowerShell** in this folder and run:
   ```powershell
   scripts\setup.ps1     # creates secrets, asks for a username and password
   scripts\start.ps1     # builds, starts and opens http://localhost:8000
   ```
   (If PowerShell refuses to run scripts: `Set-ExecutionPolicy -Scope Process Bypass`, then try again.)
3. Create your Google credentials once by following **[docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md)**. Put them in `.env` (or re-run `scripts\setup.ps1`), then run `scripts\start.ps1` again.
4. Sign in, open **Accounts**, and click **Connect account**.

The first start builds the images and can take several minutes. Back up regularly with `scripts\backup.ps1`.

## Updating

`scripts\update.ps1` rebuilds from the files in this folder, so pull the latest code first:

```powershell
git switch main
git pull
scripts\update.ps1    # backs up, rebuilds the images, restarts; database migrations run automatically
```

Then reload the app in your browser. Your data lives in Docker volumes and isn't touched by an update.

**Settings → About** shows which build you're running (git commit and build time), with links to the repository, the docs, the license and *Report a problem*.

## Logs

The backend and worker write rotating log files (`backend.log`, `worker.log`; 5 MB each, 5 old copies kept) to the `drivemanager_drive_manager_logs` Docker volume. Tokens, passwords and the client secret are redacted. Email addresses and file names are not, since **Privacy mode** only changes what's on screen.

```powershell
scripts\logs.ps1            # follow live output of all services (Ctrl+C to stop)
scripts\logs.ps1 worker     # just one: backend, worker or frontend
scripts\get-logs.ps1        # copy everything into .\logs\ to read or share
```

**Which log to check**

| Problem with | Check |
|---|---|
| Uploads, syncs, storage refreshes | **worker** |
| Something that failed when you clicked it | **backend** |
| The page doesn't load at all | **frontend** |
| An error inside the page | Browser console (F12 → Console) |

`get-logs.ps1` saves `logs\backend.log`, `logs\worker.log` and `logs\console.log` (recent output from every container, including the frontend, which has no log file of its own). Add `-Tail 0` for all console output Docker still has. Console output is cleared when containers are recreated, for example by an update; the log files are kept. The `logs\` folder is git-ignored.

## Documentation
| | |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | How to use each feature, with every shortcut |
| [docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md) | Step-by-step Google Cloud setup (read the 7-day token note) |
| [docs/DOCKER.md](docs/DOCKER.md) | Operating it: volumes, updating, backup/restore, HTTPS, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works: uploads, deleting, virtual folders, Privacy mode, fake names, security model |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables and migrations |
| [docs/API.md](docs/API.md) | HTTP API, including query parameters for file listing and uploads |

## Project layout
```
docker-compose.yml  .env.example
.github/workflows/ CI: backend tests + frontend build on every pull request and push to main
docker/        Dockerfiles + nginx configs (backend, worker, frontend)
backend/       FastAPI app (app/), Alembic migrations, tests
  app/api  app/core  app/database  app/integrations/google_drive  app/services  app/workers  app/websocket
frontend/      React + TypeScript + Vite + Tailwind
scripts/       setup / start / stop / logs / get-logs / backup / restore / update / make-cert (PowerShell)
logs/          Copies of the logs made by scripts\get-logs.ps1 (git-ignored)
docs/          Documentation and screenshots
```

## Development
```powershell
# backend tests (Python 3.11+; CI uses 3.12). Dependencies are read from backend/pyproject.toml, like CI and the Dockerfiles do.
cd backend
python -c "import tomllib; p = tomllib.load(open('pyproject.toml', 'rb'))['project']; print('\n'.join(p['dependencies'] + p['optional-dependencies']['dev']))" > requirements-dev.txt
pip install -r requirements-dev.txt; pytest

# frontend type-check and production build (Node 22)
cd frontend; npm ci; npm run build
```

For a local backend, set the variables from `.env.example` in your shell (at least `APP_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `APP_PASSWORD_HASH`, `DATABASE_URL`, `STAGING_DIR`, `LOG_DIR`), run `alembic upgrade head`, then `uvicorn app.main:app`. `npm run dev` proxies to a backend on **:8000**. If your Docker instance is already using that port, run the dev backend on another port and add the dev origin (e.g. `http://localhost:5173`) to `ALLOWED_ORIGINS`.

## Testing and CI
GitHub Actions runs on every pull request and every push to `main`:
- **Backend tests** (73): sign-in and CSRF, encryption and log redaction, upload routing, file listing and sorting, deleting and emptying trash, virtual folders, the upload runner, sync and settings
- **Frontend**: TypeScript type-check and production build

Everything Google-facing is tested against a simulated Google, so the real Google API is only exercised when you run it. If something misbehaves, see [Logs](#logs).

## Known limitations
- One user only.
- Uploads can't be paused (cancel, retry and auto-resume work).
- Folders can't be moved between accounts yet; single files can.
- Ownership transfer only works between personal Google accounts or inside one Workspace organisation. Otherwise a move falls back to a copy with a new link.
- Google limits Docs, Sheets and Slides exports to about 10 MB.
- To connect accounts, open the app at the registered address (`http://localhost:8000`).

## License
[MIT](LICENSE) © 2026 FluffyCyanNova. You may use, change and share it, including commercially, as long as the copyright notice stays with it. It comes with no warranty.

Third-party packages keep their own licenses (mostly MIT, plus Apache-2.0 for Google's API client and the SIL Open Font License for IBM Plex Sans). Each install needs its own Google Cloud OAuth credentials (see [docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md)); none are included in this repository.
