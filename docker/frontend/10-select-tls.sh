#!/bin/sh
# Switch nginx to the TLS config when ENABLE_TLS=true and certificates exist.
if [ "$ENABLE_TLS" = "true" ]; then
  if [ -f /etc/nginx/certs/server.crt ] && [ -f /etc/nginx/certs/server.key ]; then
    sed "s/__TLS_PORT__/${TLS_PORT:-8443}/g" /etc/nginx/tls/nginx.tls.conf > /etc/nginx/conf.d/default.conf
    echo "[drivemanager] TLS enabled"
  else
    echo "[drivemanager] ENABLE_TLS=true but certs/server.crt or certs/server.key is missing; serving plain HTTP"
  fi
fi
