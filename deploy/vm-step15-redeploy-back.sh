#!/usr/bin/env bash
# Deploy the "reversible onboarding" changes to the Oracle VM.
#
#   bash vm-step15-redeploy-back.sh          (expects /tmp/zoclo.bundle)
#
# Hard-syncs the tree to the bundle's main, installs, regenerates Prisma,
# builds the API, applies migrations, restarts the unit, then proves the new
# endpoints answer. Safe to re-run. Rewrites /opt/zoclo/app + restarts the
# systemd unit, so it needs root — it re-executes itself through the VM's sudo
# when it isn't already root.
set -uo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n bash "$0" "$@"
fi

APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
BASE_URL=http://127.0.0.1:5000
log() { echo -e "\n\033[1;36m==> $* \033[0m"; }

log "Fetching code from bundle"
cd "$APP_DIR"
git fetch /tmp/zoclo.bundle main:bundle-main 2>/dev/null || git fetch /tmp/zoclo.bundle main
git reset --hard bundle-main
git log --oneline -1

log "Installing dependencies"
npm install --include=dev >/tmp/deploy-install.log 2>&1 || { echo "INSTALL FAILED"; tail -20 /tmp/deploy-install.log; exit 1; }

log "Generating Prisma client + building (from server/, like Render)"
cd "$APP_DIR/server"
node -e "try{require('fs').rmSync('node_modules/.prisma',{recursive:true,force:true})}catch{}"
npx prisma generate --schema=../prisma/schema.prisma >/tmp/deploy-generate.log 2>&1 || { echo "GENERATE FAILED"; tail -20 /tmp/deploy-generate.log; exit 1; }
npm run build >/tmp/deploy-build.log 2>&1 || { echo "BUILD FAILED"; tail -30 /tmp/deploy-build.log; exit 1; }

log "Applying migrations"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && set -a && . ./.env && set +a && export DIRECT_URL=\"\${DIRECT_URL:-\$DATABASE_URL}\" && npx prisma migrate deploy --schema=../prisma/schema.prisma" >/tmp/deploy-migrate.log 2>&1 \
  || { echo "MIGRATE FAILED"; tail -25 /tmp/deploy-migrate.log; exit 1; }
tail -3 /tmp/deploy-migrate.log

log "Restarting service"
systemctl restart "$SERVICE"
sleep 6
systemctl is-active "$SERVICE"
journalctl -u "$SERVICE" -n 15 --no-pager | grep -E "Server running|transport|Refusing|Error" || true

log "Verifying endpoints"
printf 'health                 -> '
curl -s -o /dev/null -w '%{http_code}\n' -m 15 "$BASE_URL/api/health"
printf 'username-available(admin)  -> '
curl -s -m 15 "$BASE_URL/api/auth/username-available?username=admin" -w ' [%{http_code}]\n'
printf 'username-available(free)   -> '
curl -s -m 15 "$BASE_URL/api/auth/username-available?username=probe$RANDOM$RANDOM" -w ' [%{http_code}]\n'
printf 'username-available(short)  -> '
curl -s -m 15 "$BASE_URL/api/auth/username-available?username=ab" -w ' [%{http_code}]\n'
printf 'signup(wrong domain)       -> '
curl -s -m 15 -X POST "$BASE_URL/api/auth/signup" -H 'Content-Type: application/json' \
  -d '{"collegeId":"x","email":"probe@example.com","username":"probeabc","displayName":"Probe User"}' -w ' [%{http_code}]\n'
echo
echo "DEPLOY COMPLETE"
