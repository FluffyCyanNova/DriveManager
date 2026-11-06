param([int]$Keep = 14)
. "$PSScriptRoot\_common.ps1"
Assert-Docker
$running = docker compose ps --status running --services 2>$null
if ($running -notcontains 'backend') { Fail "DriveManager is not running. Start it with scripts\start.ps1, then back up." }
Info "Creating a consistent snapshot of the database and encryption key..."
$out = docker compose exec -T backend python -m app.cli backup
if ($LASTEXITCODE -ne 0) { Fail "Backup failed inside the container." }
$inside = ($out | Select-Object -Last 1).Trim()
New-Item -ItemType Directory -Force -Path backups | Out-Null
docker compose cp "backend:$inside" "backups/"
if ($LASTEXITCODE -ne 0) { Fail "Copying the backup out of the container failed." }
$file = Join-Path backups (Split-Path $inside -Leaf)
Ok "Backup saved: $file"
Write-Host "This file contains your encryption key. Store it somewhere private (not a public cloud folder)." -ForegroundColor Yellow
Get-ChildItem backups -Filter 'drivemanager-backup-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | ForEach-Object { Remove-Item $_.FullName; Write-Host "Removed old backup $($_.Name)" }
