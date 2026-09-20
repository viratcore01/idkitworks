# Keep-Alive Operations Guide

The API runs on a **Render free Web Service**, which sleeps after ~15 minutes
without inbound traffic. Waking it takes 20–50 s — measured **22.5 s** on
2026-09-20. The two independent, free pingers below make that impossible: if
one stops working, the other keeps the instance warm.

Both ping **`/api/health`** — the endpoint that is deliberately **database-free**
(no Prisma, no pool connections, <5 ms of work). Never point a pinger at
`/api/health/db`; it burns a Supabase pool connection on every hit.

- API base: `https://idkitworks.onrender.com`
- Ping target: `https://idkitworks.onrender.com/api/health`
- Interval: every **10 minutes** (comfortably under the ~15 min idle cutoff)

---

## 1) cron-job.org — PRIMARY (external, always on)

GitHub's scheduler can lag or silently skip runs; an external cron cannot.

1. Sign up free at **https://cron-job.org** (no card).
2. Dashboard → **Cronjobs → Create cronjob**:
   - **Title:** `skola-render-keep-alive`
   - **URL:** `https://idkitworks.onrender.com/api/health`
   - **Method:** GET
   - **Schedule:** Every 10 minutes
     (Exact steps: *Schedule* tab → select **"Every 10 minutes"** under the
     minute presets, or paste `*/10 * * * *` if using the advanced view.)
   - **Advanced → "Treat redirect as failure"**: leave OFF (we send none).
   - **Notifications:** enable "Failure" emails — you want to know if pings die.
3. **Save**, then flip the toggle **ON** on the cronjob row.
4. Confirm it works: the row's **"Last execution"** goes green within ≤10 min,
   and Cronjob → **Execution History** shows HTTP `200` with a small body.

## 2) GitHub Actions — BACKUP (already in repo, needs one manual kick)

`.github/workflows/keep-alive.yml` pings the same endpoint every 10 minutes.
It is configured to need **no secrets** (URL is defaulted in the file). It has
never run because this repo's scheduled workflows haven't initialized — one
manual run starts the scheduler:

1. Open **https://github.com/viratcore01/idkitworks/actions**
2. Left sidebar → click the **keep-alive** workflow.
3. Right side: **Run workflow ▾** → keep `main` → **Run workflow**.
   (Button only appears for workflows that declare `workflow_dispatch`, which
   this one does. You need push/admin rights on the repo.)
4. Wait ~15 s, refresh — a queued/in-progress run should appear, then go green.
5. From then on, runs appear ~every 10 minutes. The **Actions tab showing
   green runs in the last hour** is your proof the backup pinger is alive.

If scheduled runs don't keep appearing after the manual kick, the primary
(cron-job.org) still covers the instance — that's why there are two.

## Why two pingers are safe

`/api/health` is a pure JSON handler: no Prisma, no Supabase, no rate-limit
bucket pressure (144 pings/day each, well under the 600/min global brake).
Two pingers = ~288 tiny requests/day, zero DB load.

---

## Verify the server is no longer sleeping

**A. Uptime check (the direct one):**

```bash
curl -o /dev/null -s -w "status=%{http_code} ttfb=%{time_starttransfer}s\n" \
  https://idkitworks.onrender.com/api/health
```

- Awake + warm: **ttfb under ~1.5 s** (typical 0.3–0.9 s from India).
- Cold start: **ttfb 20–50 s**. If you see that, no pinger is running.

**B. `uptimeSec` check (tells you WHEN it last restarted):**

```bash
curl -s https://idkitworks.onrender.com/health | head -c 300   # if proxied
curl -s https://idkitworks.onrender.com/api/health | head -c 300
```

`uptimeSec` counts seconds since boot. **After the pingers run for an hour,
uptimeSec should exceed 3600 and keep growing** — a value that resets to a few
minutes means something restarted or the instance slept (free instances
don't "sleep-restart", so a reset = deploy or crash).

**C. Render dashboard:** Metrics → Requests shows the periodic ~10-min pings
arriving; Logs show them answered in milliseconds.

**D. Real-user signal:** the app stops needing 20–50 s on the first tap of the
day; first paint after long idle is as fast as mid-session.
