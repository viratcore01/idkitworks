# LAUNCH RUNBOOK — Zoclo market launch (100k users)

> Read this fully before launch night. It contains one hard truth (capacity),
> the exact commands to cut over safely, and the go/no-go list.

## 0. The hard truth about "1,00,000 users"

100,000 **registered** users ≠ 100,000 **concurrent** users. Plan for reality:

| Load | What breaks first | Verdict |
|---|---|---|
| 100k registered, ~1–3k concurrent | Nothing (this config) | ✅ GO |
| ~5k concurrent sockets | 1 Node process (~2–5k sockets/GBs RAM) | ⚠️ Needs Render Standard (4 GB) |
| ~10k+ concurrent | Socket memory + single write DB | ❌ Needs Redis adapter + read replicas (post-launch project) |
| Supabase FREE (pool 15) at any real concurrency | `EMAXCONNSESSION` → deck/feed 500s (**measured**: 12/12 failures) | ❌ Upgrade or die |

**The architecture gives you a launch superpower: the app is per-college.**
Roll out **college by college** (open 2–3 colleges, watch, open more). A viral
stampede becomes a sequence of small, survivable waves — and verification
reviewers only ever see their own campus queue.

## 1. Hosting upgrades (do TONIGHT, before launch)

1. **Render API → paid (Starter minimum, Standard recommended).**
   Free sleeps (30–50 s cold wakes mid-session) and has 512 MB. Paid = no
   sleep. Apply `render.yaml` as a Blueprint, then set the env vars below in
   the dashboard. Keep **exactly 1 instance** until the Redis adapter exists
   (2 instances × pools = pooler death, and in-memory caches/events diverge).
2. **Supabase → Pro (or at minimum: pool discipline).** Free pool = 15 server
   sessions; the app alone wants 4–10. On free: set app `connection_limit=4`,
   scripts `=2`, never run two servers + the suite together. Pro (pool 200)
   removes the entire failure class we measured in §8 below.
3. **Vercel → Pro if bandwidth spikes.** Hobby throttles at scale. Also set
   `VITE_API_URL=https://<render-api>.onrender.com` in Vercel env and
   **redeploy the frontend** (Vite bakes it at build time).
4. **Supabase backups:** free has no point-in-time recovery. Before launch,
   take a manual backup (Dashboard → Database → Backups). After launch, Pro
   gives PITR.

## 2. Env checklist (Render dashboard + Vercel)

Render API (production): `NODE_ENV=production`, `PORT=5000`,
`DATABASE_URL` (pooler + `?connect_timeout=15`),
`DATABASE_CONNECTION_LIMIT=4` (pool math: instances × limit + scripts < 15
free-pool sessions — the code overwrites URL pool params, so this var owns
it), `DIRECT_URL` (direct, migrations only), `JWT_SECRET` + `JWT_REFRESH_SECRET`
(strong random ≥32 chars — boot REFUSES weak secrets in prod),
`CLIENT_URL=https://<vercel-app>.vercel.app`, `GOOGLE_CLIENT_ID`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PHOTOS_BUCKET=user-photos`,
`PHOTO_URL_TTL_SEC=3600`.
Vercel: `VITE_API_URL=https://<render-api>.onrender.com` (no `/api` suffix).

## 3. Database cutover (do once, in this order)

The repo moved from `db push` (banned on prod from here on) to migrations.
Prod tables exist via push, so baseline them, then deploy the delta:

```bash
cd server
# 0. Safety: preview drift between prod and the schema (should show ONLY data-neutral/no diff or the 7 indexes)
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ../prisma/schema.prisma --script
# 1. Mark the baseline as applied WITHOUT running it (tables already exist)
npx prisma migrate resolve --applied "0001_init" --schema ../prisma/schema.prisma
# 2. Apply the launch delta (7 IF-NOT-EXISTS hot-path indexes — safe to re-run)
npx prisma migrate deploy --schema ../prisma/schema.prisma
```

From here on, every deploy auto-runs `migrate deploy` via `npm start`.
New schema change workflow: edit schema → `migrate dev` locally →
commit the new `prisma/migrations/NNNN_*/` dir → push → Render applies it.

## 4. Launch-day operations

```bash
# Seed colleges + interests on a FRESH db only (idempotent upserts, safe to re-run)
cd server && npm run db:seed
# Promote the founder/moderation account (user must have signed up first)
npm run ops:bootstrap-admin -- founder@yourcollege.edu
# Verify: health (no-DB) + DB depth check
curl https://<api>/api/health        # expect status:ok (<5ms, never 429)
curl https://<api>/api/health/db     # expect database:reachable
# Run the adversarial suite (lean pools — see SCALING.md pool note)
$env:DATABASE_CONNECTION_LIMIT=2; npx tsx scripts/test-matching.ts https://<api>
```

**Rollout:** open 2–3 colleges → confirm OTP delivery works (test signup per
campus, codes arrive <1 min), deck latency p50 <500 ms, 5xx ≈ 0 → open the
next batch. Every launch college needs its student-mail domain set in
`/admin/colleges` before opening it (verification is the product's trust
wall — a missing domain IS a launch failure).

**Watch (first 48 h):** Render logs for `[prisma]` / `EMAXCONNSESSION`
(pool full → shed load: halve rollout, raise Supabase plan),
`[unhandledRejection]`, 5xx rate; Supabase dashboard → active sessions
(sustained >80% of pool = upgrade now); `/api/health/db` from an external
monitor (UptimeRobot, 5-min interval — NOT the deep check every minute).

## 5. Go / no-go (all must be ✅)

- [ ] Render paid, 1 instance, `render.yaml` applied, env set (incl. strong JWT secrets)
- [ ] Migration cutover done (§3), `migrate deploy` clean on next push
- [ ] Manual Supabase backup taken
- [ ] Founder `super_admin` bootstrapped + can reach `/admin`
- [ ] Launch colleges seeded + each has its student-mail domain set (OTP gate)
- [ ] `VITE_API_URL` set on Vercel + frontend redeployed
- [ ] Suite green against the PROD api (run §4 command; deck checks need a quiet pool)
- [ ] Support path tested: report a post → appears in admin queue → action works

## 6. Rollback

- **Bad frontend:** Vercel → Deployments → instant rollback (independent of API).
- **Bad backend:** Render → Deploys → rollback to previous commit. Migrations
  only ever ADD (indexes/columns, never drops) so old code keeps running.
- **Bad data/migration:** restore from the §1 backup, then re-run §3.

## 7. Known limits (post-launch roadmap, NOT launch blockers)

Single Node process (sockets + in-memory deck/feed caches) caps at a few
thousand concurrent connections — horizontal scale needs the Redis adapter
for Socket.IO + shared cache (callsites already isolated behind
`config/cache.ts` + `config/bus.ts`). No push notifications yet (polling
fallbacks cover).
