#!/usr/bin/env bash
# Step 5: DIRECT_URL fallback (Render parity) + migrate + restart + verify.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
DOMAIN=129.154.239.74.sslip.io

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }
ENV_FILE="$APP_DIR/server/.env"

# Prisma CLI needs a nonempty DIRECT_URL; Render ran migrations over the
# pooler URL exactly this way (export DIRECT_URL=${DIRECT_URL:-$DATABASE_URL}).
DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[ -n "$DB_URL" ] || { echo "DATABASE_URL empty — abort"; exit 1; }
sed -i "s|^DIRECT_URL=.*|DIRECT_URL=$DB_URL|" "$ENV_FILE"
chown "$RUN_USER:$RUN_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
log "DIRECT_URL set (= pooler URL, Render parity; not printed)"

log "Migrate"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npx prisma migrate deploy --schema=../prisma/schema.prisma 2>&1 | tail -6"

log "Restart service"
systemctl restart "$SERVICE"
sleep 6
curl -sf http://127.0.0.1:5000/api/health >/dev/null && log "API UP (local)" || { journalctl -u "$SERVICE" -n 20 --no-pager | tail -8; exit 1; }

log "Public HTTPS via Caddy ($DOMAIN)"
systemctl is-active caddy >/dev/null && log "caddy active" || journalctl -u caddy -n 10 --no-pager
sleep 3
curl -sf "https://$DOMAIN/api/health" && echo && log "PUBLIC HTTPS OK" || {
  echo "(https not ready — cert may still be issuing; checking http)"
  curl -sf "http://$DOMAIN/api/health" && echo && warn "HTTP OK, cert still issuing — retry https in ~60s" || warn "public check failed — check OCI security list allows TCP 80+443"
}
