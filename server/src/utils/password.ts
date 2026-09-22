import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * True when the stored hash is a real user-chosen password (bcrypt) rather
 * than a placeholder. Google-created accounts park a random UUID secret in
 * passwordHash (NOT NULL column) — those users have no password to CHANGE,
 * only one to SET (via fresh Google verification). Deleted rows carry a
 * DELETED_ marker, also correctly "no password".
 */
export function isPasswordSet(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && hash.startsWith('$2');
}
