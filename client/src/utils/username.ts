/**
 * Handle rules on the client.
 *
 * Mirrors server/src/utils/username.ts on purpose: the shape and the reserved
 * words are answered locally (instant feedback, no request, no rate limit), and
 * the server only gets asked about the part it alone knows — whether the handle
 * is already claimed. If the two ever disagree the server wins, which is why
 * both are written down in one obvious place per side.
 */

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Same list as the server's — brand/staff/infrastructure words, forever unclaimable. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'skola', 'zoclo', 'support', 'root', 'moderator',
  'official', 'team', 'help', 'security', 'staff', 'system', 'owner', 'founder',
  'mod', 'verify', 'verification', 'billing', 'legal', 'privacy', 'api',
]);

/** As-you-type filter: lowercase, handle-safe characters only, capped length. */
export function sanitizeUsernameInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX);
}

/**
 * Same rule as the server: trailing digits/underscores don't make a reserved
 * word fresh ("admin1", "admin_007") — the skeleton is what a human reads.
 */
export function isReservedUsername(raw: unknown): boolean {
  const username = String(raw ?? '').trim().toLowerCase();
  if (RESERVED_USERNAMES.has(username)) return true;
  const skeleton = username.replace(/[_0-9]+$/, '');
  return skeleton !== username && RESERVED_USERNAMES.has(skeleton);
}

/** Local verdict: what we can decide without the network. */
export type LocalUsernameStatus = 'empty' | 'invalid' | 'reserved' | 'ok';

export function localUsernameStatus(raw: unknown): LocalUsernameStatus {
  const username = String(raw ?? '').trim().toLowerCase();
  if (!username) return 'empty';
  if (isReservedUsername(username)) return 'reserved';
  if (username.length < USERNAME_MIN) return 'invalid';
  if (!USERNAME_PATTERN.test(username)) return 'invalid';
  return 'ok';
}

/** Human message for a locally-broken handle, or null when it is well-formed. */
export function localUsernameError(raw: unknown): string | null {
  switch (localUsernameStatus(raw)) {
    case 'empty':
      return null;
    case 'reserved':
      return 'That username is reserved — pick another';
    case 'invalid':
      return `Use ${USERNAME_MIN}-${USERNAME_MAX} characters: lowercase letters, numbers, underscores`;
    default:
      return null;
  }
}

/** Everything the identity step can be showing under the handle field. */
export type UsernameStatus = 'idle' | LocalUsernameStatus | 'checking' | 'available' | 'taken' | 'unavailable';

export interface UsernameFeedback {
  tone: 'ok' | 'bad' | 'wait';
  text: string;
}

/**
 * The one line under the field. `taken` is the only verdict that comes from the
 * server; `unavailable` means the check itself failed (offline, throttled) and
 * must NOT read as "taken" — the user keeps going and the submit is the truth.
 */
export function usernameFeedback(status: UsernameStatus, raw: string): UsernameFeedback | null {
  switch (status) {
    case 'idle':
      return null;
    case 'empty':
      return null;
    case 'invalid':
      return { tone: 'bad', text: localUsernameError(raw) ?? 'Invalid username' };
    case 'reserved':
      return { tone: 'bad', text: 'That username is reserved — pick another' };
    case 'checking':
      return { tone: 'wait', text: 'Checking availability…' };
    case 'available':
      return { tone: 'ok', text: 'Available' };
    case 'taken':
      return { tone: 'bad', text: 'Already taken — try another' };
    case 'unavailable':
    default:
      return { tone: 'wait', text: "Couldn't check right now — we'll confirm when you continue" };
  }
}

/** Statuses that must block the submit button (server still re-checks on save). */
export function blocksSubmit(status: UsernameStatus): boolean {
  return status === 'invalid' || status === 'reserved' || status === 'taken';
}
