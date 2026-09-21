# SKOLA — Scale & Load Playbook

How this system behaves under heavy load (lakhs of users), what the hard limits are,
and the exact levers to pull when something bends. Read this before an launch push.

---

## 1. What's already built for load (matching system)

| Protection | Where | What it does |
|---|---|---|
| Paginated swipe deck | `match.service.ts → discover()` | 20 cards/request (max 50). Never dumps the whole user table into a response. |
| Indexed exclusions | `schema.prisma` (`match_likes(sender_id, action, created_at)`, `matches(user_a,status)`, `matches(user_b,status)`) | Deck query, match list, and like-lookups all hit indexes, not table scans. |
| Pass memory (30-day resurface) | `PASS_RESURFACE_DAYS` | Passed users only excluded for 30 days — the exclusion set stays small forever. |
| Atomic match creation | `$transaction` + `matches @@unique([user_a, user_b])` | Double-swipes, retries, and simultaneous mutual likes can **never** create duplicate matches. DB-enforced, not app-enforced. |
| Like cap | `LIKE_CAP=100 / 12h` per user | Spam/scraper/bot brake. Returns 429; client advances the deck gracefully. |
| Idempotent actions | `action()` upsert + same-action no-op | Re-taps don't double-count or double-match. Safe under flaky mobile networks. |
| Bidirectional block wall | checked before every like/pass | Blocked users vanish from decks **and** can't like you. |
| Soft unmatch | `status=ENDED` | Chat history preserved for safety/reporting; matches list stays clean. |
| Notification fan-out capped | only 2 rows per match | No unbounded fan-out on hot paths. |

## 2. The load model — where this breaks first

With lakhs of users, in order of failure:

1. **Feed queries** (`getFeed`) — cursor-paginated, but scans all posts per page. First bottleneck.
2. **DB connections** — SQLite is single-writer. Fine for hundreds of concurrent users, fatal at thousands.
3. **5s chat polling** — N users × 1 req/5s. At 10k concurrent users that's ~2k req/s of pure polling.
4. **Discover exclusions** — `notIn` array grows with your action count (bounded by LIKE_CAP + passes/30d, so naturally capped ~hundreds).
5. **Node single process** — one core used.

## 3. The pre-launch checklist (do these before inviting colleges)

### 3.1 Database: SQLite → PostgreSQL ✅ DONE (Supabase)
```
- prisma/schema.prisma: provider = "postgresql" + directUrl (DONE)
- Host: Supabase (aws-0-ap-south-1, session pooler :5432)
- Env: server/.env → DATABASE_URL + DIRECT_URL (connect_timeout=15, connection_limit=10)
- Verified: all 17 tables pushed, seeded, and the full workflow suite passed on Postgres
```
This was the **single highest-leverage change** — done. Next DB lever when needed:
raise connection_limit with a dedicated Supabase compute add-on, then PgBouncer tuning.

> **MEASURED Sept 2026 — pool_red alert:** the free-tier session pooler caps at
> `pool_size: 15` server sessions while the app defaulted to 10 per instance.
> Any second client (a second API instance, a dev server, or the matching
> suite) tips it into `EMAXCONNSESSION`, and every parallel-wave read (the
> deck first) starts 500ing — 12/12 `/discover` polls failed over 2 min with
> zero local pool timeouts. Pool size is owned by `DATABASE_CONNECTION_LIMIT`
> (default 10 — set 4 on Render, 2 for scripts/suites; the app also warms the
> pool at boot and holds it with a 60 s heartbeat). Until the pool is bigger:
> never run two servers + the suite at once. Long-term: dedicated compute or
> transaction-mode pooling.

### 3.2 Kill chat polling → turn on the Socket.IO layer you already have
The server side exists (`server.ts`). On the client:
- connect with the access token, join `user:{id}` on login
- emit/listen for `new-message`, `message-edited`, `message-deleted`
- keep polling as **fallback** only when socket is disconnected
At 10k concurrent users this drops ~2k req/s to near zero.

### 3.3 Cache the expensive read: the deck
The discover query is the heaviest repeated read. Cache per-user:
```js
// Redis, TTL 60s, invalidate on: user passes/likes, new signup in same college
const cached = await redis.get(`deck:${userId}:${page}`);
```
Even a 60s cache cuts deck load by ~80% (users swipe a card every few seconds,
the deck changes only when they act).

