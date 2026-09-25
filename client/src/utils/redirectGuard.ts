/**
 * Redirect-cycle breaker.
 *
 * "Throttling navigation to prevent the browser from hanging" is Chrome
 * stepping in when client code navigates too fast — the signature of a
 * redirect loop between route guards. The old build shipped such a loop for
 * one specific account shape; the tab died white. This guard makes the loop
 * impossible: too many client-side navigations in a short window means we
 * are circling, so we stop, clear any state that could be feeding the loop,
 * and land the user somewhere definitively safe (login, signed out) with an
 * explanation instead of a hung tab.
 */

const WINDOW_MS = 3000;
const MAX_NAVS = 8;

let timestamps: number[] = [];
let trippedAt = 0;

export function recordNavigation(): void {
  const now = Date.now();
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  if (timestamps.length >= MAX_NAVS && !trippedAt) {
    trippedAt = now;
  }
}

/** True once, for the 10s window after the guard trips. */
export function cycleTripped(): boolean {
  if (!trippedAt) return false;
  if (Date.now() - trippedAt > 10000) {
    trippedAt = 0;
    timestamps = [];
    return false;
  }
  return true;
}

export function resetCycleGuard(): void {
  trippedAt = 0;
  timestamps = [];
}
