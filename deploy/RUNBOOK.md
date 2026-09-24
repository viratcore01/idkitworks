# Staging Validation & Cutover Runbook

Executes STEPS 4–5 of the migration. Steps 1–3 (dump/restore, photo sync,
code changes) are covered by `deploy/migrate-*.sh` + the repo changes.

**Hard rule:** nothing in this file touches production DNS until every staging
checkbox is green. The final cutover action requires explicit human approval.

---

## STATUS — Steps 1–2 executed & verified (2026-09-23, from the dev machine)

**Data (Step 1) — DONE, verified**
- Dump taken via the session pooler (`aws-0-ap-south-1.pooler.supabase.com:5432`)
  — the direct host `db.cubylvbq…` is IPv6-only and unreachable from IPv4
  networks. The repo's `DIRECT_URL` was ALREADY the pooler host, so no extra
  credentials were needed. Dump: `zoclo.dump` (100 KB, custom format).
- Restored into a scratch **vanilla PostgreSQL 17.6** with
  `--clean --if-exists --no-owner --no-privileges` → **zero errors**.
- Row parity EXACT on every non-empty table: users 15, posts 21, comments 11,
  messages 8, colleges 458, user_photos 17, refresh_tokens 49, notifications 12,
  moderation_logs 26, interests 31, user_interests 28, id_verifications 11,
  post_likes 14, match_likes 7, match_preferences 5, conversation_members 2,
  "Conversation" 6; `_prisma_migrations` 3 → migrate-on-boot = no-op.
- Public schema has **no** pgcrypto/uuid-ossp dependencies, no triggers, no RLS
  policies, no `auth.*` references → vanilla Postgres restore is clean.
- Supabase's Postgres is **17.6** — run **Postgres ≥17 on the VM** (not 16) so
  tooling versions match. Baseline: `.freebuff/tools/source-row-counts.txt`.

**Photos (Step 2) — DONE, verified**
- Inventory: 17 objects / ~690 KB, keys exactly `<userId>/<photoId>`, 1:1 with
  `user_photos.storage_path` (no orphans in either direction).
