import api from './api';

export interface UsernameAvailability {
  username: string;
  available: boolean;
  reason?: 'invalid' | 'reserved' | 'taken';
  /** Human message; present only when available is false. */
  error?: string;
}

/**
 * Live handle availability for the signup wizard.
 *
 * ADVISORY ONLY — the DB's unique index is still the truth at save time, so a
 * handle can pass this check and still lose a race (it then gets a clean 409).
 * The caller debounces and ignores stale answers; the server rate-limits it.
 */
export async function checkUsername(username: string): Promise<UsernameAvailability> {
  const { data } = await api.get<UsernameAvailability>('/auth/username-available', {
    params: { username },
  });
  return data;
}
