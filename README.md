<div align="center">

# 🎓 SKOLA

**The hyperlocal social network for college students.**

Feed · Dating · Chat — all inside your college, nothing outside it.

[![Live](https://img.shields.io/badge/Live-Zoclo-violet?style=for-the-badge)](https://idkitworks-viratcore01s-projects.vercel.app)
[![Stack](https://img.shields.io/badge/Stack-React_·_Express_·_Postgres-black?style=for-the-badge)](#-tech-stack)
[![Cost](https://img.shields.io/badge/Hosting-%E2%82%B90%2Fmonth-success?style=for-the-badge)](#-deployment--free-tier)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](#-license)

</div>

---

## ✨ What is Zoclo?

Zoclo is a **college-only social super-app**: a Reddit-style community feed, a Tinder-style dating deck, and real-time chat — fused into one neobrutalist experience.

**The core rule that shapes everything:** when a student signs up with their college, *everything* they see — feed, people, chats, notifications — belongs to that college. Cross-college content doesn't exist. It's not filtered in the UI; it's impossible at the database query level.

| | |
|:---:|:---:|
| **Community** — a Reddit-style feed with posts, likes, threaded comments, anonymous confessions, and top-comment previews | **Dating** — a swipe deck scoped to your campus, with gender/age preferences, passes that resurface after 30 days, and atomic mutual matching |
| **Chat** — real-time messaging with edit windows, delete-tombstones, and day separators | **Profiles** — relationship-aware profiles with completeness meter, interests, and privacy-first fields |

## 📸 Screenshots

> Drop PNGs with these names into a `screenshots/` folder in the repo root and they render automatically.

| Page | Screenshot |
|---|---|
| **Login** — neobrutalist auth with the two-tone SKOLA logo | `screenshots/login.png` |
| **Home Feed** — college posts with top-comment previews, like/comment counts | `screenshots/feed.png` |
| **Discover** — the swipe deck, scoped to your campus | `screenshots/discover.png` |
| **Matches** — your matches list, jump straight into chat | `screenshots/matches-list.png` |
| **Chat** — real-time thread with edit/delete tombstones | `screenshots/chat.png` |
| **Profile** — stats, interests, profile strength, edit modal | `screenshots/profile.png` |
| **Notifications** | `screenshots/notifications.png` |
| **Search** | `screenshots/search.png` |

```md
![Login](screenshots/login.png)
![Feed](screenshots/feed.png)
![Discover](screenshots/discover.png)
![Chat](screenshots/chat.png)
![Profile](screenshots/profile.png)
```

*(Images are expected in `/screenshots` — see the table above for filenames.)*

---

## 🧭 The One Rule: College-Only

Everything in Zoclo is enforced **server-side**, not hidden in the UI:

| Surface | Enforcement |
|---|---|
| Community feed | Query filters `author.collegeId = viewer.collegeId` at the database |
| Posts by direct URL | A post from another college **404s** — its existence isn't even confirmable |
| Likes / comments | Rejected with 404 if the post is outside your college |
| Dating deck | `collegeId = viewer.collegeId` — preferences can never widen the pool |
| Like / pass actions | Cross-college swipe → 404, even with a guessed user ID |
| Conversations | Creation itself refuses cross-college targets |
| Notifications | Actors from other colleges are filtered out |
| Search | Only your college's people and posts exist |
| Moderation | College admins see only their college; `super_admin` sees all |
| No college assigned? | **403 on every main-app route** + frontend gate to profile setup |

`collegeId` is resolved from the **live database on every request** (never from the JWT), so scope changes apply instantly and can't be spoofed. Once assigned, a user's college is **locked** — no carrying content between colleges.

---

## 🔧 Tech Stack

| Layer | Tech |
|---|---|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, React Router 6 |
| **State** | Zustand (auth/session) + TanStack Query (server state) |
| **Backend** | Node.js, Express 4, TypeScript |
| **Database** | PostgreSQL (Supabase) + Prisma ORM |
| **Realtime** | Socket.IO (JWT-authenticated handshakes, room membership checks) |
| **Auth** | JWT access tokens (15 min) + rotating refresh tokens (7 d, stored server-side) |
| **Security** | helmet, express-rate-limit, 100 kb body cap, centralized error sanitizer |
| **Hosting** | Vercel (SPA) + Render (API) + Supabase (Postgres) — **₹0/month** |

## 🏗️ Architecture

```
Browser (React SPA — Vercel)
   │  axios (auto token refresh, request queue)
   │  Socket.IO client
   ▼
Express API (Render)  ──  helmet · CORS · rate limits · body cap
   │   routes/ → controllers/ → services/   (all business logic)
   │                            │
   │                     Prisma ORM
   ▼                          ▼
Socket.IO (same process)   PostgreSQL (Supabase) — 17 tables
   rooms: user:<id>,
   conversation:<id>
```

**Strict 4-layer backend** — controllers never touch Prisma; services never touch `req`/`res`. Every error response flows through one sanitizer: Prisma internals, file paths, and stack traces can never reach a client.

**Database model (17 tables):** `colleges`, `users`, `refresh_tokens`, `interests`, `user_interests`, `posts`, `comments` (self-referential reply trees), `post_likes`, `match_preferences`, `match_likes` (LIKE/PASS memory), `matches` (`@@unique([userA, userB])` — duplicate matches are impossible at the DB level), `conversations`, `conversation_members`, `messages`, `notifications`, `reports`, `blocks`.

Soft deletes everywhere user content lives (`deletedAt`), tombstone reads for deleted messages/comments, composite primary keys on join tables, and indexes on every hot read path.

---

## 🎯 Features

### 📝 Community Feed
- Text posts (NORMAL / CONFESSION / POLL / QUESTION) with anonymous posting
- Owner-only anonymous archive: your anonymous posts appear on YOUR profile behind a "Only you can see these" badge — enforced server-side (anyone else's request returns an empty list), and even the author sees them under the masked "Anonymous Student" persona, so the real author never leaves the server
- Reddit-style threaded comments; deleted-with-replies become tombstones, childless deletes vanish
- Top-3 newest comments previewed on every feed card
- Cursor pagination (infinite scroll), optimistic likes, live counts
- Edit your comments anytime ("Edited" tag), delete with Reddit semantics

### ❤️ Dating / Matching
- Swipe deck (like / pass) — same-college only, enforced at query level
- Gender + age-range preferences (server-validated and clamped)
- Pass memory: passed profiles resurface after 30 days
- **Atomic mutual matching** inside a transaction — double-swipes and races can never create duplicate matches
- Like cap (100 / 12 h) — bot and scraper brake
- "It's a match!" celebration modal; unmatch (soft — history preserved for safety reports) with clean re-match later
- Age computed from DOB; exact birthdates never leave the server

### 💬 Chat
- Conversations gated on matches — no messaging strangers
- Real-time send/delivery via Socket.IO with a 5 s REST-poll fallback
- Edit window (15 min, WhatsApp-style), delete → "Message deleted" tombstone for everyone
- Day separators, unread counts, block-aware at every step

### 👤 Profiles
- Relationship-aware: the profile knows if you're matched / they liked you / blocked — and renders the right actions
- Profile-strength meter (weighted completeness checks + next-step hint)
- Edit modal with server-mirrored validation (name, bio, DOB 16+, gender, course/year, interests, avatar color)
- Privacy: exact DOB, email, and match count are never exposed to other users
- Block/unblock — bidirectional wall across feed, search, decks, and chat

### 🔔 Notifications & Search
- Likes, comments, replies, matches, messages — filtered to same-college actors
- Unread badge consistent with the filtered list
- Hyperlocal search: people + posts from your college only; anonymous authors masked

### 🛡️ Moderation & Safety
- Report system (posts / comments / users / messages)
- College-scoped admin: reports, bans, content takedowns respect college walls; `super_admin` overrides
- Blocked users can't DM, appear in decks, or surface in search

---

## 🔐 Security

- **helmet** security headers; CORS locked to the client origin
- **Rate limits:** 300 req/min global · 10 login attempts / 15 min (production) · 100 likes / 12 h per user
- **Payload cap:** 100 kb JSON — junk floods die at the door
- **Injection-proof:** Prisma parameterizes everything; signup/login type-guards reject object/array payloads before the DB
- **Zero info leaks:** one error choke point scrubs Prisma engine text and paths; 5xx always returns a generic message
- **Sessions:** refresh tokens rotate on every use and live server-side — logout and compromise invalidate instantly
- **Sockets:** no anonymous connections — JWT verified at handshake, room joins verified against membership

---

## 🚀 Run It Locally

**Prerequisites:** Node 18+, a Postgres database (local or Supabase free tier)

```bash
# 1. Clone
git clone https://github.com/viratcore01/idkitworks.git
cd idkitworks

# 2. Install (root + workspaces)
npm install
cd server && npm install && cd ../client && npm install && cd ..

# 3. Server environment — server/.env
```

`server/.env`:
```env
DATABASE_URL="postgresql://user:pass@host:5432/db"
DIRECT_URL="postgresql://user:pass@host:5432/db"
JWT_SECRET="a-long-random-string"
JWT_REFRESH_SECRET="another-long-random-string"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=5000
CLIENT_URL="http://localhost:5173"
```

```bash
# 4. Database: generate client, push schema, seed
cd server
npx prisma generate --schema=../prisma/schema.prisma
npx prisma db push --schema=../prisma/schema.prisma
npx tsx ../prisma/seed.ts        # colleges + interests
npx tsx ../prisma/seed-posts.ts  # demo users + posts
cd ..

# 5. Run (client :5173 + API :5000, proxied)
npm run dev
```

Open **http://localhost:5173** — sign up, pick your college, and go.

**Demo accounts** (after seeding): `virat@skola.app` · `priya@skola.app` · … — password `password123`.

---

## 🌍 Deployment (₹0/month)

| Piece | Host | Notes |
|---|---|---|
| **Frontend** | Vercel (Hobby) | Root repo deploy; `VITE_API_URL` env var → API URL; `vercel.json` handles SPA rewrites |
| **API** | Render (Free) | Root Directory `server`; build `npm install && npm run build`; start `npm start`; all secrets in env |
| **Database** | Supabase (Free) | Session-pooler connection string; Data API off, RLS on |

Production guard: the API **refuses to boot** if `NODE_ENV=production` without strong JWT secrets and a `DATABASE_URL` — no silent misconfigurations.

Free-tier notes: Render sleeps after ~15 min idle (first request warms it, ~50 s) and Supabase pauses after 7 idle days (one-click restore, data intact).

---

## 📡 API Map (48 endpoints)

| Route group | What it covers |
|---|---|
| `/api/auth` | signup · login · refresh (rotating) · logout · me (GET/PATCH) · completeness |
| `/api/users` | profile (+relationship context) · user posts · block/unblock · colleges · interests |
| `/api/posts` | feed · CRUD · like toggle · comments (create/edit/delete/nest) |
| `/api/matches` | discover (paginated deck) · like · pass · matches · unmatch · stats · preferences |
| `/api/messages` | conversations · thread read · send · edit (15-min window) · delete (tombstone) |
| `/api/notifications` | list · unread count · mark-all-read |
| `/api/search` | hyperlocal people + posts |
| `/api/admin` | reports (list/resolve, college-scoped) · content takedown · ban · stats |
| `/api/health` | lightweight uptime (no DB — for keep-alive/LBs) + auth methods |
| `/api/health/db` | deep check with DB round-trip (for real monitoring/alerting) |

All main-app routes sit behind `authMiddleware` (JWT + live user check) **and** `collegeRequired` (the isolation gate).

---

## 🔥 Keep-alive (free tier)

The Render free instance sleeps after ~15 idle minutes (20–50 s wake-up).
Two independent free pingers keep it warm — **cron-job.org (primary)** and the
in-repo GitHub Actions workflow (backup). Setup, manual trigger and
verification steps: **[KEEP-ALIVE.md](KEEP-ALIVE.md)**.

Moving the API closer to the Mumbai Supabase region (≈2× faster DB round-trips)?
Follow the zero-downtime runbook: **[SINGAPORE-MIGRATION.md](SINGAPORE-MIGRATION.md)**.

---

## 📈 Scaling

The codebase ships with **[SCALING.md](SCALING.md)** — an honest load playbook: what's already protected (pagination, indexes, caps, atomic matching), the exact failure order under heavy traffic, a capacity ladder from ~1 k to 1 M users, and the pre-launch checklist. Spoiler: the current free stack comfortably carries a real student community; the first lever when growth hits is Supabase compute, not a rewrite.

## 📁 Project Structure

```
skola/
├── client/               # React + Vite SPA
│   └── src/
│       ├── components/   # feed, layout, profile, common UI
│       ├── pages/        # 11 route pages
│       ├── layouts/      # AppLayout (sidebar+nav), AuthLayout
│       ├── store/        # Zustand auth store
│       ├── services/     # axios client (token refresh queue)
│       └── types/        # shared TS types
├── server/               # Express + TypeScript API
│   └── src/
│       ├── routes/       # 8 routers, 48 endpoints
│       ├── controllers/  # HTTP layer only
│       ├── services/     # ALL business logic + Prisma
│       ├── middleware/   # auth, college gate, admin
│       ├── config/       # env (validated), prisma singleton
│       └── utils/        # jwt, password, http-error sanitizer
├── prisma/               # schema.prisma (17 models) + seeds
├── screenshots/          # product screenshots (README)
├── vercel.json           # SPA rewrites for the frontend host
└── SCALING.md            # load playbook
```

## 🎨 Design

**Neobrutalism** — thick 3 px borders, hard offset shadows, lime/orange accents on cream, Space Grotesk + DM Sans. Fully responsive: desktop sidebar → mobile bottom nav, `dvh` viewport math, iPhone safe-area handling, and a dev-only layout auditor (`__layoutAudit()` in the console) that scans every page for overflow/overlap.

---

<div align="center">

**Built for students, by students.** ⚡

[Live Site](https://idkitworks-viratcore01s-projects.vercel.app) · [Report an issue](https://github.com/viratcore01/idkitworks/issues)

Contact — **[idkitworks01@gmail.com](mailto:idkitworks01@gmail.com)** · one inbox for everything (questions, college onboarding, safety, press)

</div>
