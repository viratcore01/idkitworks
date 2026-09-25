/**
 * Safe storage access for hostile browser settings.
 *
 * Chrome throws SecurityError on EVERY localStorage/sessionStorage touch when
 * site-data blocking is on for the origin — and any such error during module
 * initialization is an instant white screen with no error card, because it
 * kills the bundle before React mounts. Every module that touches storage
 * goes through these wrappers instead of the raw globals, so the app
 * degrades to in-memory storage instead of dying. A private window, a
 * "clear cookies on exit" policy, or a hardened Chrome profile therefore
 * gets a working app (session-scoped only) rather than a blank page.
 *
 * Brave works where Chrome didn't simply because its default shield settings
 * differ — same engine, different storage policy result.
 */

const memory = new Map<string, string>();

function tryStorage(kind: 'local' | 'session'): Storage | null {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    // Probing with a real write/read matters: some browsers hand out the
    // object but throw on first use.
    const k = '__zc_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

const local = tryStorage('local');
const session = tryStorage('session');

export const safeLocalStorage = {
  getItem: (k: string): string | null => {
    try { return local ? local.getItem(k) : (memory.get('l:' + k) ?? null); } catch { return memory.get('l:' + k) ?? null; }
  },
  setItem: (k: string, v: string): void => {
    try { if (local) { local.setItem(k, v); return; } } catch { /* fall through */ }
    memory.set('l:' + k, v);
  },
  removeItem: (k: string): void => {
    try { if (local) { local.removeItem(k); return; } } catch { /* fall through */ }
    memory.delete('l:' + k);
  },
  clear: (): void => {
    try { if (local) { local.clear(); return; } } catch { /* fall through */ }
    memory.clear();
  },
};

export const safeSessionStorage = {
  getItem: (k: string): string | null => {
    try { return session ? session.getItem(k) : (memory.get('s:' + k) ?? null); } catch { return memory.get('s:' + k) ?? null; }
  },
  setItem: (k: string, v: string): void => {
    try { if (session) { session.setItem(k, v); return; } } catch { /* fall through */ }
    memory.set('s:' + k, v);
  },
  removeItem: (k: string): void => {
    try { if (session) { session.removeItem(k); return; } } catch { /* fall through */ }
    memory.delete('s:' + k);
  },
  clear: (): void => {
    try { if (session) { session.clear(); return; } } catch { /* fall through */ }
    for (const key of [...memory.keys()]) if (key.startsWith('s:')) memory.delete(key);
  },
};
