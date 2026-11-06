<#
 First-time setup. Safe to run again: it never overwrites an existing encryption key
 (that would make stored Google logins unreadable) and only asks for what is missing.
#>
. "$PSScriptRoot\_common.ps1"
Assert-Docker
Write-Host ""
Info "DriveManager setup"
Write-Host ""

if (-not (Test-Path .env)) { Copy-Item .env.example .env; Ok "Created .env from .env.example" }

# --- secrets -------------------------------------------------------------
if (Test-Placeholder (Get-EnvValue 'APP_SECRET_KEY')) {
    $s = [Convert]::ToBase64String((New-RandomBytes 48)).Replace('+','-').Replace('/','_').TrimEnd('=')
    Set-EnvValue 'APP_SECRET_KEY' $s
    Ok "Generated APP_SECRET_KEY"
}
if (Test-Placeholder (Get-EnvValue 'APP_ENCRYPTION_KEY')) {
    $k = [Convert]::ToBase64String((New-RandomBytes 32)).Replace('+','-').Replace('/','_')   # valid Fernet key
    Set-EnvValue 'APP_ENCRYPTION_KEY' $k
    Ok "Generated APP_ENCRYPTION_KEY"
    Write-Host "  Back up your .env file somewhere safe. Without this key, stored Google logins cannot be recovered." -ForegroundColor Yellow
} else {
    Write-Host "Keeping your existing APP_ENCRYPTION_KEY."
}

# --- login ---------------------------------------------------------------
$hashNow = Get-EnvValue 'APP_PASSWORD_HASH'
$setPassword = Test-Placeholder $hashNow
if (-not $setPassword) {
    $a = Read-Host "A login password is already set. Change it? (y/N)"
    $setPassword = ($a -match '^(y|yes)$')
}
if ($setPassword) {
    $user = Read-Host "Choose a username [admin]"
    if ([string]::IsNullOrWhiteSpace($user)) { $user = 'admin' }
    Set-EnvValue 'APP_USERNAME' $user
    while ($true) {
        $p1 = Read-Host "Choose a password (at least 10 characters)" -AsSecureString
        $p2 = Read-Host "Repeat the password" -AsSecureString
        $b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1)
        $b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b1)
        $plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b2)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2)
        if ($plain.Length -lt 10) { Write-Host "Too short. Use at least 10 characters." -ForegroundColor Yellow; continue }
        if ($plain -ne $plain2) { Write-Host "The two passwords differ. Try again." -ForegroundColor Yellow; continue }
        break
    }
    Info "Building the backend image (first time takes a few minutes)..."
    docker compose build backend
    if ($LASTEXITCODE -ne 0) { Fail "Building the backend image failed. Scroll up for the reason." }
    $out = $plain | docker compose run --rm -T --no-deps --entrypoint python backend -m app.cli hash-password
    $plain = $null; $plain2 = $null
    $hash = ($out | Where-Object { $_ -like '$argon2*' } | Select-Object -Last 1)
    if (-not $hash) { Fail "Could not create the password hash. Output was: $out" }
    Set-EnvValue 'APP_PASSWORD_HASH' ("'" + $hash.Trim() + "'")    # single quotes: the hash contains '$' characters
    Ok "Password saved (stored only as an Argon2 hash)."
}

# --- google --------------------------------------------------------------
if ((Test-Placeholder (Get-EnvValue 'GOOGLE_CLIENT_ID')) -or (Test-Placeholder (Get-EnvValue 'GOOGLE_CLIENT_SECRET'))) {
    Write-Host ""
    Write-Host "Google sign-in is not configured yet. docs\GOOGLE_OAUTH.md walks you through creating the credentials."
    $a = Read-Host "Do you already have the Google client ID and secret? (y/N)"
    if ($a -match '^(y|yes)$') {
        Set-EnvValue 'GOOGLE_CLIENT_ID' (Read-Host "Google client ID").Trim()
        Set-EnvValue 'GOOGLE_CLIENT_SECRET' (Read-Host "Google client secret").Trim()
        Ok "Saved Google credentials."
    } else {
        Write-Host "No problem. You can add them to .env later; the app starts without them."
    }
}

Write-Host ""
Ok "Setup finished. Next: run  scripts\start.ps1"
