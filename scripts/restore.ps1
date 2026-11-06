param([Parameter(Mandatory = $true)][string]$File)
. "$PSScriptRoot\_common.ps1"
Assert-Docker
if (-not (Test-Path $File)) { Fail "File not found: $File" }
$full = (Resolve-Path $File).Path
$dir = Split-Path $full -Parent
$name = Split-Path $full -Leaf
Write-Host "This replaces the current database with the contents of:" -ForegroundColor Yellow
Write-Host "  $full"
Write-Host "A copy of the current database is kept next to it inside the data volume (.pre-restore-...)."
$a = Read-Host "Type RESTORE to continue"
if ($a -ne 'RESTORE') { Write-Host "Cancelled."; exit 0 }
Info "Stopping the app..."
docker compose stop worker backend frontend
docker compose run --rm --no-deps -T -v "${dir}:/restore:ro" --entrypoint python backend -m app.cli restore "/restore/$name"
$code = $LASTEXITCODE
if ($code -eq 3) {
    Write-Host ""
    Write-Host "The backup was made with a different encryption key than your .env has." -ForegroundColor Red
    Write-Host "Open the zip, copy the text from 'encryption.key', put it in .env as APP_ENCRYPTION_KEY=..., then run this again."
    docker compose up -d
    exit 3
}
if ($code -ne 0) { docker compose up -d; Fail "Restore failed (exit code $code). The app was started again with its previous data." }
docker compose up -d
Ok "Restored. DriveManager is starting with the backup's data."
