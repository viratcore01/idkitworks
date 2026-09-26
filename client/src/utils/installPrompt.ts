/**
 * Capture the PWA install prompt the moment the browser offers it.
 *
 * `beforeinstallprompt` can fire BEFORE React mounts (it races the bundle),
 * so a component-level listener misses it and install silently degrades to
 * a instructions box. This module registers its listener at import time —
 * main.tsx imports it first, before anything renders — and parks the event
 * until a button actually needs it.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const availabilityListeners = new Set<(available: boolean) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // suppress the mini-infobar; we own the UX
    deferred = e as BeforeInstallPromptEvent;
    availabilityListeners.forEach((l) => l(true));
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    availabilityListeners.forEach((l) => l(false));
  });
}

/** Is a native install prompt parked and ready to fire right now? */
export function isInstallAvailable(): boolean {
  return deferred !== null;
}

/**
 * Fire the native browser install dialog. Returns the user's choice, or
 * 'unavailable' if no prompt was ever offered (then the caller shows its
 * fallback UI).
 *
 * NOTE: a captured event is single-use per spec — after prompt() the
 * browser voids it and re-fires `beforeinstallprompt` on a later
 * navigation if the site is still installable. So we clear `deferred`
 * and notify listeners (button hides) instead of letting a second click
 * fall through to a "Add to Home screen" shortcut (which opens with a
 * URL bar instead of a real standalone WebAPK).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const event = deferred;
  deferred = null;
  availabilityListeners.forEach((l) => l(false));
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    // The parked event was voided (e.g. page context changed) — treat as
    // "not ready", not as a dismissal, so the caller waits for a fresh event.
    return 'unavailable';
  }
}

/** Subscribe to availability changes; returns an unsubscribe function. */
export function onInstallAvailability(cb: (available: boolean) => void): () => void {
  availabilityListeners.add(cb);
  if (deferred) cb(true);
  return () => {
    availabilityListeners.delete(cb);
  };
}
