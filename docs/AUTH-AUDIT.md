# Auth audit — signup, login, verification, sessions

Date: 2026-09-25 · Scope: the whole authentication surface (signup funnel, college-email
OTP, login, sessions/refresh, password change, Google Sign-In, profile locks) for the
API in `server/src` and the flow in `client/src`.

This is an audit **with tests**, not a review. Every claim below is backed by a test that
fails if the behaviour regresses.

```
npm test          # 144 tests: 132 server + 12 client
npm run typecheck # both workspaces, including the suites
```

---

## 1. How to run the suite

| Command | What it does |
|---|---|
| `npm test` | Runs both workspaces' suites |
| `npm --prefix server test` | API: services, OTP, sessions, Google tokens |
| `npm --prefix client test` | Funnel routing rules |
| `npm --prefix server run typecheck` | Includes `tsconfig.test.json` (the suites are typechecked too) |

**Zero new dependencies.** The suites use Node's built-in `node:test` runner through the
`tsx` loader the project already had. Tests live in `server/tests/` and `client/tests/`, are
excluded from the production build (`tsconfig.json` only includes `src`), and
`server/tests/helpers/env.ts` forces the mail transport to the dev fallback and points
`DATABASE_URL` at an unreachable loopback address — so a test can never send real mail or
touch the production database.

`server/tests/helpers/fake-db.ts` is an in-memory implementation of the Prisma delegates the
auth code uses (where/select/include/relations/transactions). It exists instead of a mock
framework so tests assert real state transitions — *"the OTP row now has `usedAt` set"* —
rather than call choreography.

---

## 2. Findings

Severity is impact-if-exploited, not effort. All nine are fixed and regression-tested.

### F1 · MEDIUM — the per-user OTP send limit never fired (mail cannon)

`sendOtp` counted the user's sends in the last 10 minutes, then **deleted** the previous
unused OTP row before creating the new one. Deleting the row removed the only evidence the
counter had, so the count could never exceed 1 and `recentOtps >= 3` was unreachable: a
resend loop could mail an unbounded number of codes to one student's inbox (bounded only by
the 60-per-15-minutes per-IP limiter, which a distributed script walks straight past).

**Fix:** retire the previous code (`updateMany … usedAt: now`) instead of deleting it. The
counter now sees every send in the window, the newest code is still the only redeemable one,
and the table keeps an auditable record of how many codes went out.
Test: *"RATE LIMIT: sends are capped per user, not just per IP"*.

### F2 · MEDIUM — a malformed OTP spent one of the five attempts

The service treated a shape error (`"12345"`, `"abcdef"`) as a wrong code and incremented
`attempts`. Over HTTP the controller screened the length, so a 5-digit code cost nothing but
6-character junk cost an attempt — the two layers disagreed, and any future caller that
bypassed the controller could burn the user's attempts on malformed input.
**Fix:** shape-check first and reject without consuming an attempt; `codesMatch` now only
ever sees equal-length inputs (it must, or `timingSafeEqual` would throw).
Test: *"verifyOtp rejects a wrong-length or non-numeric code without consuming an attempt"*.

### F3 · MEDIUM — OTP codes came from `Math.random()`

V8's PRNG is not cryptographic: a handful of observed outputs is enough to reconstruct its
state, which would let someone who can request codes predict the next one. Rate limits make
this marginal, but the fix is free.
**Fix:** `crypto.randomInt(100_000, 1_000_000)` in one shared `server/src/utils/otp.ts`
(which also owns the constant-time comparison, previously duplicated per service).

### F4 · MEDIUM — the college step was both a dead end and, later, an editable field

Two bugs, found in sequence, both about where the college can be set.

