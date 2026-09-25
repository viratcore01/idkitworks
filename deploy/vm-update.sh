#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Zoclo VM update — the "just deploy the latest main" command.
#
# Standard run — on the VM (as root or via passwordless sudo):
#   bash deploy/vm-update.sh
#
# If the VM's GitHub deploy key is broken ("git fetch origin" fails), scp a
# bundle of main from your machine and re-run — the script picks it up:
#   git bundle create /tmp/zoclo.bundle main
#   scp -i <key> /tmp/zoclo.bundle deploy/vm-update.sh ubuntu@129.154.239.74:/tmp/
#   ssh -i <key> ubuntu@129.154.239.74 'bash /tmp/vm-update.sh'
#
# Pulls origin/main, installs, regenerates the Prisma client, builds the API,
# applies migrations, restarts the systemd unit, then proves the API answers.
# Safe to re-run. Touches /opt/zoclo/app and the systemd unit, so it needs
# root — it re-executes itself through sudo when it isn't already root.
#
# Does NOT touch: /etc/caddy/Caddyfile, server/.env, the database schema
# beyond `prisma migrate deploy` (forward-only, no destructive ops). It does
# hard-reset the repo to origin/main, discarding any local VM-side commits.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n bash "$0" "$@"
fi

APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
BASE_URL=http://127.0.0.1:5000
log() { echo -e "\n\033[1;36m==> $* \033[0m"; }

log "Fetching latest code"
cd "$APP_DIR"
if git fetch origin 2>/tmp/deploy-fetch.log; then
  :
else
  echo "git fetch origin failed:"
  cat /tmp/deploy-fetch.log
  if [ -f /tmp/zoclo.bundle ]; then
    log "Falling back to /tmp/zoclo.bundle (scp'd from your machine)"
    git fetch /tmp/zoclo.bundle 'refs/heads/main:refs/remotes/origin/main' \
      || { echo "BUNDLE FETCH FAILED"; exit 1; }
  else
    echo "No /tmp/zoclo.bundle either — ABORTING rather than resetting to a stale origin/main."
    exit 1
  fi
fi
BEFORE=$(git rev-parse --short HEAD)
git reset --hard origin/main
AFTER=$(git rev-parse --short HEAD)
echo "$BEFORE -> $AFTER  ($(git log --oneline -1))"
[ "$BEFORE" = "$AFTER" ] && echo "Already up to date — continuing anyway (rebuild is idempotent)."

log "Installing dependencies"
npm install --include=dev >/tmp/deploy-install.log 2>&1 \
  || { echo "INSTALL FAILED"; tail -20 /tmp/deploy-install.log; exit 1; }

log "Generating Prisma client + building (from server/, like Render did)"
cd "$APP_DIR/server"
node -e "try{require('fs').rmSync('node_modules/.prisma',{recursive:true,force:true})}catch{}"
npx prisma generate --schema=../prisma/schema.prisma >/tmp/deploy-generate.log 2>&1 \
  || { echo "GENERATE FAILED"; tail -20 /tmp/deploy-generate.log; exit 1; }
npm run build >/tmp/deploy-build.log 2>&1 \
  || { echo "BUILD FAILED"; tail -30 /tmp/deploy-build.log; exit 1; }

log "Applying migrations (forward-only, as $RUN_USER with .env loaded)"
# sudo strips the environment, so source .env inside the inner shell and apply
# the same DIRECT_URL fallback Render's start command used.
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && set -a && . ./.env && set +a && export DIRECT_URL=\"\${DIRECT_URL:-\$DATABASE_URL}\" && npx prisma migrate deploy --schema=../prisma/schema.prisma" >/tmp/deploy-migrate.log 2>&1 \
  || { echo "MIGRATE FAILED"; tail -25 /tmp/deploy-migrate.log; exit 1; }
tail -3 /tmp/deploy-migrate.log

log "Restarting service"
systemctl restart "$SERVICE"
sleep 6
systemctl is-active "$SERVICE" || { echo "SERVICE INACTIVE"; journalctl -u "$SERVICE" -n 30 --no-pager; exit 1; }
journalctl -u "$SERVICE" -n 15 --no-pager | grep -E "Server running|transport|Refusing|Error" || true

log "Verifying endpoints"
printf 'health                    -> '
curl -s -o /dev/null -w '%{http_code}\n' -m 15 "$BASE_URL/api/health"
printf 'health/db                 -> '
curl -s -o /dev/null -w '%{http_code}\n' -m 15 "$BASE_URL/api/health/db"
printf 'https (via Caddy, public) -> '
curl -sk -o /dev/null -w '%{http_code}\n' -m 15 https://129.154.239.74.sslip.io/api/health
echo
echo "DEPLOY COMPLETE — $(git -C "$APP_DIR" log --oneline -1)"
