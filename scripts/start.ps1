. "$PSScriptRoot\_common.ps1"
Assert-Docker
if (-not (Test-Path .env)) { Fail "No .env file yet. Run scripts\setup.ps1 first." }
if ((Test-Placeholder (Get-EnvValue 'APP_ENCRYPTION_KEY')) -or (Test-Placeholder (Get-EnvValue 'APP_SECRET_KEY')) -or (Test-Placeholder (Get-EnvValue 'APP_PASSWORD_HASH'))) {
    Fail "Setup is incomplete (keys or password missing). Run scripts\setup.ps1 first."
}
Info "Starting DriveManager (the first start builds the images and can take a few minutes)..."
Set-BuildInfo
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose failed to start. Run scripts\logs.ps1 to see why." }
$port = Get-AppPort
$url = "http://localhost:$port"
Info "Waiting for the app to answer..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if ($ready) { Ok "DriveManager is running: $url" ; Start-Process $url } else { Write-Host "Still starting. Check scripts\logs.ps1, then open $url" -ForegroundColor Yellow }
