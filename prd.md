# Zoclo — Product Requirements Document

> **Product:** Zoclo (working title during development: *Skola*)
> **Owner:** Virat Shishodia · **Repo:** `viratcore01/idkitworks` · **Status:** Live (MVP+)
> **Doc version:** 1.0 · Sept 2026
> **Live app:** https://idkitworks-viratcore01s-projects.vercel.app

---

## 1. The Idea

### 1.1 One-liner
**Zoclo is a college-only social super-app** — a Reddit-style community feed, a Tinder-style dating deck, and real-time chat, fused into one hyperlocal experience locked to your campus at the database level.

### 1.2 The problem
College students already live three digital lives: a group-chat/social life (WhatsApp, Discord), a confessions page (Instagram meme pages), and a dating life (Tinder/Bumble/Hinge). Each tool fails them in the same way: **it has no walls.** A confession page is public; a dating app matches you with strangers from across the city; group chats are private but fragmented.

Yet the most valuable social graph a student has is **the campus itself** — the people they pass every day but never talk to.

### 1.3 The core rule that shapes everything
> **When a student signs up with their college, everything they see — feed, people, chats, notifications — belongs to that college. Cross-college content doesn't exist. It's not filtered in the UI; it's impossible at the database query level.**

This one rule creates the product's safety, relevance, and trust:
- A dating deck that can't show a stranger from outside campus.
- A confessions feed where everyone is provably a classmate.
- A moderation model where admins are *part of the community they moderate*.

### 1.4 Why "Zoclo"?
A wordmark-first brand: graffiti-styled logo, Youthful Maximalist Neo-Brutalism design language (see §10). The brand target is **bold, fun, tactile, unmistakably youthful** — the anti-generic-app.

### 1.5 Non-goals (v1)
- ❌ Multi-college feeds, cross-college matchmaking, or any "discover" beyond campus
- ❌ Public/anonymous feeds visible without signup
- ❌ Web3, marketplaces, or anything beyond the feed/match/chat triangle
- ❌ Native mobile apps (responsive PWA-style web only)

---

## 2. The Ecosystem

```
                    ┌──────────────────────────────────────┐
                    │             THE STUDENT              │
                    │  signs up → picks college → verified │
                    └───────┬──────────────┬───────────────┘
                            │              │
             ┌──────────────▼──┐        ┌──▼───────────────┐
             │   COMMUNITY     │        │     MATCHING     │
             │  Feed · Confess │        │  Deck · Likes    │
             │  Comment · Save │        │  Loop-chain deck │
             └────────┬────────┘        └──┬───────────────┘
                      │   mutual like      │
                      │  ┌─────────────────▼┐
                      │  │      MATCH       │
                      │  │ why-you-matched  │
                      │  │ criteria snapshot│
                      │  └────────┬─────────┘
             ┌────────▼───────────▼────────┐
             │           CHAT              │
             │  realtime · edit · unmatch  │
             └─────────────────────────────┘
                      │
             ┌────────▼─────────────────────┐
             │   SAFETY & MODERATION        │
             │ ID verification · reports    │
             │ blocks · college admins      │
             └──────────────────────────────┘
```

Every surface feeds every other: posts build the profile that feeds the deck; the deck creates matches; matches unlock chat; reports/blocks guard all three. **The college boundary wraps the entire ecosystem.**

---

## 3. Architecture

### 3.1 System topology

```
Browser (React SPA — Vercel)
   │  axios (auto token refresh, request queue)
   │  Socket.IO client
   ▼
Express API (Render)  ──  helmet · CORS · rate limits · 100kb body cap
   │   routes/ → controllers/ → services/   (all business logic in services)
   │                            │
   │                     Prisma ORM
   ▼                          ▼
Socket.IO (same process)   PostgreSQL (Supabase) — 19 tables
   rooms: user:<id>,        photos & ID images stored as Bytes
   conversation:<id>        (no external object storage needed)
```

