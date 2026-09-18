/**
 * Per-request auth cache.
 *
 * Every API request used to pay a Supabase round-trip just to re-read the
 * same user row in authMiddleware (plus ANOTHER one for every avatar image
 * via photoAuth). On a pooled free-tier Postgres that's 50-200 ms added to
 * every single call — the "okay okay then it starts working" feel.
 *
 * This cache keeps { userId → live user state } in memory for a few seconds.
 * Security is preserved: every mutation that changes auth-relevant state
 * (ban, unban, verification decision, college change, logout-all) calls
 * invalidate() so the very next request sees fresh data. Ban enforcement
 * therefore never waits out the TTL.
 */

const TTL_MS = 30_000;

interface CachedUser {
  isActive: boolean;
  collegeId: string | null;
  verificationStatus: string;
  at: number;
}

const cache = new Map<string, CachedUser>();

export function getCachedUser(userId: string): CachedUser | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return hit;
}

export function setCachedUser(userId: string, data: Omit<CachedUser, 'at'>): void {
  if (cache.size > 5_000) cache.clear(); // hard bound; safety valve
  cache.set(userId, { ...data, at: Date.now() });
}

export function invalidateUser(userId: string): void {
  cache.delete(userId);
}

/** Convenience: cached read-through. Returns null when unknown/stale. */
export async function cachedLiveUser(
  userId: string,
  fetcher: () => Promise<Omit<CachedUser, 'at'> | null>,
): Promise<Omit<CachedUser, 'at'> | null> {
  const hit = getCachedUser(userId);
  if (hit) return hit;
  const fresh = await fetcher();
  if (fresh) setCachedUser(userId, fresh);
  return fresh;
}
