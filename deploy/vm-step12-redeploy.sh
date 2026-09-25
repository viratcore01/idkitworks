#!/usr/bin/env bash
# Step 12: standard redeploy — bundle is already at /tmp/zoclo.bundle.
# git runs as root (bundle fetch), build as the zoclo user (lockfile/DOTgit
# ownership), matching how the repo was first provisioned.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
log() { echo -e "\033[1;36m==> $*\033[0m"; }

git config --global --add safe.directory "$APP_DIR"

log "Fetching bundle → main"
git -C "$APP_DIR" fetch /tmp/zoclo.bundle main:bundle-main 2>&1 | tail -1 || true
git -C "$APP_DIR" reset --hard bundle-main
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

log "npm ci + build"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npm ci --include=dev --no-audit --no-fund 2>&1 | tail -1"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npm run build 2>&1 | tail -2"

log "Restart $SERVICE"
systemctl restart "$SERVICE"
sleep 5
curl -sf http://127.0.0.1:5000/api/health >/dev/null && log "API UP" || journalctl -u "$SERVICE" -n 12 --no-pager | tail -6
journalctl -u "$SERVICE" -n 12 --no-pager | grep -E 'transport|pool' | tail -2
rm -f /tmp/zoclo.bundle
log "bundle cleaned"
