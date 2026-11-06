# Copies DriveManager's logs into the project's logs\ folder (git-ignored) so you can read or share them.
#   logs\backend.log, logs\worker.log (+ .1 ... .5)  rotating log files from the Docker volume (secrets are redacted)
#   logs\console.log                                  recent container output, incl. the frontend (nginx), which has no log file
# Usage: scripts\get-logs.ps1            (last 2000 console lines per service)
#        scripts\get-logs.ps1 -Tail 0    (all console output Docker still has)
param([int]$Tail = 2000)
. "$PSScriptRoot\_common.ps1"
Assert-Docker

$ids = docker compose ps -a -q backend 2>$null
if (-not $ids) { Fail "The DriveManager backend container doesn't exist. Start it once with scripts\start.ps1." }

New-Item -ItemType Directory -Force -Path logs | Out-Null
Info "Copying log files from the container..."
docker compose cp "backend:/logs/." "logs/"
if ($LASTEXITCODE -ne 0) { Fail "Copying the log files out of the container failed." }

Info "Saving recent container output (backend, worker, frontend)..."
$tailArg = if ($Tail -gt 0) { "$Tail" } else { "all" }
$console = docker compose logs --no-color --timestamps --tail $tailArg 2>&1
[IO.File]::WriteAllLines((Join-Path (Get-Location) 'logs\console.log'), [string[]]$console, $script:Utf8NoBom)

Ok "Logs saved in $(Join-Path (Get-Location) 'logs')"
Get-ChildItem logs -File | Sort-Object Name | ForEach-Object { Write-Host ("  {0,-20} {1,10:N0} KB  {2}" -f $_.Name, [math]::Ceiling($_.Length / 1KB), $_.LastWriteTime) }
Write-Host "Secrets are redacted, but email addresses and file names are not. Review before sharing." -ForegroundColor Yellow