**(a) Dead end.** "Sign in with Google" on the login page creates an account with **no**
college. Every app route is college-gated, so the funnel sent them to `/setup-profile` —
which showed an empty, **disabled** college field and refused to save ("No college on your
account — restart signup or contact support"). The user was trapped in a loop, and it was
invisible to anyone testing via the signup wizard (which always supplies a college).

**(b) The first fix was wrong.** Making that screen show a *college picker* closed the dead
end but re-opened a worse one: the last screen of onboarding let an account choose a
different campus than the one it signed up with, which is exactly what the college boundary
exists to prevent (a college-less account could pick anything, unchecked).

**Fix (final):** the college is **never editable outside the wizard**. `ProfileSetupPage`
always renders it read-only, and an account with no college gets a blocked screen that sends
it back to the wizard's college step to start over — with the wizard now able to fill an
EMPTY college (`signup` resume, mirroring the `updateProfile` rule) while still refusing any
move between colleges. Both signals (`collegeId` *or* the `college` object) count as
"already chosen" via `hasCollege()`, so a payload that happens to omit one can never turn a
locked field back into a picker; `PublicRoute` also lets that mid-funnel account reach
`/signup` instead of looping through `/home`.
Tests: *"RESUME: a college-LESS account adopts the college the wizard collected"*,
*"LOCK: the college cannot be moved once set, but can be filled when empty"*,
*"hasCollege treats either signal as \"already chosen\""*.

### F5 · MEDIUM — 409 responses depended on the wording of an error message

`signup` threw bare `Error('Email already in use')` and `AuthController` recovered the status
with `error.message.includes('already') ? 409 : 400`. Re-wording a user-facing string would
silently downgrade a conflict to a client error (and the API contract would change without a
single test failing).
**Fix:** a `conflict()` helper sets `status: 409` explicitly at every collision site.
Tests: the four *"signup refuses …"* conflict cases.

### F6 · LOW-MEDIUM — a Google outage looked like a bad credential

When the JWKS fetch failed at the transport layer (`TypeError: fetch failed`), the error
escaped the friendly wrapper with no `status`, so the controller defaulted to **401** — the
user was told their Google credential was invalid while Google was actually unreachable, and
ops saw no 5xx.
**Fix:** transport failures and non-2xx JWKS responses become `503 GOOGLE_UNAVAILABLE` with
the underlying reason attached as `cause` (logged, never returned).
Test: *"a Google outage surfaces as an honest 503, never a raw fetch error"*.

### F7 · LOW — a row already bound to another Google identity could be entered

When a row was found **by email** but already carried a *different* `googleId`, the link
check was skipped entirely. Google guarantees a verified email belongs to one account, so
this needs stale/imported data to trigger — but the failure mode is another identity walking
into a linked account.
**Fix:** when a row has a `googleId`, it must match the token's `sub`, else 403.
Test: *"SECURITY: a row already bound to another Google identity cannot be entered"*.

### F8 · LOW — session housekeeping answered 400 to clients that were already leaving

`logout` with a missing/`null` token reached Prisma as `where: { token: undefined }`
(validation error → 400), and `refresh` with a non-string did the same instead of the 401
"your session ended" the client knows how to handle.
**Fix:** `logout` is now a documented no-op for junk input; `refresh` type-guards before the
query. Tests: *"logout is idempotent and only kills the session it was given"*,
*"refresh refuses unknown, malformed, expired …"*.

### F9 · LOW — `collegeId: ''` was a 403 while `null` was a silent no-op

Two spellings of "no college" behaved differently: `null` skipped the lock check, `''` tripped
it and produced *"Your college is locked to your account. Contact support to change it."* for
what is really a blank form field.
**Fix:** normalize `'' → undefined` on entry, so both are no-ops and a real id still hits the
lock. Test: *"LOCK: the college cannot be moved once set …"*.

---

## 3. Missing capability added: forgotten-password reset

A login system with no recovery path is an incident waiting to happen (every forgotten
password becomes a support ticket, or worse, a permanently lost account — and the
OTP-verified funnel makes each account expensive to re-create). Added end to end:

- `POST /api/auth/password/forgot` → mails a 6-digit code, 10-minute TTL
- `POST /api/auth/password/reset` → redeems the code, sets the password, **revokes every
  session**

Design decisions worth keeping:

| Decision | Why |
|---|---|
| **Identical response for every input** (unknown identifier, Google-only account, throttled request) | Any difference is an account-existence oracle — the same reason login uses one generic error and a dummy bcrypt compare |
| **Silent throttling** (3 sends / 10 min per user; a 4th returns success and sends nothing) | A 429 that only appears for real accounts would re-open the oracle. The per-IP limiter (20 / 15 min) answers 429 for network-level abuse, which never depends on the account |
| **Mail failures are logged, not returned** | The send is only attempted for accounts that exist, so surfacing a 502 would identify them |
| **Reset codes only for accounts that already have a password** | Google-only accounts mint their first password through a *fresh Google ID token*. An email code must not become a second, weaker door into them |
| **Delivered to the account's login email** | The address the person typed and already controls. Funnel accounts' login email *is* the verified college email; never taken from the request body |
| **Success revokes all refresh tokens** | A reset is exactly the moment a stolen device must be signed out |
| Test: *"END TO END: the full funnel account can be recovered after forgetting its password"* | Signup → verify → password → forgot → reset → back in, with the same account id |

---

## 4. What the audit verified as already correct

Written down because "we checked and it holds" is worth as much as a bug list.

**Secrets & passwords** — bcrypt cost 12; no path mints a password shorter than 8
characters; placeholder hashes (Google-created and deleted rows) can never authenticate a
password login (asserted for `''`, `'password'`, the placeholder itself, `'undefined'`).

**Enumeration resistance** — login answers one message for unknown-user and wrong-password,
running a dummy bcrypt compare on the unknown path so response *timing* doesn't differ
either; a suspended account is only distinguishable *after* the password proves ownership.

**Sessions** — short-lived access token + rotating refresh token with an atomic claim
(`deleteMany` on the un-expired row), so concurrent tab refreshes resolve to exactly one
winner; replaying a rotated token is refused; a `jti` on every token (two logins in the same
second used to collide on the unique index); refresh tokens signed with a different secret
than access tokens (neither can be used where the other is required); `alg: none` and
tampered payloads rejected; password change kills every session.

**Rate limiting** — global 1000/min per IP (health checks exempt); login counts *failures
only* (30 / 15 min) so campus NAT never locks out real sign-ins; signup 50 / 15 min; Google
60 failures / 15 min; OTP send 3 / 10 min per user + 60 / 15 min per IP.

**OTP** — constant-time compare, single-use, 10-minute expiry, 5 attempts, expired rows
reaped, mail sent *before* the row is persisted (no phantom codes), and a code is scoped to
its user: another account's code cannot verify you even with the same college email.

**Identity locks (server-enforced, not UI-only)** — display name, date of birth, gender and
college are write-once; `collegeEmail` can never be written through the profile endpoint;
the college is locked from the moment the account exists; DOB can be re-submitted on the same
calendar day so a half-finished profile is never bricked; under-16 and >100 birth dates are
refused; age is computed from DOB on every read (never stored), verified at the birthday
boundary.

**Google Sign-In** — RS256 verified against Google's JWKS (cached, refetched on key
rotation), plus `aud`, `exp`, `iat`, `iss`, `nonce` and `email_verified` checks; a personal
Gmail can never auto-verify into a college it doesn't belong to (no row is created on a
domain mismatch); a college-scoped signup only ever fills an empty college.

