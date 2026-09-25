#!/usr/bin/env bash
# Step 8: DATABASE_CONNECTION_LIMIT=4 (Render parity), stop app → migrate → start.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
log() { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠  $*\033[0m"; }
ENV_FILE="$APP_DIR/server/.env"

# Render's blueprint sizes the pool at 4 (instances × limit must stay under
# the pooler's 15 sessions). Two hosts sharing one pooler: same number here.
grep -q '^DATABASE_CONNECTION_LIMIT=' "$ENV_FILE" || echo 'DATABASE_CONNECTION_LIMIT=4' >> "$ENV_FILE"
chown "$RUN_USER:$RUN_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
log "DATABASE_CONNECTION_LIMIT=4 set"

log "Stopping $SERVICE so migrate gets free pool sessions"
systemctl stop "$SERVICE"
sleep 2

LOG=/tmp/migrate.log
ok=0
for i in 1 2 3 4 5 6; do
  log "Migrate attempt $i/6"
  if sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npx prisma migrate deploy --schema=../prisma/schema.prisma" > "$LOG" 2>&1; then
    ok=1; tail -3 "$LOG"; log "MIGRATIONS OK"; break
  fi
  grep -oE 'FATAL:.*|Error:.*' "$LOG" | head -1
  sleep 25
done

log "Starting $SERVICE"
systemctl start "$SERVICE"
sleep 6
curl -sf http://127.0.0.1:5000/api/health >/dev/null && log "API UP" || journalctl -u "$SERVICE" -n 12 --no-pager | tail -6
journalctl -u "$SERVICE" -n 30 --no-pager | grep -E '\[db\]|Email transport' | tail -4
[ "$ok" -eq 1 ] || warn "migrations still blocked — if Render keeps holding the pooler, suspend it from the dashboard and re-run this script"
