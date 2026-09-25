#!/usr/bin/env bash
# Step 2: code + build on the VM (run as root). Env/systemd come in step 3.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

id -u "$RUN_USER" >/dev/null 2>&1 || useradd -r -m -d /opt/zoclo -s /usr/sbin/nologin "$RUN_USER"
mkdir -p /opt/zoclo

log "Placing code from bundle"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch /tmp/zoclo.bundle main:bundle-main 2>/dev/null || true
  git -C "$APP_DIR" reset --hard bundle-main
else
  rm -rf "$APP_DIR"
  git clone -q /tmp/zoclo.bundle "$APP_DIR"
  git -C "$APP_DIR" checkout -q main || git -C "$APP_DIR" checkout -q bundle-main || true
fi
# GitHub remote stays configured for later deploy-key-based pulls
git -C "$APP_DIR" remote set-url origin git@github.com:viratcore01/idkitworks.git || true
chown -R "$RUN_USER:$RUN_USER" /opt/zoclo

log "npm ci (server) — this is the slow part on 1 core"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npm ci --include=dev --no-audit --no-fund 2>&1 | tail -2"

log "Building (tsc) — swap keeps this alive"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npm run build 2>&1 | tail -3"

log "Generating Prisma client"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npx prisma generate --schema=../prisma/schema.prisma 2>&1 | tail -2"

ls -la "$APP_DIR/server/dist/server.js" && log "BUILD OK"
