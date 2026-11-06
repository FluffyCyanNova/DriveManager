. "$PSScriptRoot\_common.ps1"
Assert-Docker
Info "Taking a backup first..."
$running = docker compose ps --status running --services 2>$null
if ($running -contains 'backend') { & "$PSScriptRoot\backup.ps1" } else { Write-Host "App not running; skipping backup." -ForegroundColor Yellow }
Info "Rebuilding images and restarting (database migrations run automatically)..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "Update failed. Your data volumes are untouched. See scripts\logs.ps1." }
docker image prune -f | Out-Null
Ok "Updated."