- **Frontend:** React 18 + Vite + TypeScript, Tailwind CSS (Zoclo design tokens), React Router 6, Zustand (auth session) + TanStack Query (server state cache).
- **Backend:** Node.js + Express 4 + TypeScript, Socket.IO on the same HTTP server. **Strict 4-layer rule:** controllers never touch Prisma; services never touch `req`/`res`.
- **Realtime:** Socket.IO with JWT verified at handshake; room joins verified against membership. REST polling fallback (5 s) if the socket drops.
- **Events bus:** domain events (`match:new`, `notification:new`, `message:new`…) are published in services and subscribed in `server.ts`, which translates them into socket room emits — REST actions produce realtime push without coupling.
- **Database:** PostgreSQL (Supabase, session pooler) via Prisma. Soft deletes everywhere user content lives (`deletedAt`); composite PKs on join tables; indexes on every hot read path.
- **Errors:** one central sanitizer — Prisma internals, file paths, and stack traces can never reach a client. Production boot refuses weak JWT secrets.

### 3.2 Auth model
- JWT **access token 15 min** + **rotating refresh token 7 d** stored server-side (`refresh_tokens` table) — reuse/compromise invalidates instantly.
- Frontend axios layer auto-refreshes with a request queue so parallel 401s trigger exactly one refresh.
- `collegeId` is resolved from the **live DB on every request** (never from the JWT) so scope changes apply instantly and can't be spoofed. College assignment is **locked** once set.
- Google Sign-In supported (`googleId` linkage).

### 3.3 Data model (19 tables)

| Domain | Tables | Notes |
|---|---|---|
| Identity | `colleges`, `users`, `refresh_tokens` | user: goal, gender, DOB (private), year, course, role (`user`/`admin`/`super_admin`), verification status |
| Media | `user_photos`, `id_verifications` | photos stored as Postgres `Bytes` (slot 0 = profile, 1–3 = gallery); ID image **deleted the moment verification resolves** |
| Community | `posts`, `comments` (self-referential), `post_likes`, `saved_posts` | post types NORMAL/CONFESS/QUESTION/POLL; anonymous = author masked, never exposed |
| Matching | `match_preferences`, `match_likes`, `matches` | `@@unique([userA, userB])` on matches makes duplicates impossible at DB level; `match_likes` holds LIKE/PASS memory (deck loop ordering) |
| Intent | `relationship_goal` (User), `open_to_goals` (prefs) | DATING / RELATIONSHIP / HOOKUP / CASUAL / NOT_SURE |
| Messaging | `conversations`, `conversation_members`, `messages` | created only between matched, unblocked, same-college users |
| Meta | `notifications` (typed + JSON `metadata`), `reports`, `blocks` | blocks are bidirectional walls, indexed both directions |
| Interests | `interests`, `user_interests` | power the shared-interest filter + match-criteria snapshot |

---

## 4. The One Rule — College-Only Enforcement (server-side)

| Surface | Enforcement |
|---|---|
| Community feed | Query filters `author.collegeId = viewer.collegeId` at the DB |
| Posts by direct URL | A post from another college **404s** — its existence isn't confirmable |
| Likes / comments | Rejected with 404 if the post is outside your college |
| Dating deck | `collegeId = viewer.collegeId` — preferences can never widen the pool |
| Like / pass actions | Cross-college swipe → 404, even with a guessed user ID |
| Conversations | Creation itself refuses cross-college targets |
| Notifications | Actors from other colleges are filtered out |
| Search | Only your college's people and posts exist |
| Moderation | College admins see only their college; `super_admin` sees all |
| No college assigned? | **403 on every main-app route** + frontend gate to profile setup |

---

## 5. Feature Specifications & Workflows

### 5.1 Onboarding, Accounts & Student-ID Verification

**Flow:** sign up (email/password or Google) → pick your college → profile basics (name, DOB 16+, gender, course, year, interests, avatar) → *(optional but encouraged)* student-ID photo → land on the feed.

