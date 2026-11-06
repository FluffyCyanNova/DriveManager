# Shared helpers (dot-sourced by the other scripts). ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = $script:Utf8NoBom

function Fail([string]$Message) { Write-Host ""; Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }
function Info([string]$Message) { Write-Host $Message -ForegroundColor Cyan }
function Ok([string]$Message)   { Write-Host $Message -ForegroundColor Green }

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Docker was not found. Install Docker Desktop for Windows, start it, then run this again." }
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Docker is installed but not running. Start Docker Desktop, wait until it says 'running', then try again." }
    docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "'docker compose' is not available. Update Docker Desktop to a recent version." }
}

function Get-EnvValue([string]$Key) {
    if (-not (Test-Path .env)) { return $null }
    foreach ($line in [IO.File]::ReadAllLines((Join-Path (Get-Location) '.env'))) {
        if ($line -match "^\s*$([regex]::Escape($Key))=(.*)$") { return $Matches[1].Trim().Trim("'").Trim('"') }
    }
    return $null
}

function Set-EnvValue([string]$Key, [string]$Value) {
    $path = Join-Path (Get-Location) '.env'
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path $path) { foreach ($l in [IO.File]::ReadAllLines($path)) { $lines.Add($l) } }
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$([regex]::Escape($Key))=") { $lines[$i] = "$Key=$Value"; $found = $true; break }
    }
    if (-not $found) { $lines.Add("$Key=$Value") }
    [IO.File]::WriteAllLines($path, $lines.ToArray(), $script:Utf8NoBom)   # UTF-8 without BOM
}

function New-RandomBytes([int]$Count) {
    $b = New-Object byte[] $Count
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($b); $rng.Dispose()
    return ,$b
}

function Test-Placeholder([string]$Value) { return ([string]::IsNullOrWhiteSpace($Value) -or $Value -like 'replace_with*' -or $Value -like 'your_*') }

function Get-AppPort { $p = Get-EnvValue 'APP_PORT'; if ($p) { return $p } else { return '8000' } }

# Build info shown in Settings > About: the git commit and time of this build (passed to docker compose as build args).
function Set-BuildInfo {
    $commit = 'unknown'
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $c = git rev-parse --short HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and $c) {
            $commit = $c.Trim()
            git diff --quiet HEAD 2>$null
            if ($LASTEXITCODE -ne 0) { $commit = "$commit+changes" }
        }
    }
    $env:DM_COMMIT = $commit
    $env:DM_BUILD_DATE = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
