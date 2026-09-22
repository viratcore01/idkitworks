import { PrismaClient } from '@prisma/client';

/**
 * Production pool for Supabase Supavisor (transaction mode):
 * - pgbouncer=true  → skip server-side prepared statements (required in
 *                     transaction mode; without it, concurrent load crashes
 *                     requests with "prepared statement already exists")
 * - connection_limit → cap per-instance pool (Render free + Supabase free).
 * - pool_timeout    → wait instead of instantly 500-ing during spikes.
 *
 * SINGLE SOURCE OF TRUTH: params are set exactly once here (overwrite, not
 * append), so DATABASE_URL can never carry duplicate connection_limit /
 * pool_timeout values. Tune upward via env as the database grows:
 *   DATABASE_CONNECTION_LIMIT (default 10), DATABASE_POOL_TIMEOUT (default 20s)
 */
const CONNECTION_LIMIT = Number(process.env.DATABASE_CONNECTION_LIMIT || 10);
const POOL_TIMEOUT = Number(process.env.DATABASE_POOL_TIMEOUT || 20);

function pooledDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('connection_limit', String(CONNECTION_LIMIT));
    url.searchParams.set('pool_timeout', String(POOL_TIMEOUT));
    return url.toString();
  } catch {
    return raw; // unparsable — let Prisma surface its own error
  }
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = pooledDatabaseUrl(process.env.DATABASE_URL)!;
}

/**
 * ── Interactive-transaction budgets (single source of truth) ──
 *
 * REPRODUCED FAILURE (not theoretical): Prisma's default interactive
 * transaction budget is maxWait 2s / timeout 5s. The mutual-match transaction
 * in match.service.ts runs ~6 sequential statements, and each one is a ~0.45 s
 * DB round-trip (README) — ~2.7 s warm, over 5 s the moment the pooler is
 * busy or a cold start lands. When the budget blows, Prisma throws
 * `Transaction already closed: ... the timeout for this transaction was
 * 5000 ms`, the whole transaction rolls back (the LIKE row is never written),
 * and the error becomes `500 {"error":"Something went wrong"}`.
 *
 *
 * Net user impact: tap LIKE on someone who already liked you and *nothing
 * happens* — no match, no error message that means anything, no way to retry
 * that helps. It is the app's single most valuable write path, and it was
 * silently one slow round-trip away from failing.
 *
 * These budgets are deliberately generous and env-tunable. A long transaction
 * is bounded work (a handful of indexed statements); a wrong 500 on a match is
 * unbounded harm. Timeouts that are too tight are strictly worse than timeouts
 * that are too loose — Postgres still holds row locks, so a stuck transaction
 * self-terminates rather than hanging forever.
 *
 * Usage: `prisma.$transaction(fn, TX_OPTIONS)` — ALWAYS pass these. There are
 * four interactive transactions in the codebase; all four pass it. §2d of
 * scripts/test-matching.ts hammers the match path in a loop, because that is
 * where the 5s default was demonstrably reachable.
 */
export const TX_TIMEOUT_MS = Number(process.env.DATABASE_TX_TIMEOUT_MS || 20_000);
export const TX_MAX_WAIT_MS = Number(process.env.DATABASE_TX_MAX_WAIT_MS || 10_000);
export const TX_OPTIONS = { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS } as const;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ── Pool warm-up + heartbeat (launch hardening) ──
// A saturated pooler (Supabase free: 15 sessions) refuses NEW sessions while
// letting HELD ones work. Cold pools therefore 500 every parallel-wave query
// until sessions establish — exactly the launch-night failure mode. Warming
// grabs the full pool at boot (when slots are most likely free) and the
// heartbeat holds them so idle reaping can't strand us mid-burst.
// Tuning: DATABASE_CONNECTION_LIMIT (default 10), DATABASE_HEARTBEAT_SEC
// (default 60, 0 = off). Never blocks boot, never throws.
const HEARTBEAT_SEC = Number(process.env.DATABASE_HEARTBEAT_SEC || 60);
let heartbeatOn = false;

export async function warmPool(): Promise<void> {
  try {
    await prisma.$connect();
    await Promise.all(
      Array.from({ length: Math.max(CONNECTION_LIMIT, 1) }, () => prisma.$queryRaw`SELECT 1`),
    );
    console.log(`[db] pool warm (${CONNECTION_LIMIT} sessions)`);
  } catch (e: any) {
    console.error('[db] pool warm-up failed (will retry on demand):', e?.message?.slice(0, 120) || e);
  }
  if (HEARTBEAT_SEC > 0 && !heartbeatOn) {
    heartbeatOn = true;
    const beat = async () => {
      try {
        await Promise.all(
          Array.from({ length: Math.max(CONNECTION_LIMIT, 1) }, () => prisma.$queryRaw`SELECT 1`),
        );
      } catch { /* a failed beat just means the next one retries */ }
    };
    const t = setInterval(beat, HEARTBEAT_SEC * 1000);
    (t as any).unref?.();
  }
}