### 3.4 Rate limiting & security headers (DONE in this codebase)
```
server/src/server.ts now has:
  helmet()                     → CSP, nosniff, frame protection, HSTS-ready
  /api/auth/*  → 10/15min per IP in production (100 in dev: one shared 127.0.0.1 bucket)
  /api/*       → global limiter (300 req/min per IP)
  express.json limit: 100kb    → payload bombs rejected
  env.ts PORT guard            → invalid/zero PORT falls back to 5000, never binds port 0
  server/src/utils/http-error.ts → ALL 48 controller error sites route through one
                                   sanitizer: Prisma engine text / file paths / SQL can
                                   never reach a client (P2025→404, P2002→409, P2003→400)
  signup/login type guards     → object/array emails (NoSQL-style injection) → clean 401/400
```
**Note:** per-user limits on /posts, /matches, /messages are the remaining lever —
the like cap already exists in match.service.ts (LIKE_CAP).

### 3.5 Add the missing indexes for the feed
```sql
CREATE INDEX posts_created_at_deleted_idx ON posts (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX comments_post_created_idx ON comments (post_id, created_at);
CREATE INDEX notifications_recipient_unread ON notifications (recipient_id) WHERE is_read = false;
```

### 3.6 Crash resilience & error hygiene (DONE)
- Global error handler sanitizes every 5xx to "Something went wrong" (details logged server-side)
- unhandledRejection / uncaughtException handlers keep the process alive or exit cleanly
- Socket.IO requires a valid JWT at handshake — no anonymous sockets
- Deleted posts 404 to everyone and reject new comments/likes at the service layer
- Auth type guards reject malformed JSON bodies before they reach Prisma

## 4. Capacity ladder — what handles what

| Users (concurrent) | Architecture needed |
|---|---|
| ~100 | Current stack, any DB |
| ~1k | Postgres + Socket.IO chat + rate limits (§3.1–3.4) |
| ~10k | + Redis deck/feed cache, 2+ API instances behind a LB, sticky sessions for socket.io (or redis adapter) |
| ~100k | + read replicas for feed/search, CDN for media, background queue (BullMQ) for notifications, dedicated push service |
| 1M+ | shard matches/feeds by college, dedicated matching service, Kafka for event fan-out |

## 5. Real-world features the matching system now has (reference: Tinder/Bumble/Hinge)

- ✅ Swipe deck with pages (never "load all")
- ✅ Pass memory with resurface window (Tinder resurfaces ~2 months; we use 30d)
- ✅ Like cap (Tinder: ~100/12h unsubscribed) → drives habit + kills bots
- ✅ Mutual-like match, exactly once, race-safe
- ✅ Unmatch (soft-delete, preserves history for reports — Bumble pattern)
- ✅ Preferences: gender + age range, server-validated and clamped
- ✅ Blocked users excluded everywhere, bidirectionally
- ✅ Deck counter ("4 students in your deck") — scarcity psychology, Hinge-style
- ✅ Stats endpoint (likes sent/cap, likes received, matches) — ready for "Who liked you" paywall later
- 📋 Next candidates: photo verification badge, "smart" ordering (mutual interests first), super-like/boost, read receipts, typing indicators (all trivial once Socket.IO is live)

## 6. Observability — know it's on fire before users tell you

Minimum before launch:
1. **Request logging** with pino + request ids (replaces console.log)
2. **Error tracking**: Sentry (free tier) on both server + client
3. **Uptime**: the existing `/api/health` + UptimeRobot
4. **DB metrics**: connection count, slow query log (>200ms)
5. **Business dashboards**: matches/day, likes/day, messages/day — sudden drops = broken; sudden spikes = viral (or attack)

## 7. "Can be fixed any time" — operational rules

- **All limits are constants at the top of `match.service.ts`** — LIKE_CAP, window, resurface days. Change and restart, no migration.
- **Every delete is soft** (posts, comments, messages, matches) — recoverable, auditable.
- **Feature flags via env**: `LIKE_CAP`, rate limits can be env-driven in an afternoon.
- **Rollback story**: `git revert` + `npm run build` redeploys in minutes on Vercel/Railway; DB migrations are additive (never drop columns in the same deploy as code).
