import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Photo storage adapter — driver-selectable: Supabase Storage or Cloudflare R2.
 *
 * The whole app talks to four functions (upload / sign / delete / configured?).
 * Call sites (photo.controller, migrate-photos-to-storage script) are untouched
 * by a driver swap: same keys (`<userId>/<photoId>`), same signed-URL semantics
 * (short-lived, single-object), same graceful "not configured" fallback to the
 * legacy Postgres-bytes path.
 *
 * DRIVER SELECTION:
 *   R2 (self-hosted stack):  STORAGE_DRIVER=r2 + R2_ACCOUNT_ID,
 *                            R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   Supabase (default):      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * INVARIANT (both drivers): bucket is PRIVATE. College-only visibility is
 * enforced in photo.controller.getPhoto BEFORE anything is signed, so bytes
 * never leak cross-college and never flow through the API process.
 */

export const PHOTOS_BUCKET =
  process.env.R2_BUCKET || process.env.SUPABASE_PHOTOS_BUCKET || 'user-photos';

/** Signed-URL TTL for photo redirects. 1h default: browsers cache the 302 for
 * ~59 min, so deck scrolling costs one sign+redirect per photo per hour —
 * not per 4 minutes. Safe at 1h: URLs are college-walled (auth-checked before
 * signing) and single-photo scoped. Lower only if link-leak is a concern. */
export const PHOTO_URL_TTL_SEC = Number(process.env.PHOTO_URL_TTL_SEC || 3600);

/** Which driver is active — log at boot so misconfig is visible, not silent. */
export const STORAGE_DRIVER: 'r2' | 'supabase' =
  (process.env.STORAGE_DRIVER as 'r2' | 'supabase') ||
  (process.env.R2_ACCOUNT_ID ? 'r2' : 'supabase');

// ── Driver clients (lazy singletons) ─────────────────────────
let supabase: SupabaseClient | null = null;
let s3: S3Client | null = null;

function getSupabase(): SupabaseClient | null {
  if (STORAGE_DRIVER !== 'supabase') return null;
  if (!isStorageConfigured()) return null;
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

function getS3(): S3Client | null {
  if (STORAGE_DRIVER !== 'r2') return null;
  if (!s3) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Storage driver r2 selected but R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY missing',
      );
    }
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return s3;
}

// ── Configured checks (per driver, same contract as before) ──
export function isStorageConfigured(): boolean {
  if (STORAGE_DRIVER === 'r2') {
    return (
      !!process.env.R2_ACCOUNT_ID &&
      !!process.env.R2_ACCESS_KEY_ID &&
      !!process.env.R2_SECRET_ACCESS_KEY
    );
  }
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// ── Public adapter API — identical signatures to the original module ──

export function photoStoragePath(userId: string, photoId: string): string {
  return `${userId}/${photoId}`;
}

export async function uploadPhotoToStorage(
  path: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  if (STORAGE_DRIVER === 'r2') {
    const client = getS3();
    if (!client) throw new Error('Storage not configured (R2_* env missing)');
    await client.send(
      new PutObjectCommand({
        Bucket: PHOTOS_BUCKET,
        Key: path,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return;
  }
  const sb = getSupabase();
  if (!sb) throw new Error('Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
  const { error } = await sb.storage.from(PHOTOS_BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

export async function getSignedPhotoUrl(path: string, ttlSec = PHOTO_URL_TTL_SEC): Promise<string> {
  if (STORAGE_DRIVER === 'r2') {
    const client = getS3();
    if (!client) throw new Error('Storage not configured (R2_* env missing)');
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: PHOTOS_BUCKET, Key: path }),
      { expiresIn: Math.max(1, Math.floor(ttlSec)) },
    );
  }
  const sb = getSupabase();
  if (!sb) throw new Error('Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
  const { data, error } = await sb.storage.from(PHOTOS_BUCKET).createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) throw new Error(`Sign failed: ${error?.message || 'no url'}`);
  return data.signedUrl;
}

export async function deletePhotoFromStorage(path: string): Promise<void> {
  if (STORAGE_DRIVER === 'r2') {
    const client = getS3();
    if (!client) return; // nothing to clean when storage was never configured
    try {
      await client.send(new DeleteObjectCommand({ Bucket: PHOTOS_BUCKET, Key: path }));
    } catch (e: any) {
      console.error('[storage] delete failed:', path, e?.message || e);
    }
    return;
  }
  const sb = getSupabase();
  if (!sb) return; // nothing to clean when storage was never configured
  const { error } = await sb.storage.from(PHOTOS_BUCKET).remove([path]);
  if (error) console.error('[storage] delete failed:', path, error.message);
}
