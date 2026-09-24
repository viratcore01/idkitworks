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
- Oracle images ship iptables rules on top of ufw; the script enables ufw,
  but if ports stay closed check `iptables -L INPUT -n` too.
