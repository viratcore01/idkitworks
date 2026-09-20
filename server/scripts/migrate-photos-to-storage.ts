/**
 * One-time migration: Postgres `user_photos.data` (bytea) → Supabase Storage.
 *
 * SAFE BY DESIGN:
 * - Idempotent: skips rows that already have `storagePath`. Re-run any time.
 * - Non-destructive by default: keeps `data` after upload so rollback is just
 *   `storagePath = NULL`. Pass --reclaim-space ONLY after verifying a sample
 *   of redirected images in the app (it NULLs `data` to shrink Postgres).
 * - Resumable + bounded: --limit + small batches, works on 512 MB Render.
 * - Dry-run first: --dry-run counts and validates without writing anything.
 * - College rule untouched: bucket is private; serving still signs URLs only
 *   after the same-college check in photo.controller.getPhoto.
 *
 * PREREQS:
 *   1. Supabase dashboard → Storage → New bucket: `user-photos`, PRIVATE.
 *   2. server/.env (or Render env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *      (Project Settings → API → service_role, server-only, never VITE_*).
 *   3. Schema pushed: `npm run db:push` (adds nullable `data` + `storage_path`).
 *
 * USAGE:
 *   npx tsx scripts/migrate-photos-to-storage.ts --dry-run
 *   npx tsx scripts/migrate-photos-to-storage.ts --limit=50
 *   npx tsx scripts/migrate-photos-to-storage.ts
 *   npx tsx scripts/migrate-photos-to-storage.ts --reclaim-space --limit=200
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  isStorageConfigured,
  photoStoragePath,
  uploadPhotoToStorage,
  getSignedPhotoUrl,
  PHOTOS_BUCKET,
} from '../src/config/storage';

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const getArg = (name: string): string | undefined => {
  const hit = [...args].find((a) => a.startsWith(`${name}=`));
  return hit?.split('=').slice(1).join('=');
};
const DRY_RUN = args.has('--dry-run');
const RECLAIM = args.has('--reclaim-space');
const LIMIT = Number(getArg('--limit') || 0) || Infinity;
const BATCH = 10;

async function main() {
  if (!isStorageConfigured()) {
    console.error('❌ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }
  console.log(`→ Bucket: ${PHOTOS_BUCKET} | dryRun=${DRY_RUN} reclaim=${RECLAIM} limit=${LIMIT === Infinity ? '∞' : LIMIT}`);

  const totalPending = await prisma.userPhoto.count({ where: { storagePath: null } });
  console.log(`→ Rows without storagePath: ${totalPending}`);
  if (totalPending === 0) {
    console.log('✅ Nothing to migrate.');
    await prisma.$disconnect();
    return;
  }
  if (DRY_RUN) {
    const withBytes = await prisma.userPhoto.count({
      where: { storagePath: null, NOT: { data: null } },
    });
    console.log(`[dry-run] ${withBytes} rows have bytes ready to upload. No writes performed.`);
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  let failed = 0;
  let cursor: string | undefined;

  while (done + failed < LIMIT) {
    const rows = await prisma.userPhoto.findMany({
      where: { storagePath: null },
      take: Math.min(BATCH, LIMIT - done - failed),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, userId: true, data: true, mimeType: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      cursor = row.id;
      if (!row.data) {
        console.warn(`[skip] ${row.id}: no bytes and no storagePath — left for manual review`);
        continue;
      }
      const path = photoStoragePath(row.userId, row.id);
      try {
        await uploadPhotoToStorage(path, Buffer.from(row.data), row.mimeType);
        // Verify the object is actually signable before pointing the row at it.
        await getSignedPhotoUrl(path, 60);
        await prisma.userPhoto.update({
          where: { id: row.id },
          data: RECLAIM ? { storagePath: path, data: null } : { storagePath: path },
        });
        done++;
        console.log(`[ok ${done}] ${row.id} → ${path}${RECLAIM ? ' (bytes reclaimed)' : ''}`);
      } catch (e: any) {
        failed++;
        console.error(`[fail] ${row.id}: ${e?.message || e}`);
      }
      if (done + failed >= LIMIT) break;
    }
  }

  console.log(`\nDone. uploaded=${done} failed=${failed}`);
  console.log(
    RECLAIM
      ? 'Bytes nulled on migrated rows. Verify images in the app, then check Supabase DB size.'
      : 'Legacy bytes KEPT (safe). After spot-checking redirected images, re-run with --reclaim-space to shrink Postgres.',
  );
  await prisma.$disconnect();
  if (failed > 0) process.exit(2);
}

main().catch(async (e) => {
  console.error('Migration crashed:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