- All 17 copied to R2 `zoclo-media` **preserving keys**, then verified
  **byte-for-byte AND via presigned-URL GET** (the app's production read path):
  17/17 OK. Script: `.freebuff/tools/migrate-photos.js`.
- Tiny-file mystery resolved: the 70–760 B objects are real images (1×1
  placeholder PNGs, small JPEGs) — not corruption.
- No DB row updates needed (keys preserved). `id_verifications` stores data in
  Postgres, not Storage — nothing else to move.

**Still open (VM-side / human)**
- Phase A staging deploy on the VM (compose, PM2, Nginx, env) — as written below
- Google OAuth redirect URIs (staging + prod domains); prod `CLIENT_URL` /
  `VITE_API_URL` values (domain decision)
- **Rotate credentials** before the rollback window closes: the Supabase DB
  password and the R2 token were shared in chat during handoff on 2026-09-23.

---

## PHASE A — Staging deploy (staging subdomain, e.g. `stg.zoclo.example`)

VM state for staging:
- Postgres restored from the production dump (step 2 script) — staging tests
  against REAL data shapes, not seeds
- PM2 app running with `.env`: `STORAGE_DRIVER=r2`, `R2_*` set,
  `DATABASE_URL` → local VM Postgres, `DATABASE_PGBOUNCER=0`,
  `DATABASE_HEARTBEAT_SEC=0`, `CLIENT_URL=https://stg.<domain>,http://localhost:5173`
- Boot log must show: `[storage] driver=r2` and
  `[db] pool limit=10 ... heartbeat=0s`

### A1. Automated suite against staging (not localhost)
```bash
cd server && npx tsx scripts/test-matching.ts https://stg.<domain>
# Exit 0 + "ALL 77 CHECKS PASSED" (or the suite's current count) is required.
```
The script accepts a BASE URL as argv[1] (verified in source) — this is the
same adversarial suite that gates the app today, now exercising the VM's
Postgres, storage adapter, and proxy chain end-to-end.

### A2. Manual flows (two browser sessions side-by-side)
- [ ] Email login → access token works → refresh flow rotates (refresh_tokens
      table gets a new row; old one invalidated)
- [ ] Google Sign-In (only after redirect URIs are added in Google Cloud
      Console — `https://stg.<domain>` AND the prod domain)
- [ ] Photo upload (avatar + gallery slots) → renders from R2 signed URL
- [ ] Photo **signed-URL expiry**: grab a signed URL from the network tab,
      confirm it works now, then confirm it EXPIRES (set
      `PHOTO_URL_TTL_SEC=5` on a scratch instance for a fast test; restore
      3600 after). The failure mode this catches is silent breakage ~1h later.
- [ ] Chat round-trip: user A sends → user B receives via socket (<1s, no
      refresh), edit window works, unsend works
- [ ] Rate limits from two simulated IPs (different `cf-connecting-ip`
      values via curl): exhausting one does NOT throttle the other:
      ```bash
      curl -s -o /dev/null -w '%{http_code}\n' -H 'cf-connecting-ip: 1.2.3.4' https://stg.<domain>/api/health
      # (use a rate-limited route like /api/auth/login failures to trip it,
      #  then confirm a different cf-connecting-ip is unaffected)
      ```
- [ ] Cross-college wall still 404s (college-scoping is DB-level; the dump
      brought real colleges — verify a cross-college post URL still 404s)

### A3. Watchdog + spend-guard alerts (Uptime Kuma + Layer-1 dashboard)
- [ ] Kuma **HTTP monitor** on `https://api.<domain>/api/health/db`, every 5 min,
      JSON query `costGuard.stale` must equal `false` — catches a dead/denied
      R2 usage-checker within ~15 min (cron runs every 15 min; doc marks stale
      after 45). Also alert if `costGuard.lastError` is non-null.
- [ ] Kuma notification channel → Telegram (same bot: @BotFather token +
      chat_id from `getUpdates`), so alerts don't depend on email.
- [ ] Cloudflare → Billing → Billable Usage → budget alert at **$0.50**
      (default $10 is too loose for a must-stay-$0 goal).
- [ ] Cloudflare → Notifications → R2 usage notifications at **8 GB storage /
      800k Class A / 8M Class B** (80% of free caps — same thresholds the
      in-app kill switch enforces).
- [ ] `CF_API_TOKEN_ANALYTICS` set (second, read-only token — the bucket token
      cannot read analytics) and `*/15` cron line installed (see deploy/README).

## PHASE B — Pre-cutover checklist (all must be checked)

- [ ] Staging suite green (A1) and every A2 checkbox ticked
- [ ] Prod VM Postgres re-synced if staging found data drift: re-run dump
      (step 1) + restore (step 2) during a low-traffic window, re-verify counts
- [ ] Photos synced to R2 (`migrate-3`), checksum clean, staging verified
- [ ] Google Cloud Console: prod domain redirect URI added
- [ ] `CLIENT_URL` in prod VM env = real prod frontend domain(s)
- [ ] Vercel/CF Pages frontend env `VITE_API_URL` = new API domain (build-time!)
- [ ] **Pinger retarget plan ready** (this is the silent killer — see C4)
- [ ] DNS TTL lowered to 300s at least 24h before cutover
- [ ] Old Supabase project NOT touched (7-day rollback source)
- [ ] Backup of the target DB taken right before cutover (pgbackrest manual
      full, or at minimum `pg_dump` snapshot of the restored DB)

## PHASE C — Cutover (requires explicit human go-ahead — STOP HERE AND ASK)

### C1. Final data sync + verify counts (dump→restore again if any writes
happened after staging restore; diff `deploy/sql/row-count-verify.sql` outputs)

### C2. DNS cut (Cloudflare)
- Frontend: CF Pages custom domain → `app.<domain>`
- API: A/CNAME `api.<domain>` → VM (proxied 🟠 through Cloudflare)
- Realtime check after propagation: browser devtools → WS connection to
  `wss://api.<domain>/socket.io` → 101 Switching Protocols (not 200 polling)

### C3. Old Render API: leave running but idle (7-day rollback alongside
Supabase). Do not delete services yet.

### C4. **RETARGET ALL PINGERS** — every one of these currently points at the
old Render URL and will report "healthy" against a dead service otherwise:
- [ ] cron-job.org job(s) → `https://api.<domain>/api/health`
- [ ] `.github/workflows/keep-alive.yml` → update the ping URL (repo change;
      commit before cutover)
- [ ] New Uptime Kuma monitors → new domain (HTTP monitor + push monitor for
      the dead-man's switch)
- [ ] Vercel env `VITE_API_URL` already rebuilt/deployed (checked in B)

### C5. Post-cutover monitoring (first 24h)
- PM2 logs: `[db] pool` line sane, no `[db] pool warm-up failed`
- `pg_stat_user_tables`: autovacuum touching posts/comments/messages
- Error rate + latency in Kuma; CF analytics for 5xx spikes
- One full manual pass of the A2 flows on PROD

### C6. T+7 days: archive Supabase + delete Render service (rollback window
closes; pgbackrest+WAL now the recovery story)

## ROLLBACK (any point before C6)
1. Point DNS back (TTL 300 → ~5 min) — old Render + Supabase still frozen-alive
2. Any users who signed up post-cutover exist ONLY on the VM DB — accept
   (announce) or dump/restore those rows forward after fixing
3. Frontend `VITE_API_URL` flip + redeploy (build-time var)
