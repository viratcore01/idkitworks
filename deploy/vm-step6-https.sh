#!/usr/bin/env bash
# Step 6: DIRECT_URL rewritten safely (no sed), migrate, restart, public verify.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
DOMAIN=129.154.239.74.sslip.io

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠  $*\033[0m"; }
ENV_FILE="$APP_DIR/server/.env"

log "Rebuilding DIRECT_URL line safely (no sed on URLs)"
DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[ -n "$DB_URL" ] || { echo "DATABASE_URL empty — abort"; exit 1; }
grep -v '^DIRECT_URL=' "$ENV_FILE" > "$ENV_FILE.tmp"
printf 'DIRECT_URL=%s\n' "$DB_URL" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
chown "$RUN_USER:$RUN_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
echo "DIRECT_URL rewritten (len ${#DB_URL}, not printed)"

log "Migrate"
if sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npx prisma migrate deploy --schema=../prisma/schema.prisma 2>&1 | tail -5"; then
  log "MIGRATIONS OK"
else
  warn "migrate failed again"; exit 1
fi

log "Restart service"
systemctl restart "$SERVICE"
sleep 6
curl -sf http://127.0.0.1:5000/api/health >/dev/null && log "API UP (local)" || { journalctl -u "$SERVICE" -n 15 --no-pager | tail -6; exit 1; }

log "Public checks"
echo -n "http  $DOMAIN : "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -m 15 "http://$DOMAIN/api/health" || echo "unreachable"
echo -n "https $DOMAIN : "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -m 15 "https://$DOMAIN/api/health" || echo "unreachable"
curl -sf -m 15 "https://$DOMAIN/api/health" && echo && log "PUBLIC HTTPS OK" || warn "https not answering yet — cert may still be issuing (Caddy retries automatically)"
