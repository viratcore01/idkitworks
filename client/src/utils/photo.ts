/**
 * Photo URL resolution for <img> tags.
 *
 * WHY NOT THE ACCESS TOKEN: <img> tags can't send Authorization headers AND
 * they can't refresh an expired token. Embedding the 15-minute access token
 * as a query param made every photo in the app silently break 15 minutes
 * after login ("image not available"). Photos therefore use a dedicated
 * LONG-LIVED token (`skola_pt` (legacy key kept so users stay logged in), 30 days) fetched once after login and stored
 * in localStorage. If it's ever missing or rejected, we fetch a fresh one
 * once and retry — never an infinite loop.
 */
import { useEffect, useState } from 'react';

let version = 0;
const listeners = new Set<() => void>();

/** Change the photo token → every rendered photo URL changes → <img> reloads. */
function rotate(): void {
  version += 1;
  listeners.forEach((l) => l());
}

export function onPhotoTokenChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPhotoToken(): string {
  return localStorage.getItem('skola_pt') || '';
}

export function setPhotoToken(t: string): void {
  if (t && t !== getPhotoToken()) {
    localStorage.setItem('skola_pt', t);
    rotate();
  }
}

/** One retry per URL: fetch a fresh token, then let listeners re-render. */
const retrying = new Set<string>();
export async function refreshTokenFor(url: string): Promise<boolean> {
  if (retrying.has(url)) return false;
  retrying.add(url);
  try {
    const base = import.meta.env.VITE_API_URL
      ? `${String(import.meta.env.VITE_API_URL).replace(/\/+$/, '')}/api`
      : '/api';
    const token = localStorage.getItem('accessToken') || '';
    if (!token) return false;
    const r = await fetch(`${base}/users/photo-token`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const { token: pt } = await r.json();
    if (pt) {
      setPhotoToken(pt);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    retrying.delete(url);
  }
}

/** Build the authenticated URL for a stored user photo (for <img> tags). */
export function photoSrc(photoId?: string | null): string | null {
  if (!photoId) return null;
  const base = import.meta.env.VITE_API_URL
    ? `${String(import.meta.env.VITE_API_URL).replace(/\/+$/, '')}/api`
    : '/api';
  const pt = getPhotoToken();
  return `${base}/users/photos/${photoId}?pt=${encodeURIComponent(pt)}&v=${version}`;
}

/** First stored photo wins over any external avatarUrl. */
export function bestAvatarSrc(obj?: { avatarPhotoId?: string | null; avatarUrl?: string | null } | null): string | null {
  if (!obj) return null;
  return photoSrc(obj.avatarPhotoId) || obj.avatarUrl || null;
}

/** Subscribe components to token rotations so already-rendered URLs refresh. */
export function usePhotoVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => onPhotoTokenChange(() => setV(version)), []);
  return v;
}

/** Called after login/signup/session-restore: guarantees a photo token exists. */
export async function ensurePhotoToken(): Promise<void> {
  if (getPhotoToken()) return;
  await refreshTokenFor('bootstrap');
}
