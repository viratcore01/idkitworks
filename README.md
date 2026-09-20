<div align="center">

<img src="public/zoclo-logo.png" alt="Zoclo" width="140"/>

# Zoclo

**Your campus. Your people. One app.**

Community feed · Campus dating · Real-time chat — exclusively for verified students of the same college.

[![Live](https://img.shields.io/badge/▶_Live-idkitworks.vercel.app-9AE600?style=for-the-badge&labelColor=111)](https://idkitworks.vercel.app)
[![Stack](https://img.shields.io/badge/React_·_Node_·_Postgres-111?style=for-the-badge)](#tech-stack)
[![Uptime](https://img.shields.io/badge/Warm_24%2F7-dual_pinger-FF6B35?style=for-the-badge&labelColor=111)](#performance-engineering)
[![Hosting](https://img.shields.io/badge/Infra-%E2%82%B90%2Fmonth-success?style=for-the-badge&labelColor=111)](#deployment)

</div>

---

## What is Zoclo?

Zoclo is a **college-only social super-app**: a Reddit-style community feed, a Tinder-style dating deck, and real-time chat — fused into one fast, neobrutalist experience.

Three products students already use, rebuilt for one hyperlocal context:

| | |
|:---:|:---:|
| **Community** — a campus feed with posts, threaded comments, anonymous confessions and polls | **Dating** — a swipe deck of people on your campus, with preferences, mutual matching and a proper "it's a match" moment |
| **Chat** — real-time messaging with edit windows, unsend and unread counts | **People** — searchable, verified, college-scoped profiles with relationship-aware actions |

**Every account is verified.** Students sign up, pick their college, and upload their student ID — a campus moderator approves it before they can see a single post. No bots, no strangers, no one from outside your campus. Ever.

## The one rule: college-only

Everything a student sees — feed, people, chats, notifications — belongs to their college. This isn't a UI filter; it's enforced **at the database query level**, on every request:

- A post from another college **404s** — its existence isn't even confirmable
- Cross-college likes, comments, swipes and DMs are rejected server-side
- Moderators are scoped to their campus; the founder sees all
- College is resolved from the **live database on every request**, never from the JWT — scope changes apply instantly and can't be spoofed

> The result: Zoclo feels like *your* campus, not another global feed. That's the product.

---

## Screenshots

Drop PNGs with these names into a `screenshots/` folder and they render here.

| Page | File |
|---|---|
| Login — neobrutalist two-tone auth | `screenshots/login.png` |
| Feed — college posts with comment previews | `screenshots/feed.png` |
| Discover — the campus swipe deck | `screenshots/discover.png` |
| Chat — real-time threads | `screenshots/chat.png` |
| Profile — stats, interests, strength meter | `screenshots/profile.png` |

---

## Feature highlights

### 📝 Community feed
- Post types: normal, confessions (fully anonymous — the real author never crosses the wire), polls, questions
- Reddit-style threaded comments, tombstone deletes, edit-anytime with an "Edited" tag
- Top-3 comment previews on every card, cursor pagination, optimistic likes
- Anonymous posts stay on your profile behind an owner-only archive — even you see them masked

### ❤️ Campus dating
- Swipe deck scoped to your college — preferences can never widen the pool
- Gender + age-range filters, "looking for" intent matching, shared-interest dealbreakers
- **Atomic mutual matching** in a single transaction — races and double-swipes can't create duplicates
- Like cap (100/12h), 10-minute rewind on passes, unmatch with preserved history for safety reports
- Age computed server-side; exact birthdates never leave the API

### 💬 Real-time chat
- Matches only — no messaging strangers
- Socket.IO push with REST fallback, 15-minute edit window (WhatsApp-style), unsend for everyone
- Day separators, unread counts, block-aware at every step

### 🛡️ Safety & moderation
- Student-ID verification gate before full access
- Report posts, comments, users and messages
- College-scoped moderation console: verification queue, reports, bans, takedowns, campus-wide announcements
- Bidirectional blocking — blocks are a hard wall across feed, decks, search and chat

---

## Performance engineering

Zoclo is tuned against **measured production numbers**, not vibes:

| Optimization | Effect |
|---|---|
| **In-process TTL caches** (feed page 1, swipe deck, unread counts) | Hot reads serve with **zero** DB round-trips; tag-based invalidation keeps data fresh on every write |
| **Single-query aggregation** — block lists folded into counts, parallel query waves | Multi-query hot paths cut to one round-trip |
| **Region placement** — API in Singapore, measured against alternatives | DB round-trip **~0.45s vs 1.5–2.9s** before (≈3×); full rationale in [SINGAPORE-MIGRATION.md](SINGAPORE-MIGRATION.md) |
| **Supabase Storage for photos** — signed URLs, metadata-only checks, immutable caching | Bytes never touch the API; repeat views cost nothing |
| **DB-level pagination** — keyset cursors, bounded id-lists, skip/take everywhere | The full table is never loaded into memory |
| **Dual keep-alive pingers** (cron-job.org + GitHub Actions, [runbook](KEEP-ALIVE.md)) | The free-tier instance **never sleeps** — no 20–50s cold starts |
| **Hardened connection pool** — pgbouncer-safe params, single source of truth | No duplicate pool settings, no Supavisor prepared-statement crashes |

**Auth is cached, not trusted:** a 30s per-user auth cache eliminates a round-trip from *every* request, while bans, verification and college changes invalidate it instantly.

## Security

- JWT access tokens (15 min) + **rotating refresh tokens** stored server-side — logout and compromise invalidate instantly, and simultaneous tabs can't invalidate each other
- **helmet** headers, CORS locked to the client origin, 100 kb body cap
- Layered rate limits: 600 req/min global · failed-login brake · signup brake · per-user like/message caps
- Prisma-parameterized queries + payload type-guards — injection dies at the door
- One error choke point scrubs Prisma internals, file paths and stack traces; 5xx never leaks details
- Sockets are never anonymous: JWT verified at handshake, room joins verified against DB membership
- Photo serving is college-scoped with short-lived signed URLs — tokens can't act as API credentials

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite · TypeScript · Tailwind CSS · React Router 6 |
| State | Zustand (session) · TanStack Query (server state) |
| Backend | Node.js · Express · TypeScript · Socket.IO |
| Data | PostgreSQL (Supabase) · Prisma ORM |
| Media | Supabase Storage (private bucket, signed URLs) |
| Hosting | Vercel (SPA) · Render (API, Singapore) · Supabase (Mumbai) — **₹0/month** |

## Architecture

```
Browser (React SPA — Vercel)
   │  axios (auto token refresh, rotation-race safe)
   │  Socket.IO client (JWT handshake)
   ▼
Express API (Render · Singapore)
   │  helmet · CORS · rate limits · compression
   │  routes → controllers → services   (all business logic)
   │                        │
   │              TTL caches (feed · deck · unread · auth)
   │                        │
   │                  Prisma ORM
   ▼                        ▼
Socket.IO (same process)   PostgreSQL (Supabase · Mumbai)
```

**Strict 4-layer backend:** controllers never touch Prisma; services never touch `req`/`res`. Every write path that affects a cache calls its invalidation hook. Realtime events fan out through a typed event bus — REST and sockets stay consistent.

**17 tables** covering colleges, users, posts (self-referential comment trees), matches (DB-level duplicate immunity), conversations, notifications, reports and blocks — soft deletes on all user content, composite keys on join tables, indexes on every hot read path.

---

## Run it locally

**Prerequisites:** Node 18+, a PostgreSQL database (local or Supabase free tier)

```bash
git clone https://github.com/viratcore01/idkitworks.git
cd idkitworks

# install all three packages
npm install && (cd server && npm install) && (cd client && npm install)
```

**`server/.env`** (see `.env.example`):

```env
DATABASE_URL="postgresql://user:pass@host:5432/db"
JWT_SECRET="a-long-random-string"
JWT_REFRESH_SECRET="another-long-random-string"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=5000
CLIENT_URL="http://localhost:5173"
# optional — enables Google Sign-In
GOOGLE_CLIENT_ID=""
```

```bash
# database: generate client, push schema, seed
cd server
npx prisma generate --schema=../prisma/schema.prisma
npx prisma db push --schema=../prisma/schema.prisma
npx tsx ../prisma/seed.ts          # colleges + interests
npx tsx ../prisma/seed-posts.ts    # demo users + posts
cd ..

# run both (client :5173, API :5000, proxied)
npm run dev
```

Open **http://localhost:5173**, sign up, pick a college, get verified (or use a seeded moderator account), and go.

**Demo accounts** after seeding: `virat@skola.app` · `priya@skola.app` — password `password123`.

## Deployment

| Piece | Host | Notes |
|---|---|---|
| Frontend | Vercel | Root deploy · `VITE_API_URL` → API host · `vercel.json` SPA rewrites |
| API | Render Free | Root dir `server` · build `npm install --include=dev && npm run build` · start `npm start` · health check `/api/health` · **region: Singapore** |
| Database | Supabase Free | Session pooler · Data API off · RLS on |
| Keep-alive | cron-job.org + GitHub Actions | Every 10 min → `/api/health` ([setup](KEEP-ALIVE.md)) |

The API **refuses to boot** in production without strong JWT secrets and a database URL — misconfiguration fails loudly, never silently. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_PHOTOS_BUCKET` enable Storage-backed photos; without them the API falls back to legacy Postgres bytes.

## API map

| Route group | Covers |
|---|---|
| `/api/auth` | signup · login · Google · refresh (rotating) · logout · me · completeness |
| `/api/users` | profiles · user posts · block/unblock · photos (upload/delete/serve) · photo tokens |
| `/api/posts` | feed · CRUD · likes · threaded comments |
| `/api/matches` | discover (paginated deck) · like/pass · matches · unmatch · stats · preferences · rewind |
| `/api/messages` | conversations · threads · send · edit (15-min window) · delete |
| `/api/notifications` | list · unread count · mark-all-read |
| `/api/search` | hyperlocal people + posts |
| `/api/admin` | verification queue · reports · bans · takedowns · announcements · stats |
| `/api/colleges` | directory search + curation |
| `/api/health` | no-DB liveness (keep-alive target) · `/api/health/db` deep check |

Every main-app route sits behind JWT auth **and** the college gate.

## Ops runbooks

| Doc | What it covers |
|---|---|
| [KEEP-ALIVE.md](KEEP-ALIVE.md) | The dual-pinger setup, manual triggers, how to verify the instance never sleeps |
| [SINGAPORE-MIGRATION.md](SINGAPORE-MIGRATION.md) | Zero-downtime region migration runbook (completed — kept as reference) |
| [SCALING.md](SCALING.md) | Honest load playbook: failure order under traffic, capacity ladder 1k → 1M users |

## Project structure

```
├── client/                 # React + Vite SPA
│   └── src/
│       ├── components/     # feed, layout, profile, common UI
│       ├── pages/          # 11 route pages
│       ├── layouts/        # AppLayout (sidebar+nav) · AuthLayout
│       ├── store/          # Zustand auth store
│       ├── services/       # axios client (refresh queue) · realtime
│       └── utils/          # photo tokens, helpers
├── server/                 # Express + TypeScript API
│   └── src/
│       ├── routes/         # 10 routers
│       ├── controllers/    # HTTP layer only
│       ├── services/       # ALL business logic + Prisma
│       ├── middleware/     # auth · college gate · verification · admin
│       ├── config/         # env (validated) · prisma · cache · storage · bus
│       ├── scripts/        # photo migration tooling
│       └── utils/          # jwt · password · user-cache · error sanitizer
├── prisma/                 # schema.prisma (17 models) · seeds
├── .github/workflows/      # keep-alive backup pinger
└── vercel.json             # SPA rewrites
```

## Design

**Neobrutalism** — thick 3px borders, hard offset shadows, lime/orange on cream, Space Grotesk + DM Sans. Fully responsive: desktop sidebar → mobile bottom nav, `dvh` viewport math, iPhone safe-area handling, and a dev-only layout auditor (`__layoutAudit()` in the console) that scans every page for overflow and overlap.

## Roadmap

- [ ] **Version nudge** — stale tabs get a graceful "new version available" refresh prompt
- [ ] **Supabase → Singapore** — API/DB co-location for ~5ms round-trips
- [ ] **Push notifications** — web push for matches and messages
- [ ] **Campus events** — the feed's next hyperlocal chapter

---

<div align="center">

**Built for students, by students.** ⚡

[Live site](https://idkitworks.vercel.app) · [Report an issue](https://github.com/viratcore01/idkitworks/issues) · [idkitworks01@gmail.com](mailto:idkitworks01@gmail.com)

Questions · college onboarding · safety · press — one inbox for everything.

</div>
