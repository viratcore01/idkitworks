#!/usr/bin/env bash
# Step 4: strong JWT secrets + full-output migrate + restart + verify.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

ENV_FILE="$APP_DIR/server/.env"

log "Replacing dev JWT secrets with strong random ones"
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$ENV_FILE"
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET|" "$ENV_FILE"
chown "$RUN_USER:$RUN_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
echo "secrets replaced (not printed)"

log "Migrate (full output)"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && export DIRECT_URL=\${DIRECT_URL:-\$DATABASE_URL} && npx prisma migrate deploy --schema=../prisma/schema.prisma" || log "MIGRATE FAILED (see above)"

log "Restarting service"
systemctl restart "$SERVICE"
sleep 6

log "Local health check"
curl -sf http://127.0.0.1:5000/api/health && echo && log "API UP" || { echo; journalctl -u "$SERVICE" -n 25 --no-pager | tail -12; }

log "Transport line"
journalctl -u "$SERVICE" -n 40 --no-pager | grep -E 'Email transport|Server running|Socket.IO' | tail -4 || true
