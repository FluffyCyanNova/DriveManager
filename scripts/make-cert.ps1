<#
 Creates a self-signed HTTPS certificate in .\certs for LAN use.
 Example:  scripts\make-cert.ps1 -Hostname drivemanager.home.arpa -Ip 192.168.1.50
#>
param([string]$Hostname = 'localhost', [string]$Ip = '')
. "$PSScriptRoot\_common.ps1"
Assert-Docker
New-Item -ItemType Directory -Force -Path certs | Out-Null
$san = "DNS:localhost,DNS:$Hostname,IP:127.0.0.1"
if ($Ip) { $san += ",IP:$Ip" }
$certDir = (Resolve-Path certs).Path
docker run --rm -v "${certDir}:/certs" alpine/openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout /certs/server.key -out /certs/server.crt -subj "/CN=$Hostname" -addext "subjectAltName=$san"
if ($LASTEXITCODE -ne 0) { Fail "Certificate creation failed." }
Ok "Created certs\server.crt and certs\server.key"
Write-Host ""
Write-Host "To switch on HTTPS, edit .env:"
Write-Host "  ENABLE_TLS=true"
Write-Host "  COOKIE_SECURE=true"
Write-Host "  GOOGLE_REDIRECT_URI=https://${Hostname}:8443/auth/google/callback   (also add it in Google Cloud)"
Write-Host "Then run scripts\start.ps1 and open https://${Hostname}:8443"
Write-Host "Your browser will warn about the self-signed certificate; trust certs\server.crt to remove the warning."
