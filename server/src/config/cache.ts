/**
 * Zero-config read cache for the two hottest reads: the swipe deck and the
 * feed's first page. Single Render free instance → in-memory is strictly
 * faster than an external Redis hop (0ms vs 20-80ms TLS round-trip) and needs
 * no signup, no card, no new env vars.
 *
 * DESIGN:
 * - LRU-ish + TTL + hard entry bound (safe on 512 MB).
 * - Tag-based group invalidation: deck keys carry `deck:{userId}`,
 *   feed keys carry `feed:college:{collegeId}` (+ per-user tag for
 *   actor-only busts). One tag drop beats tracking individual keys.
 * - Deck keys embed a fingerprint of everything that changes the deck
 *   (prefs, goals, interests, photo count) — filter edits and photo uploads
 *   change the KEY, so they need no explicit invalidation.
 * - Contract: only cache finalized response JSON (never Prisma models with
 *   Buffers), and only set() after a successful query — errors never cache.
 *
 * UPGRADE PATH (when multi-instance / ~10k concurrent per SCALING.md):
 * swap the Map backend for Upstash Redis behind these same functions —
 * call sites stay untouched.
 */

interface Entry {
  value: unknown;
  expires: number;
}

const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 1000);
export const DECK_TTL_SEC = Number(process.env.CACHE_DECK_TTL_SEC || 45);
export const FEED_TTL_SEC = Number(process.env.CACHE_FEED_TTL_SEC || 25);

const store = new Map<string, Entry>();
const tagIndex = new Map<string, Set<string>>(); // tag → keys
const keyTags = new Map<string, Set<string>>(); // key → tags (for cleanup)

function evictIfFull(): void {
  if (store.size < MAX_ENTRIES) return;
  // Oldest-inserted first (Map preserves insertion order).
  const oldest = store.keys().next().value as string | undefined;
  if (oldest) del(oldest);
}

function untag(key: string): void {
  const tags = keyTags.get(key);
  if (!tags) return;
  for (const t of tags) {
    const set = tagIndex.get(t);
    if (set) {
      set.delete(key);
      if (set.size === 0) tagIndex.delete(t);
    }
  }
  keyTags.delete(key);
}

export function get<T = any>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    del(key);
    return null;
  }
  return hit.value as T;
}

export function set(key: string, value: unknown, ttlSec: number, tags: string[] = []): void {
  evictIfFull();
  untag(key);
  store.set(key, { value, expires: Date.now() + ttlSec * 1000 });
  if (tags.length) {
    keyTags.set(key, new Set(tags));
    for (const t of tags) {
      if (!tagIndex.has(t)) tagIndex.set(t, new Set());
      tagIndex.get(t)!.add(key);
    }
  }
}

export function del(key: string): void {
  store.delete(key);
  untag(key);
}

/** Drop every key carrying a tag. Returns the number of keys dropped. */
export function invalidateTag(tag: string): number {
  const keys = tagIndex.get(tag);
  if (!keys || keys.size === 0) return 0;
  const n = keys.size;
  for (const k of [...keys]) del(k);
  return n;
}

// ── Domain helpers ──

/** Short non-crypto hash to keep cache keys bounded. */
export function fingerprint(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => String(p ?? '')).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const deckTag = (userId: string): string => `deck:${userId}`;
export const feedCollegeTag = (collegeId: string): string => `feed:college:${collegeId}`;
export const feedUserTag = (userId: string): string => `feed:user:${userId}`;

/** Bust a viewer's deck (call after like/pass/rewind/unmatch/block). */
export function invalidateDeckForUser(userId: string): void {
  invalidateTag(deckTag(userId));
}

/** Bust everyone's cached first-page feed in a college (new/edited/deleted post). */
export function invalidateCollegeFeed(collegeId: string): void {
  invalidateTag(feedCollegeTag(collegeId));
}

/** Bust one user's cached feed (their own like/save changed per-user flags). */
export function invalidateUserFeed(userId: string): void {
  invalidateTag(feedUserTag(userId));
}

/** For logs/debugging only. */
export function cacheStats(): { entries: number; tags: number } {
  return { entries: store.size, tags: tagIndex.size };
}
