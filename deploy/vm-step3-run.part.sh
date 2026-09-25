# Step 3 remainder: run the service (executed as root on the VM).
# Expects $ENV_FILE already written by the assembler.
set -euo pipefail
APP_DIR=/opt/zoclo/app
RUN_USER=zoclo
SERVICE=zoclo-api
DOMAIN=129.154.239.74.sslip.io

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

# Production flags on top of the copied local env
grep -q '^NODE_ENV=' "$ENV_FILE" || echo 'NODE_ENV=production' >> "$ENV_FILE"
grep -q '^PORT=' "$ENV_FILE" || echo 'PORT=5000' >> "$ENV_FILE"
chown "$RUN_USER:$RUN_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"

log "Prisma migrate deploy"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && export DIRECT_URL=\${DIRECT_URL:-\$DATABASE_URL} && npx prisma migrate deploy --schema=../prisma/schema.prisma 2>&1 | tail -3"

log "systemd service $SERVICE"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Zoclo API (Node + Socket.IO)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR/server
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=700
ExecStart=$(command -v node) dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

log "Caddyfile for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:5000
}
EOF
systemctl restart caddy

sleep 5
log "Local health check"
if curl -sf http://127.0.0.1:5000/api/health; then echo; log "API UP"; else echo; echo "journalctl:"; journalctl -u "$SERVICE" -n 30 --no-pager | tail -15; fi

rm -f /tmp/vm-step3.sh /tmp/zoclo.bundle
log "cleanup done (secrets removed from /tmp)"
