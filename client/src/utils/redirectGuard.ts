/**
 * Redirect-cycle breaker.
 *
 * "Throttling navigation to prevent the browser from hanging" is Chrome
 * stepping in when client code navigates too fast — the signature of a
 * redirect loop between route guards. This guard makes a loop a dead end
 * instead of a hung white tab.
 *
 * Detection: a real loop REVISITS paths. Legitimate boot chains (landing →
 * login → wizard, or verify → signup) never return to a path they just left,
 * so the loop signature is "the same path seen 3+ times inside the window".
 * Counting raw navigations (the first version) false-positived on long
 * legitimate boot chains that traverse several guarded routes at once.
 */

const WINDOW_MS = 3000;
const REVISIT_THRESHOLD = 3;

let events: Array<{ path: string; at: number }> = [];
let trippedAt = 0;

export function recordNavigation(path: string): void {
  const now = Date.now();
  events = events.filter((e) => now - e.at < WINDOW_MS);
  events.push({ path, at: now });
  const visits = events.filter((e) => e.path === path).length;
  if (visits >= REVISIT_THRESHOLD && !trippedAt) {
    trippedAt = now;
  }
}

/** True once, for the 10s window after the guard trips. */
export function cycleTripped(): boolean {
  if (!trippedAt) return false;
  if (Date.now() - trippedAt > 10000) {
    trippedAt = 0;
    events = [];
    return false;
  }
  return true;
}

export function resetCycleGuard(): void {
  trippedAt = 0;
  events = [];
}
