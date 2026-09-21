import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase Storage (private bucket) for user photos.
 *
 * Zero-cost: lives inside the existing Supabase free project (1 GB free).
 * Bucket MUST be private — college-only visibility is enforced in
 * photo.controller.getPhoto BEFORE we sign anything, so bytes never leak
 * cross-college and never flow through the 512 MB Render instance.
 *
 * Env (server only, never expose to the client):
 *   SUPABASE_URL              https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY service_role key (dashboard → Project Settings → API)
 *   SUPABASE_PHOTOS_BUCKET    defaults to "user-photos"
 */

export const PHOTOS_BUCKET = process.env.SUPABASE_PHOTOS_BUCKET || 'user-photos';
/** Signed-URL TTL for photo redirects. 1h default: browsers cache the 302 for
 * ~59 min, so deck scrolling costs one sign+redirect per photo per hour —
 * not per 4 minutes. Safe at 1h: URLs are college-walled (auth-checked before
 * signing) and single-photo scoped. Lower only if link-leak is a concern. */
export const PHOTO_URL_TTL_SEC = Number(process.env.PHOTO_URL_TTL_SEC || 3600);

let client: SupabaseClient | null = null;

export function isStorageConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function getClient(): SupabaseClient | null {
  if (!isStorageConfigured()) return null;
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function photoStoragePath(userId: string, photoId: string): string {
  return `${userId}/${photoId}`;
}

export async function uploadPhotoToStorage(
  path: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  const sb = getClient();
  if (!sb) throw new Error('Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
  const { error } = await sb.storage.from(PHOTOS_BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

export async function getSignedPhotoUrl(path: string, ttlSec = PHOTO_URL_TTL_SEC): Promise<string> {
  const sb = getClient();
  if (!sb) throw new Error('Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
  const { data, error } = await sb.storage.from(PHOTOS_BUCKET).createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) throw new Error(`Sign failed: ${error?.message || 'no url'}`);
  return data.signedUrl;
}

export async function deletePhotoFromStorage(path: string): Promise<void> {
  const sb = getClient();
  if (!sb) return; // nothing to clean when storage was never configured
  const { error } = await sb.storage.from(PHOTOS_BUCKET).remove([path]);
  if (error) console.error('[storage] delete failed:', path, error.message);
}
