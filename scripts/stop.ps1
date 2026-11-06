. "$PSScriptRoot\_common.ps1"
Assert-Docker
# 'stop' keeps containers and ALL data. Never use 'docker compose down -v': it deletes the database volume.
docker compose stop
Ok "Stopped. Your data is untouched. Start again with scripts\start.ps1"
