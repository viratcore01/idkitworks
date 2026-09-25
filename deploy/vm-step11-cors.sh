#!/usr/bin/env bash
# Step 11: CORS — the VM env was cloned from local dev; its CLIENT_URL points
# at localhost, so the Vercel origin would be rejected everywhere.
set -euo pipefail
APP_DIR=/opt/zoclo/app
SERVICE=zoclo-api
log() { echo -e "\033[1;36m==> $*\033[0m"; }
ENV_FILE="$APP_DIR/server/.env"

grep -v '^CLIENT_URL=' "$ENV_FILE" > "$ENV_FILE.tmp"
printf 'CLIENT_URL=%s\n' "https://idkitworks.vercel.app" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
chown zoclo:zoclo "$ENV_FILE" && chmod 600 "$ENV_FILE"
log "CLIENT_URL → https://idkitworks.vercel.app (not printed beyond this)"

systemctl restart "$SERVICE"; sleep 5
curl -sf http://127.0.0.1:5000/api/health >/dev/null && log "API UP"
journalctl -u "$SERVICE" -n 12 --no-pager | grep -E 'Server running|transport|pool' | tail -3