**Student-ID verification pipeline:**
1. User uploads an ID image (stored as bytes in `id_verifications`, status `PENDING`).
2. **Auto-decision pass** runs first (confidence scored) → `APPROVED` / `REJECTED` / `REVIEW`.
3. `REVIEW` items enter the **admin verification queue**; a college admin (or super_admin) views the image and approves/rejects.
4. **Privacy invariant:** the ID image is *deleted the moment the decision resolves* — auto or human. It is never retained.
5. Verified status grants the mint ✅ badge on cards and profiles.

**Access control:** email must not already exist; signup/login inputs are type-guarded against object/array injection; login attempts rate-limited to 10 / 15 min in production.

---

### 5.2 Community Feed

**What:** a Reddit-style college board. Post types: `NORMAL`, `CONFESSION`, `QUESTION`, `POLL`.

**Post workflow:**
1. Composer on `/home`: text + type toggle + **Anonymous** switch. Anonymous posts replace identity with the **"Anonymous Student"** ghost persona (lilac avatar) — the mapping author→post lives only server-side.
2. Anonymous posts land in the author's **private archive**: on *their own* profile under an "Only you can see these" badge, rendered behind the masked persona. Any other user's request for that list returns an empty one (enforced server-side). Nobody — including users who open the author's profile — can see someone else's anonymous posts.
3. Feed renders cards with category tags (confession labels are pink), like & comment counts, **top-3 newest comment previews**, save + share + more-options.
4. Tabs: All / Posts / Questions / Confessions. Infinite scroll via **cursor pagination**.
5. Likes are optimistic with live counts; comments are threaded (self-referential), editable anytime ("Edited" tag), and delete with Reddit semantics — **deleted-with-replies become tombstones**, childless deletes vanish.
6. **Saved posts:** per-user bookmark list at `/saved` — private to the user, toggle from any card.

---

### 5.3 Matching & Dating (the flagship)

**The deck (`/matches` → Discover):**

**Loop-chain deck model (differs deliberately from Tinder):**
1. **Fresh profiles first** — newest unactioned same-college people at the front.
2. **Passing (✗)** sends that profile to the **back of the chain** (ordered oldest-pass-first). The deck **cycles forever** — a passed profile *always comes around again*; passes shape order, never permanent visibility.
3. **Liking (👍)** removes the profile from the deck (pending their answer — no awkward re-showing while your like stands).
4. When the fresh front runs out, the client **auto-wraps to page 0** seamlessly; recycled cards carry a periwinkle **"back in your loop"** badge so re-seeing someone feels like a feature.
5. A **new joiner** enters at the front; the cycle keeps flowing around them.

**Preferences (all server-validated & clamped, applied in the DB query):**
| Filter | Options |
|---|---|
| Show me | Everyone / Women / Men / Other |
| Age range | dual sliders 16–99 |
| Looking for (intent matching) | multi-select of goals; deck shows profiles whose goal is in your selection (goal-less people always visible) |
| Year dealbreaker | Any / **1+** / 2+ / 3+ / 4+ |
| Shared interests | Off / 1+ / 2+ / 3+ (self-disables if you have no interests — never nukes the deck) |

> *"Verified students only" was shipped as a dealbreaker and later removed end-to-end (UI, filter, API, DB column) — a stale client sending it is ignored gracefully.*

**Likes-you priority (Hinge/Tinder-Gold pattern, free):**
- People who already liked you **surface first** in the deck with a **"likes you" badge**, plus a chip *"• N waiting to match with you"*; `stats.likesYou` feeds it. Liking back = instant match.
- Every incoming first-like fires a **LIKE notification** (realtime + inbox).

**Like workflow:**
1. Swipe like → idempotency guard (re-swipe = quiet no-op), daily cap **100 likes / 12 h** (bot brake), photo-gate enforced (must have ≥1 photo to like).
2. Receiver gets a LIKE notification (first like only — action updates never re-notify).
3. **Mutual like → atomic match** inside one transaction: upsert `matches` (unique pair), create **both** MATCH notifications, publish realtime `match:new`.
4. Rewind: 10-minute window to undo the last pass.

