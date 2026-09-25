#!/usr/bin/env bash
# Redeploy: pull bundle, install, build, migrate (migration 0005 drops
# avatar_color), restart, verify. Safe to re-run.
set -uo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

log "Fetching code from bundle"
cd "$APP_DIR"
git fetch /tmp/zoclo.bundle main:bundle-main 2>/dev/null || git fetch /tmp/zoclo.bundle main
git reset --hard bundle-main

log "Installing dependencies"
npm install --include=dev >/tmp/deploy-install.log 2>&1 || { echo "INSTALL FAILED"; tail -20 /tmp/deploy-install.log; exit 1; }

log "Generating Prisma client + building (from server/, like Render)"
cd "$APP_DIR/server"
node -e "try{require('fs').rmSync('node_modules/.prisma',{recursive:true,force:true})}catch{}"
npx prisma generate --schema=../prisma/schema.prisma >/tmp/deploy-generate.log 2>&1 || { echo "GENERATE FAILED"; tail -20 /tmp/deploy-generate.log; exit 1; }
npm run build >/tmp/deploy-build.log 2>&1 || { echo "BUILD FAILED"; tail -30 /tmp/deploy-build.log; exit 1; }

log "Applying migrations (0005 drops avatar_color)"
# sudo strips the env, so source .env inside the inner shell and apply the
# same fallback Render's start command uses (schema requires directUrl).
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && set -a && . ./.env && set +a && export DIRECT_URL=\"\${DIRECT_URL:-\$DATABASE_URL}\" && npx prisma migrate deploy --schema=../prisma/schema.prisma" >/tmp/deploy-migrate.log 2>&1 \
  || { echo "MIGRATE FAILED"; tail -25 /tmp/deploy-migrate.log; exit 1; }
tail -3 /tmp/deploy-migrate.log

log "Restarting service"
systemctl restart "$SERVICE"

log "Verifying"
sleep 6
systemctl is-active "$SERVICE"
journalctl -u "$SERVICE" -n 12 --no-pager | grep -E "Server running|transport|Error" || true
curl -s -m 15 http://127.0.0.1:5000/api/health && echo " <- local health OK"
echo "DEPLOY COMPLETE"
