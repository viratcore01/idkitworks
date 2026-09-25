/**
 * Username rules — the ONE definition, shared by every path that mints or
 * validates a handle: the signup wizard (live availability check + submit),
 * the auto-generated Google handles, and anything that reads a username back.
 *
 * Two rules live here because they must never drift apart:
 *
 *  1. SHAPE — 3-20 chars of [a-z0-9_]. The DB also enforces it (and
 *     UNIQUE (LOWER(username)) makes it case-insensitively unique), but a
 *     shape check up front turns a raw P2002 into a friendly 400.
 *
 *  2. RESERVED WORDS — handles are IMMUTABLE once chosen and they sit in
 *     profile URLs, so a claimable "admin"/"support"/"official" is a permanent
 *     impersonation that cannot be taken back. This used to guard only the
 *     Google generator: typed signup checked the character shape and nothing
 *     else, so `admin` was claimable by anyone who typed it. Same list, one
 *     place, both doors.
 */

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * Words that can never be a user handle. Aimed at brand/staff impersonation
 * and infrastructure-sounding names a user could mistake for an official
 * channel.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'skola', 'zoclo', 'support', 'root', 'moderator',
  'official', 'team', 'help', 'security', 'staff', 'system', 'owner', 'founder',
  'mod', 'verify', 'verification', 'billing', 'legal', 'privacy', 'api',
]);

/** Lowercase + trim — the only form we ever compare or store against. */
export function normalizeUsername(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * Is this handle reserved (or reserved-looking)?
 *
 * Trailing digits/underscores do not make a reserved word fresh: "admin1" and
 * "admin_007" read as the same thing to a human, and a handle is permanent, so
 * both are refused. The check strips that decoration and compares the skeleton.
 */
export function isReservedUsername(raw: unknown): boolean {
  const username = normalizeUsername(raw);
  if (RESERVED_USERNAMES.has(username)) return true;
  const skeleton = username.replace(/[_0-9]+$/, '');
  return skeleton !== username && RESERVED_USERNAMES.has(skeleton);
}

/**
 * Human message for a handle that can never be used, or null when the shape is
 * fine. Deliberately returns a message (not a boolean) so the client and the
 * server say the exact same thing.
 */
export function usernameShapeError(raw: unknown): string | null {
  const username = normalizeUsername(raw);
  if (username.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters`;
  if (username.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters`;
  if (!USERNAME_PATTERN.test(username)) return 'Only lowercase letters, numbers and underscores';
  if (isReservedUsername(username)) return 'That username is reserved — pick another';
  return null;
}

/** Why a handle can't be used, when it can't. */
export type UsernameReason = 'invalid' | 'reserved' | 'taken';

export interface UsernameAvailability {
  username: string;
  available: boolean;
  reason?: UsernameReason;
  /** Human message; present only when available is false. */
  error?: string;
}

/**
 * Pure, DB-free half of the availability check: shape and reserved words.
 * The caller only has to ask the database when this says the handle is even
 * eligible (see AuthService.isUsernameAvailable).
 */
export function checkUsernameLocally(raw: unknown): UsernameAvailability {
  const username = normalizeUsername(raw);
  const shape = usernameShapeError(username);
  if (!shape) return { username, available: true };
  return {
    username,
    available: false,
    reason: isReservedUsername(username) ? 'reserved' : 'invalid',
    error: shape,
  };
}
