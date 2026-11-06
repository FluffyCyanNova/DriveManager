#!/bin/sh
set -e
mkdir -p "${STAGING_DIR:-/staging}/.tmp" "${STAGING_DIR:-/staging}/jobs"
# Serialized migrations: only one process may migrate at a time.
( flock 9; alembic upgrade head ) 9>/data/.migrate.lock
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 \
  --proxy-headers --forwarded-allow-ips="*" --no-server-header
