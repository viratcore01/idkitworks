#!/usr/bin/env bash
# Step 10: Oracle's default iptables REJECTs everything except SSH *before*
# the ufw chains run. Insert 80/443 ACCEPTs ahead of the REJECT, then persist.
set -euo pipefail
log() { echo -e "\033[1;36m==> $*\033[0m"; }

# Idempotent: only add if not already present
iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT 2>/dev/null || \
  iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT
iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT 2>/dev/null || \
  iptables -I INPUT 6 -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT

log "rules inserted:"
iptables -S INPUT | head -8

# Persist across reboots (Oracle images use netfilter-persistent)
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save >/dev/null && log "persisted via netfilter-persistent"
else
  mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4 && log "persisted to /etc/iptables/rules.v4"
fi
