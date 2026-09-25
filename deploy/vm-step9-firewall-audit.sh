#!/usr/bin/env bash
# Step 9: find why 80/443 are still unreachable from outside.
echo "== iptables INPUT (filter) =="
iptables -L INPUT -n --line-numbers 2>&1 | head -20
echo
echo "== iptables INPUT (nat not shown; mangle skip) =="
iptables -S INPUT 2>&1 | head -20
echo
echo "== ufw =="
ufw status verbose 2>&1 | head -15
echo
echo "== caddy still active? =="
systemctl is-active caddy && ss -tlnp | grep -E ':(80|443)\s' | head -4
