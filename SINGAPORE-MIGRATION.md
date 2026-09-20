# Render → Singapore Migration Runbook (zero data loss, near-zero downtime)

> **✅ COMPLETED 2026-09-20.** Production now runs at
> `https://idkitworks-1.onrender.com` (Singapore); the old Oregon service was
> retired after a verified cutover. Measured result: 1 DB round-trip went from
> ~1.5–2.9s to ~0.45–0.55s. Kept for reference / future region moves.

**Why:** every DB round-trip currently costs ~1.2–1.5s because the API sits in
Oregon and Supabase is in Mumbai. Singapore cuts that roughly in half (~0.6–0.8s)
on every cache miss, cold feed load, photo metadata check and login.

**The constraint that shapes this plan:** Render does not support changing the
region of an existing service
([docs](https://render.com/docs/regions): "Render doesn't currently support
changing the region for an existing service"). We therefore create a **new
service in Singapore in parallel**, verify it fully while the old one keeps
serving, then cut over and retire the old one. The database is never touched —
Supabase stays exactly as it is.

---

## What you need before starting (~5 min)

Copy the current production values from Render → `idkitworks` → **Environment**:

- `DATABASE_URL`, `DIRECT_URL`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`
- `CLIENT_URL` (may list several origins — copy the whole string)
- `GOOGLE_CLIENT_ID` (check the Google Cloud Console redirect URIs first — step 6)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PHOTOS_BUCKET`, `PHOTO_URL_TTL_SEC`
- Build command / start command / health-check path (screenshot the Settings page)

> Sanity-check `CLIENT_URL`: it must contain your real frontend origin(s)
> (e.g. `https://idkitworks.vercel.app`) and can also keep localhost origins.

---

## Phase 1 — Create & verify the Singapore twin (old one keeps serving)

1. Render Dashboard → **New → Web Service**
2. Connect the same GitHub repo `viratcore01/idkitworks`, branch `main`
3. **Instance type:** Free
4. **Region:** **Singapore**
5. **Build command:** same as the current service (e.g. `cd server && npm install && npm run build` — copy it verbatim)
6. **Start command:** same as current (`node server/dist/server.js` or your equivalent)
7. **Environment variables:** paste everything from "What you need" — values unchanged, **including the same Supabase pooler `DATABASE_URL`** (it is region-agnostic; only the API moves)
8. Create. The first deploy takes a few minutes; the instance will show the
   usual free-tier spin-up.

### Verify the twin BEFORE touching anything (all from your laptop)

The new service gets a URL like `https://idkitworks-xxxx.onrender.com`.

```bash
BASE=https://idkitworks-xxxx.onrender.com   # ← the NEW URL

curl -s $BASE/api/health | head -c 300
# → {"status":"ok","timestamp":...,"uptimeSec":...,"auth":{"google":true,...}}

curl -o /dev/null -s -w "health ttfb=%{time_starttransfer}s\n" $BASE/api/health
curl -o /dev/null -s -w "health/db ttfb=%{time_starttransfer}s\n" $BASE/api/health/db
```

**The win condition:** `health/db` TTFB should drop from ~1.5s to **~0.7–0.9s**
(Singapore↔Mumbai vs Oregon↔Mumbai). If it doesn't improve, STOP and
investigate — the old service is untouched and still serving users.

Then one authenticated probe (proves JWT + pool + Prisma end-to-end):
- In the app (served by the OLD url), open DevTools → copy your `accessToken`
  from localStorage, then:

```bash
curl -s -H "Authorization: Bearer <access-token>" $BASE/api/auth/me/completeness
```

- Expect `200` with your completeness JSON (not 401/403/500).

### Wake-keeper for the twin

Free services sleep after ~15 idle minutes. While you verify over a day or two,
add a temporary cron-job.org job (every 10 min) pointing at
`$BASE/api/health`, or manually ping it before each check.

---

## Phase 2 — Cutover (the only user-visible step)

Do this in a low-traffic window. Users may see ONE failed request at that
moment; the app's auto-refresh + retry recovers on the next action.

1. **Google Sign-In first** (or it breaks after cutover): Google Cloud Console →
   APIs & Services → **Credentials** → your OAuth Web Client →
   **Authorized JavaScript origins**: add the new `https://idkitworks-xxxx.onrender.com`? —
   **NO** — this is an API host, the browser never loads a page from it, so
   origins don't need it. Instead ensure the **frontend** origin
   (`https://idkitworks.vercel.app`) is already listed (it is — login works today).
   Skip this step if login already works; just re-test Google login on the
   new URL during verification.
2. **Update keep-alive pingers to the new URL** (5 seconds each):
   - cron-job.org job → change URL to `https://idkitworks-xxxx.onrender.com/api/health`
   - GitHub repo → Variables: create `RENDER_API_URL` =
     `https://idkitworks-xxxx.onrender.com` (this overrides the workflow's
     default via `${{ vars.RENDER_API_URL || env.DEFAULT_API_URL }}`)
3. **Update the client to point at the new API:**
   - Vercel → project → Settings → Environment Variables →
     `VITE_API_URL = https://idkitworks-xxxx.onrender.com` (Production + Preview)
   - **Redeploy the frontend** (Vercel → Deployments → ⋯ → Redeploy). env vars
     are baked at build time, so a redeploy is REQUIRED.
4. Also update `CLIENT_URL` on the NEW service if it must include any origin
   that isn't already in the copied list (usually nothing changes).
5. **Smoke-test the live app** (hard-refresh): login, feed, post, like,
   comment, chat, notifications, photos, deck swipe. Google login included.
6. **Old service:** don't delete yet — put it to sleep or leave it running as
   an instant rollback (see Phase 3) for 24–48h.

### Rollback (if anything looks wrong)

Vercel: set `VITE_API_URL` back to `https://idkitworks.onrender.com` →
Redeploy. The old service still runs and is warm (the old pinger path is
still in the workflow default). Back online in ~2 minutes.

---

## Phase 3 — Cleanup (after 24–48h of stable cutover)

1. **Supabase:** no changes (it never moved).
2. **Repo:** commit the URL change so config matches reality:
   - `.github/workflows/keep-alive.yml` → `DEFAULT_API_URL: https://idkitworks-xxxx.onrender.com`
   - `KEEP-ALIVE.md` → replace the old URL (5 places)
   - Then the `RENDER_API_URL` GitHub variable can be deleted (or kept as an override).
3. **Render:** delete the old Oregon service (or keep as paid backup — free
   tier has no cost either way, but idle services can confuse later debugging).
4. **Free-tier hour budget:** with two services running, both burn hours; after
   deleting the old one you're back to one.
5. Final verification: `uptimeSec` climbing on the NEW service, cron-job.org
   green on the new URL, `health/db` ≈ 0.7–0.9s.

---

## Effort & risk summary

- **Your active time:** ~30–40 min (twin setup 15 min, verification 10 min, cutover 10 min)
- **Calendar time:** verify the twin for a few hours/a day before cutover
- **Data risk: zero** — the database is never touched
- **Downtime: ~zero** — cutover is one env var + redeploy; rollback in ~2 min
- **Expected win:** every DB round-trip ~1.2–1.5s → **~0.6–0.8s**; feed cold
  load (4–6 sequential round-trips) from ~6–8s to ~3–4s; login/photo checks
  proportionally faster. Cache hits are already ~0 round-trips and unaffected.