---

## 5. Accepted risks (documented, not fixed)

1. **An access token stays valid for its remaining TTL (up to 60 min) after a password
   change or reset.** Refresh tokens are revoked immediately, and bans/verification take
   effect live (every request re-reads `isActive`/`verificationStatus` from the DB through a
   30-second cache), so the exposure is limited to a stolen *access* token acting for under an
   hour. Tightening this needs a token-version claim (`passwordChangedAt` vs `iat`) — worth
   doing if the threat model hardens; not worth the extra per-request check today.
2. **An abandoned, passwordless signup can be re-pointed at a new email** while returning to
   the wizard. The row is worthless pre-verification (the only thing a session unlocks is
   requesting an OTP to that same inbox), so a claimant cannot obtain access to anything —
   the worst case is squatting a username on a row that never becomes usable. Verification is
   what locks an identity, and it requires inbox control.
3. **The unauthenticated reset endpoint can be used to send mail to a known address**
   (3 codes / 10 min / account, 20 requests / 15 min / IP). That is inherent to any
   forgot-password flow; the limits keep it from being useful as a spam vector.
4. **`nextStep` does not special-case staff.** An admin without a college would be routed to
   `/setup-profile`; staff have dedicated routes and the college gate exempts them, so this is
   a cosmetic edge, not a lockout.
5. **No CSRF tokens.** Sessions ride in the `Authorization` header from `localStorage`, not in
   cookies, so cross-site requests cannot be authenticated in the first place; CORS is an
   explicit allowlist and rejects unknown origins with a 403.

---

## 6. Conventions for new auth code

- Put new flows behind the funnel router (`client/src/utils/funnel.ts`) — it is the single
  answer to "where does this person go next", and it is covered by tests.
- Any new endpoint that takes an identifier must answer **identically** whether or not the
  account exists; add a test that asserts the two responses are `deepEqual`.
- Never trust the client for identity fields: the lock checks live in
  `AuthService.updateProfile`, and every attempt to bypass them has a test.
- The college is chosen in exactly one place (the wizard's first step) and rendered read-only
  everywhere else. If a screen seems to need a picker, the account is missing its college and
  belongs back at that step.
- One source for one-time codes: `utils/otp.ts` (generation + comparison).
