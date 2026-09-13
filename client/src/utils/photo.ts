/** Build the authenticated URL for a stored user photo (for <img> tags). */
export function photoSrc(photoId?: string | null): string | null {
  if (!photoId) return null;
  const base = import.meta.env.VITE_API_URL
    ? `${String(import.meta.env.VITE_API_URL).replace(/\/+$/, '')}/api`
    : '/api';
  const token = localStorage.getItem('accessToken') || '';
  return `${base}/users/photos/${photoId}?t=${encodeURIComponent(token)}`;
}

/** First stored photo wins over any external avatarUrl. */
export function bestAvatarSrc(obj?: { avatarPhotoId?: string | null; avatarUrl?: string | null } | null): string | null {
  if (!obj) return null;
  return photoSrc(obj.avatarPhotoId) || obj.avatarUrl || null;
}