**Why-you-matched criteria (the match notification):**
- At the instant of a mutual like, the server computes the **strictly-common intersection** of both profiles: an **identical relationship goal** + **genuinely shared interests**. Diverged options are excluded — if you select *Dating + Hookup* and they select *Dating*, the notification shows only `Looking for: Dating`.
- The snapshot is stored on the `Match` row (`criteria JSON`) **and** on both MATCH notifications (`metadata JSON`), so the explanation is permanent and consistent.
- Renders as chips: the **"It's a Match!"** popup and the **Notifications page** (`Why you match: [Looking for: Dating] [chess] …`).
- Zero common? Honest fallback: *"No listed criteria in common — matched on vibes."* Nothing is fabricated.
- Unmatch → re-match **refreshes** the snapshot (goals/interests may have changed).

**Unmatch:** soft (status `ENDED`, history preserved for safety reports), clean re-match later.

**Cards & profiles:** photo carousel (up to 4), verified ✅, goal badge (pink=Dating, violet=Relationship, mint=Hookup, yellow=Casual, lilac=Not sure), shared-interest chip when that filter is on. Age computed from DOB; **exact birthdates, emails, and match counts never leave the server**.

---

### 5.4 Chat

- Conversations are **gated on matches** — no messaging strangers; creation refuses cross-college and blocked targets.
- Realtime send/receive via Socket.IO; **5 s REST-poll fallback** when the socket is down.
- **Edit window: 15 min** (WhatsApp-style) → "Edited" tag; delete → **"Message deleted" tombstone** for everyone (soft delete).
- Day separators, unread counts, block-aware at every step (blocked users can't DM, and blocks work mid-conversation).
- Unmatch keeps history read-only-ish (conversation remains for safety review).

### 5.5 Profiles

- Relationship-aware rendering: the same profile page knows if you're matched / they liked you / it's you / they're blocked — and shows the right actions.
- **Profile-strength meter:** weighted completeness checks + a next-step hint (add photo, interests, verification…).
- Edit modal with **server-mirrored validation** (name, bio, DOB 16+, gender, course/year, interests, avatar color/photo, **Looking-for goal chips**).
- Blocks: bidirectional wall across feed, search, decks, and chat; block list manageable from settings.

### 5.6 Notifications

- Types: LIKE (post), COMMENT, COMMENT_REPLY, MATCH (with criteria metadata), NEW_MESSAGE, MENTION, admin announcements.
- Unread badge consistent with the college-filtered list (actor-less/anonymous notifications always visible).
- Realtime push via `notification:new`; mark-all-read.
- MATCH notifications render the why-you-matched chips (§5.3).

### 5.7 Search

- Hyperlocal: people + posts from your college only.
- Anonymous authors masked even in search results.

### 5.8 Moderation & Safety (admin)

- **Report system** for posts / comments / users / messages, with reason + description.
- **College-scoped admin:** reports queue, bans, content takedowns all respect college walls; `super_admin` sees across colleges.
- **Verification queue** (§5.1) with image review (admin-only endpoints).
- Admin dashboard stats: users, posts, reports, verification backlog.
- Bans flip `isActive=false` → locked out everywhere.

---

## 6. Quality Assurance — the worst-case suite

`server/scripts/test-matching.ts` — a **40-case adversarial suite** that runs against the real API + real DB (throwaway users, self-cleaning, non-zero exit on failure):

- Idempotent double-swipes (like & pass races) → exactly one row
- Mutual-like race → exactly one match, both notifications, once
- Match-criteria: common-goal snapshot, no fabricated interests, notification metadata, divergence test (goals changed → re-match → only strictly-common survive)
- Unmatch → re-like → re-match cycle
- Guards: self-like, cross-college, blocked (bidirectional), bogus IDs, null payload
- Photo gate (403 `PHOTO_REQUIRED`, gated deck)
- Loop-chain recycling (passed profile re-enters passer's chain)
- Likes-you priority (surfaces first, `theyLikedMe`, instant match on like-back)
- Preference validation: invalid goals stripped, clamps applied, removed `onlyVerified` ignored, reset-to-defaults
- Auth/abuse: 401s, garbage tokens
- Final state consistency (no duplicate rows, no runaway matches)

Run: `cd server && npx tsx scripts/test-matching.ts`

---

## 7. Design System — Youthful Maximalist Neo-Brutalism

Single source of truth: `client/tailwind.config.js` (`tokens` object — change a hex, reskin the app).

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#FAF7F2` milk cream | Page background (with the all-over doodle tile: bolts, hearts, cubes, Win98 bars, grids, smiley, crown — plus a cream veil so text always wins) |
| `ink` | `#0F172A` | ALL text, borders, shadows — flat #000 is banned |
| `violet` | `#6D28D9` | Primary identity, headings, match actions |
| `pink` | `#F43F5E` | Confession labels, hearts/match triggers |
| `yellow` | `#FBBF24` | Banners, unread alerts, secondary highlights |
| `mint` | `#10B981` | Verified checks, active indicators |
| `peri` | `#60A5FA` | Secondary buttons, nav chips, comment pills |
| `lilac` | `#C4B5FD` | Anonymous persona, decorative tints |

**Structure:** borders clamped to 2px, zero border-radius app-wide (strict 90°), generous padding. **Motion:** hover lift −3px/−3px with shadow growing 3px→6px; active press +2px/+2px with shadow fully gone. **Retro utilities:** `.nb-close98` (Windows-98 beveled close button), `.nb-separator` dash patterns.

**Brand assets:** transparent graffiti wordmark (`zoclo-logo.png`), favicon chip, og-image — all regenerable from one raw file via `client/scripts/build-brand-assets.ps1`. Logo renders inline where possible (zero image requests in the header).

---

## 8. Performance & Reliability

- **The lag lessons (built-in fixes):** auth caching, DB indexes on hot paths (blocks both directions), lazy media loading, cursor pagination, and the like-cap protecting the DB from floods.
- **Keep-alive pinger:** Render free tier sleeps an idle server (~15 min; waking takes 30–50 s). While a user has the app open, the client pings `/api/health` every 4 minutes (stops on hidden tabs) so the server never dozes mid-session.
- **Payloads:** photos stored as DB bytes keeps hosting at ₹0; compressed brand assets (JPEG/SVG pipelines) keep the SPA light.

---

## 9. Deployment (₹0/month)

| Piece | Host | Notes |
|---|---|---|
| Frontend | Vercel (Hobby) | SPA rewrites via `vercel.json`; `VITE_API_URL` env |
| API | Render (Free) | root dir `server`; build `npm run build`; start `npm start` |
| Database | Supabase (Free) | session pooler; Data API off, RLS on |

Production guard: API refuses to boot with weak secrets when `NODE_ENV=production`. Free-tier caveats documented (Render cold starts — mitigated by the keep-alive; Supabase pauses after 7 idle days).

---

## 10. Roadmap (ideas already staged)

| Near | Mid | Bold |
|---|---|---|
| "Who liked you" grid page with like-back buttons | Multi-goal profiles (pick several "looking for" options) | Campus events & meetups module |
| Year + goal badges on cards before swiping | More dealbreakers (smoke/drink/diet) | Voice notes in chat |
| "Things in common" header in matched chats | Max-year filter (cohort matching) | Polls with live results in the feed |
| Push notifications (web push) | Photo verification (selfie-match) | College ambassador onboarding program |

---

## 11. Success Metrics (proposed)

- **Activation:** % of signups reaching (a) first post/comment, (b) first swipe, (c) ID upload
- **Match engine:** like→match conversion, likes-you like-back rate, deck cycle depth before match
- **Community:** DAU/MAU, posts per active user, confession share, comment depth
- **Trust:** reports resolved < 24 h, verification turnaround, block rate (leading churn indicator)
- **Retention:** D7/D30 by cohort and by college

---

*This PRD reflects the product as built and verified (40/40 worst-case suite passing; all flows live-tested against the production database).*
