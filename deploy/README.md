# Zoclo — Self-Hosted VM Deploy Bundle

Infra config for the Oracle Always-Free VM (Cloudflare → Nginx → Node/PM2 →
Postgres/Redis via Docker). **All code-level migration changes live in the
repo** (`config/storage.ts`, `server.ts`, `config/prisma.ts`); this directory is
server configuration only.

```
deploy/
├── nginx/zoclo.conf          # site config: XFF overwrite, websocket timeouts
├── pm2/ecosystem.config.cjs  # PM2 — FORK mode (cluster would break realtime)
├── sql/row-count-verify.sql  # old-vs-new row count verification
├── migrate-1-dump.sh         # dump from Supabase
├── migrate-2-restore.sh      # restore into VM Postgres
├── migrate-3-photos-r2.sh    # rclone Supabase Storage → R2 (keys preserved)
└── RUNBOOK.md                # staging validation + cutover, with stop points
```

## Install order on a fresh VM

1. Docker + Compose, then run Postgres 17 + Redis 7 containers (compose file is
   infra-owned; healthchecks: `pg_isready` / `redis-cli ping`). **Postgres ≥17,
   not 16** — Supabase runs 17.6 (verified at dump time), so dump/restore tooling
   must match.
2. `sudo cp nginx/zoclo.conf /etc/nginx/sites-available/zoclo.conf && sudo ln -s
   /etc/nginx/sites-available/zoclo.conf /etc/nginx/sites-enabled/ && sudo nginx -t
   && sudo systemctl reload nginx`
3. `pm2 start deploy/pm2/ecosystem.config.cjs && pm2 save`
4. Run `migrate-1-dump.sh` (from anywhere with `psql`/`pg_dump` + Supabase
   direct URL), `migrate-2-restore.sh` (on the VM), verify with
   `sql/row-count-verify.sql` against BOTH databases.
5. `migrate-3-photos-r2.sh` (needs `rclone` with `supabase-remote` and
   `r2-remote` remotes configured — see script header).
6. Follow `RUNBOOK.md` for staging validation and cutover.

## Non-negotiables encoded in these files

- **PM2 stays in fork mode.** The event bus, TTL caches, and Socket.IO rooms
  are in-process. Cluster mode silently splits realtime traffic across
  workers — messages emitted in one worker never reach sockets on another.
  Scale-out only after wiring `@socket.io/redis-adapter` + a shared cache.
- **Nginx OVERWRITES X-Forwarded-For** (`proxy_set_header X-Forwarded-For $cf_ip;`)
  and the express-rate-limit keyGenerator reads `cf-connecting-ip`. Together
  that makes per-IP rate limits real per-user again — and closes the
  header-spoofing hole (direct-to-origin traffic must be firewalled to
  Cloudflare IP ranges; see conf header).
- **Websocket proxies get 3600s read/send timeouts** or idle chat connections
  drop and reconnect-storm.
- **DB migration is dump → restore → verify counts → THEN flip DATABASE_URL.**
  Never point the app at an empty database.

## R2 cost guard ($0 enforcement) — cron on the VM

The upload kill switch lives in `app_settings.r2_cost_guard` (JSON doc) and is
enforced in `photo.controller.uploadPhoto` (503 while paused; feed/chat/matching
keep working). Driver: `server/scripts/check-r2-usage.ts`.

```cron
# every 15 min — month-to-date R2 usage vs free caps (80% → pause uploads)
*/15 * * * * cd <repo>/server && npx tsx scripts/check-r2-usage.ts >> /var/log/zoclo-r2-guard.log 2>&1
```

- **Second Cloudflare token required:** `CF_API_TOKEN_ANALYTICS` with
  Account Analytics:Read ("Read all resources") — the bucket-scoped object
  token used by STORAGE_DRIVER=r2 cannot read analytics (verified live:
  `not authorized for that account`). Both `r2StorageAdaptiveGroups`
  (gauge → `max`) and `r2OperationsAdaptiveGroups` need it.
- Thresholds: `R2_USAGE_PAUSE_STORAGE / _CLASS_A / _CLASS_B` (fractions of
  10 GB / 1M / 10M; default 0.8). Auto-resumes when usage drops back under
  cap. Conscious override = raise the env threshold (a manual row edit is
  reverted by the next cron run).
- Visibility: `GET /api/admin/cost-guard` (admin JWT). Telegram alerts via
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
- Do NOT add a bucket-wide lifecycle rule to `zoclo-media`: its only objects
  are permanent profile photos (`<userId>/<photoId>` keys). Expiry rules
  belong on future ephemeral prefixes only. Edge-caching the signed-URL read
  path needs a query-aware design — revisit only if Class B nears 80%.
