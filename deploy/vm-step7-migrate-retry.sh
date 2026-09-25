#!/usr/bin/env bash
# Step 7: honest migrate retry (no pipes masking exit codes) + listener audit.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
log() { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠  $*\033[0m"; }

LOG=/tmp/migrate.log
ok=0
for i in 1 2 3 4 5; do
  log "Migrate attempt $i/5"
  if sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npx prisma migrate deploy --schema=../prisma/schema.prisma" > "$LOG" 2>&1; then
    ok=1
    tail -4 "$LOG"
    log "MIGRATIONS OK"
    break
  fi
  grep -oE 'FATAL:.*|Error:.*' "$LOG" | head -2
  sleep 20
done
[ "$ok" -eq 1 ] || { warn "all migrate attempts failed"; tail -8 "$LOG"; }

systemctl restart "$SERVICE"; sleep 5
curl -sf http://127.0.0.1:5000/api/health >/dev/null && log "API UP (local)" || true

log "Listeners (what the outside world can reach depends on OCI rules)"
ss -tlnp | grep -E ':(80|443|5000)\s' || warn "nothing listening on 80/443!"
log "caddy: $(systemctl is-active caddy) · api: $(systemctl is-active $SERVICE)"
