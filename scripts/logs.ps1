param([string]$Service = '')
. "$PSScriptRoot\_common.ps1"
Assert-Docker
if ($Service) { docker compose logs -f --tail 150 $Service } else { docker compose logs -f --tail 100 }
