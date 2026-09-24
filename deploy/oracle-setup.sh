#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Oracle Cloud (Always-Free) → production Zoclo API, one command.
#
# Run AS ROOT on a fresh Ubuntu 24.04 VM (ARM A1.Flex or x86 E2.1.Micro):
#
#   DOMAIN=api.example.com bash oracle-setup.sh
#
# DOMAIN is optional: with it, Caddy serves auto-HTTPS (Let's Encrypt) for
# that hostname (DNS must already point at this VM). Without it, plain HTTP
# on :80 (fine for first boot; add DOMAIN and re-run to upgrade).
#
# Idempotent — safe to re-run; each step skips if already done.
#
# First run flow: the script generates an SSH deploy keypair and asks you to
# add the public key to GitHub (repo → Settings → Deploy keys, read-only),
# then re-run — the clone will then succeed.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="git@github.com:viratcore01/idkitworks.git"
APP_DIR="/opt/zoclo/app"
SERVICE="zoclo-api"
RUN_USER="zoclo"
DOMAIN="${DOMAIN:-}"

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠  $*\033[0m"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }

# ── 1. Base packages ────────────────────────────────────────────────────────
log "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates ufw >/dev/null

# ── 2. Caddy (reverse proxy + auto-HTTPS) ──────────────────────────────────
if ! command -v caddy >/dev/null; then
  log "Installing Caddy"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
else
  log "Caddy already installed"
fi

# ── 3. Node.js 22 LTS (arm64 + x64) ─────────────────────────────────────────
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
else
  log "Node $(node -v) already OK"
fi

# ── 4. Swap (the E2.1.Micro has 1 GB RAM; builds OOM without it) ────────────
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -lt 2000 ] && ! swapon --show=NAME --noheadings | grep -q .; then
  log "Adding 2G swap (${MEM_MB}MB RAM detected)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  log "Swap OK (${MEM_MB}MB RAM)"
fi

# ── 5. Firewall (VM-level; the OCI security list must ALSO allow these!) ────
log "Firewall: 22/80/443 in"
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
yes | ufw enable >/dev/null 2>&1 || true
warn "Remember the OCI side too: VCN subnet security list must allow TCP 22/80/443 ingress."

# ── 6. App user ─────────────────────────────────────────────────────────────
id -u "$RUN_USER" >/dev/null 2>&1 || useradd -r -m -d /opt/zoclo -s /usr/sbin/nologin "$RUN_USER"
mkdir -p "$APP_DIR" && chown -R "$RUN_USER:$RUN_USER" /opt/zoclo

# ── 7. GitHub deploy key ────────────────────────────────────────────────────
if [ ! -f /root/.ssh/id_ed25519 ]; then
  log "Generating GitHub deploy key"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519 -C "zoclo-$(hostname)" >/dev/null
fi
PUB_KEY="$(cat /root/.ssh/id_ed25519.pub)"
if ! ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -T git@github.com 2>&1 | grep -q 'successfully authenticated'; then
  echo
  echo "─────────────────────────────────────────────────────────────────"
  echo "Add this deploy key to GitHub → repo → Settings → Deploy keys:"
  echo
  echo "  $PUB_KEY"
  echo
  echo "(read-only access is enough). Then RE-RUN this script."
  echo "─────────────────────────────────────────────────────────────────"
  exit 2
fi
log "GitHub auth OK"

# ── 8. Clone / pull (as root: the deploy key lives in /root/.ssh; the app
#    user only needs read access, enforced by the chown below) ──────────────
export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"
if [ -d "$APP_DIR/.git" ]; then
  log "Repo exists — pulling latest"
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" reset --hard origin/main
else
  log "Cloning $REPO_URL"
  rm -rf "$APP_DIR"
  git clone -q "$REPO_URL" "$APP_DIR"
fi
chown -R "$RUN_USER:$RUN_USER" /opt/zoclo

# ── 9. Build server ─────────────────────────────────────────────────────────
log "Installing server deps + building"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npm ci --include=dev >/dev/null 2>&1 && npm run build >/dev/null 2>&1"
log "Build done"

# ── 10. .env (create template once; NEVER overwrite an existing one) ────────
ENV_FILE="$APP_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Creating $ENV_FILE template — FILL IN THE VALUES, then re-run"
  cat > "$ENV_FILE" <<'EOF'
NODE_ENV=production
PORT=5000
CLIENT_URL=https://idkitworks.vercel.app
# ── required ──
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
# ── mail (Gmail API over HTTPS — mint with ops:gmail-auth) ──
GMAIL_USER=
GMAIL_OAUTH_CLIENT_ID=
GMAIL_OAUTH_CLIENT_SECRET=
GMAIL_OAUTH_REFRESH_TOKEN=
# ── existing integrations ──
GOOGLE_CLIENT_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_PHOTOS_BUCKET=user-photos
PHOTO_URL_TTL_SEC=300
EOF
  chown "$RUN_USER:$RUN_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
  warn "Fill $ENV_FILE with real values (copy from the Render dashboard env), then re-run."
fi

# ── 11. Caddyfile ────────────────────────────────────────────────────────────
log "Writing Caddyfile (${DOMAIN:-HTTP :80})"
if [ -n "$DOMAIN" ]; then
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:5000
}
EOF
else
  printf ':80\n  reverse_proxy 127.0.0.1:5000\n' > /etc/caddy/Caddyfile
fi
systemctl enable --now caddy >/dev/null 2>&1 || systemctl restart caddy

# ── 12. systemd service ─────────────────────────────────────────────────────
log "Installing systemd service '$SERVICE'"
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
# .env is loaded by dotenv inside the app
ExecStart=$(command -v node) dist/server.js
Restart=always
RestartSec=5
# ARM micro box: keep the heap modest
Environment=NODE_OPTIONS=--max-old-space-size=768

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

# ── 13. Migrate + start + verify ─────────────────────────────────────────────
if sudo -u "$RUN_USER" bash -c "cd '$APP_DIR/server' && npx prisma migrate deploy --schema=../prisma/schema.prisma" 2>/dev/null; then
  log "Migrations applied"
else
  warn "Migrate failed — is DATABASE_URL set in $ENV_FILE? Service will still start; fix and re-run."
fi
systemctl restart "$SERVICE"
sleep 4
if curl -sf http://127.0.0.1:5000/api/health >/dev/null; then
  log "✅ API healthy on 127.0.0.1:5000"
  [ -n "$DOMAIN" ] && log "→ https://$DOMAIN (cert may take ~30s to issue)" || log "→ http://$(curl -s ifconfig.me) (HTTP; add DOMAIN and re-run for HTTPS)"
  systemctl --no-pager status "$SERVICE" | head -5
else
  warn "API not answering yet — check: journalctl -u $SERVICE -n 50"
fi
