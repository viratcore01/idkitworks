# Oracle Cloud Always-Free deployment

Why: Render free/starter blocks outbound SMTP (fixed via Gmail API anyway) and
sleeps; the OCI Always-Free VM (ARM A1.Flex 2/12 or E2.1.Micro) is always-on
and free. Client stays on Vercel, DB/photos stay on Supabase — only the API
moves.

## 1. Create the VM (OCI console, ~10 min)

1. Networking → VCN wizard → "VCN with Internet Connectivity" (defaults OK)
2. Compute → Create instance:
   - Shape: `VM.Standard.A1.Flex`, 2 OCPU / 12 GB (first choice; if
     "out of capacity" retry or switch availability domain; fallback
     `VM.Standard.E2.1.Micro` — the script adds swap for its 1 GB RAM)
   - Image: Ubuntu 24.04
   - SSH keys: let Oracle generate → **download the private key**
3. Subnet → Security list → ingress rules: TCP 22, 80, 443 (source 0.0.0.0/0)

## 2. One command on the VM

```bash
ssh -i <private-key> ubuntu@<PUBLIC_IP>
sudo bash # then paste/upload deploy/oracle-setup.sh
DOMAIN=api.yourdomain.com bash oracle-setup.sh   # DOMAIN optional
```

First run stops at the deploy-key step → add the printed key at
GitHub → repo → Settings → Deploy keys → re-run. Then it fills
`/opt/zoclo/app/server/.env` (template is written for you — copy the values
from the Render dashboard: `DATABASE_URL`, JWT secrets, Gmail OAuth trio,
`GOOGLE_CLIENT_ID`, `SUPABASE_*`) → re-run → done. Service is
`systemctl status zoclo-api`, logs via `journalctl -u zoclo-api -f`.

## 3. Point the client at it

Vercel → client project → env `VITE_API_URL=https://<your-domain-or-ip>`
(sslip.io works without owning a domain: `<IP>.sslip.io` gets a real
Let's Encrypt cert via Caddy — set `DOMAIN=<IP>.sslip.io`) → redeploy.

## 4. Decommission Render

Verify the OTP flow on the deployed site, then Suspend (don't delete) the
Render service for a week as a fallback.

## Notes

- Idempotent: re-running after `git push` is the deploy step
  (`sudo bash oracle-setup.sh` pulls + rebuilds + restarts).
- OCI reclaims Always-Free VMs idle (≈0% CPU/RAM) for 7 days — irrelevant
  once real users hit it.

## Gotchas that actually bit us (2026-09-24 migration)

Each of these produced a confusing failure elsewhere; all are handled by the
bootstrap steps in `deploy/vm-step*.sh` (kept for reference) and must be
re-applied if the VM is ever rebuilt:

1. **Oracle's iptables REJECTs everything except SSH before ufw runs.**
   ufw showed 80/443 as ALLOW while the outside world got `000`. Fix: insert
   ACCEPT rules for 80/443 *before* the REJECT line and persist via
   `iptables-save > /etc/iptables/rules.v4` (see vm-step10). Symptom to
   remember: `curl http://<ip>` → 000 from outside, but everything listens
   correctly inside.
2. **Supabase pooler allows 15 sessions total.** Render (10) + the new VM's
   app (10) starve `prisma migrate deploy` (`EMAXCONNSESSION`). Fix:
   `DATABASE_CONNECTION_LIMIT=4` on the VM **and** `systemctl stop zoclo-api`
   while migrating (vm-step8). Same math as the Render blueprint comment.
3. **Prisma CLI requires a nonempty `DIRECT_URL`** (schema.prisma declares
   `directUrl = env("DIRECT_URL")`). Local dev had it empty; set it equal to
   `DATABASE_URL` — exactly what Render's start command did. Never rewrite
   these lines with `sed` — URLs contain `&`, which sed eats (vm-step5 bug).
4. **`CLIENT_URL` must be the Vercel origin** (`https://idkitworks.vercel.app`),
   not localhost — it seeds the CORS allowlist. Copying a local `.env` to the
   VM silently breaks every browser request until this is fixed (vm-step11).
5. **sslip.io + Let's Encrypt** works, but the cert is only issued once 80
   *and* 443 are reachable from the internet (HTTP-01 and TLS-ALPN-01 both
   fail behind a closed firewall — Caddy retries every 10 min, or
   `systemctl restart caddy` to retry immediately).

Current production: `https://129.154.239.74.sslip.io` (Caddy TLS →
127.0.0.1:5000, systemd `zoclo-api`, Gmail API transport). Render remains
suspended as rollback: removing `VITE_API_URL` in Vercel + redeploy switches
the client back instantly.
