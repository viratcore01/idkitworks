import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { TX_OPTIONS } from '../config/prisma';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';
import { isPlausibleImage, imageDimensions, MIN_PHOTO_LONG_SIDE } from '../utils/image-validation';
import {
  isStorageConfigured,
  photoStoragePath,
  uploadPhotoToStorage,
  getSignedPhotoUrl,
  deletePhotoFromStorage,
  PHOTO_URL_TTL_SEC,
} from '../config/storage';
import { isUploadsEnabled } from '../config/cost-guard';

/** Max 4 photos per user: slot 0 = profile pic, slots 1-3 = gallery. */
const MAX_PHOTOS = 4;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * POST /users/me/photos  (multipart: photo, slot)
 * Upserts the photo in the given slot. Slot 0 also becomes the profile picture.
 *
 * Storage-first: uploads bytes to Supabase Storage (private bucket) and stores
 * only `storagePath` in Postgres. Falls back to legacy DB bytes when Storage
 * env is missing or the upload fails — so deploys without the new env vars
 * keep working and the migration can run at any time.
 */
export async function uploadPhoto(req: AuthRequest, res: Response) {
  try {
    // ── R2 cost guard: pause NEW uploads at 80% of the free cap ──
    // Feed/chat/matching keep working; only media uploads 503 until the
    // usage checker flips the flag back (config/cost-guard.ts +
    // scripts/check-r2-usage.ts). Fails open if the flag is unreadable.
    if (!(await isUploadsEnabled())) {
      return res.status(503).json({ error: 'Uploads temporarily paused — service at capacity.' });
    }
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No photo provided' });
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Only JPG, PNG, WebP or GIF images are allowed' });
    }
    if (file.size > MAX_BYTES) return res.status(400).json({ error: 'Image must be under 5 MB' });
    // Magic-byte check: a renamed executable with mimetype image/png dies here.
    if (!isPlausibleImage(file.buffer, file.mimetype)) {
      return res.status(400).json({ error: 'File is not a valid image' });
    }
    // Resolution floor: deck cards render ~400px wide, so anything smaller
    // upscales into blur. Retake with a larger photo instead of shipping mush.
    const dims = imageDimensions(file.buffer, file.mimetype);
    if (dims && Math.max(dims.w, dims.h) < MIN_PHOTO_LONG_SIDE) {
      return res.status(400).json({ error: `Photo is too small (${dims.w}×${dims.h}) — use one at least ${MIN_PHOTO_LONG_SIDE}px on its long side` });
    }

    const slot = Math.min(Math.max(parseInt(req.body?.slot, 10) || 0, 0), MAX_PHOTOS - 1);
    const userId = req.user!.id;

    // Pre-generate the id so the storage path is deterministic: <userId>/<photoId>.
    // Replacing a slot deletes the old row AND its storage object (see below).
    const photoId = randomUUID();
    const storagePath = photoStoragePath(userId, photoId);

    // Remember the old slot's storage object so we can clean it AFTER the
    // DB transaction commits (never delete before — a failed tx would orphan).
    const oldSlotPhotos = await prisma.userPhoto.findMany({
      where: { userId, slot },
      select: { id: true, storagePath: true },
    });

    let useStorage = false;
    if (isStorageConfigured()) {
      try {
        await uploadPhotoToStorage(storagePath, file.buffer, file.mimetype);
        useStorage = true;
      } catch (e: any) {
        console.error('[photo] storage upload failed, falling back to DB bytes:', e?.message || e);
      }
    }

    const photo = await prisma.$transaction(async (tx) => {
      // One photo per slot — replacing removes the old one
      await tx.userPhoto.deleteMany({ where: { userId, slot } });
      const created = await tx.userPhoto.create({
        data: useStorage
          ? { id: photoId, userId, slot, data: null, storagePath, mimeType: file.mimetype }
          : { id: photoId, userId, slot, data: file.buffer, storagePath: null, mimeType: file.mimetype },
      });
      if (slot === 0) {
        await tx.user.update({ where: { id: userId }, data: { avatarPhotoId: created.id } });
      }
      return created;
    // Bulk INSERT of up to 8 MB of image bytes (the legacy Postgres-bytes path
    // still runs whenever Storage isn't configured) — one slow write against
    // Prisma's 5s default, which is why uploads intermittently failed at
    // "Something went wrong" instead of reporting a real error.
    }, TX_OPTIONS);

    // Best-effort cleanup of replaced storage objects (old row is already gone).
    for (const old of oldSlotPhotos) {
      if (old.storagePath) deletePhotoFromStorage(old.storagePath).catch(() => {});
    }

    res.status(201).json({ id: photo.id, slot: photo.slot });
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/**
 * GET /users/photo-token — a LONG-LIVED token (30d) used only to serve photos.
 *
 * WHY THIS EXISTS: <img> tags can't set Authorization headers, and they also
 * can't refresh a token. Serving photos with the 15-minute access token meant
 * every image in the app silently broke 15 minutes after login — the browser
 * kept rendering the dead URL and the UI showed "image not available". This
 * dedicated token outlives the session's idle gaps; the client stores it and
 * embeds it as ?pt= on every photo URL.
 */
export async function issuePhotoToken(req: AuthRequest, res: Response) {
  const u = req.user!;
  const token = jwt.sign({ userId: u.id, purpose: 'photo' }, env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
}

/**
 * DELETE /users/me/photos/:photoId — owner only. If it was the profile pic,
 * that pointer is cleared (avatarColor fallback takes over).
 */
export async function deletePhoto(req: AuthRequest, res: Response) {
  try {
    const photoId = req.params.photoId as string;
    const photo = await prisma.userPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    await prisma.$transaction([
      prisma.userPhoto.delete({ where: { id: photoId } }),
      ...(photo.slot === 0
        ? [prisma.user.updateMany({ where: { id: photo.userId, avatarPhotoId: photoId }, data: { avatarPhotoId: null } })]
        : []),
    ]);
    if (photo.storagePath) deletePhotoFromStorage(photo.storagePath).catch(() => {});
    res.json({ deleted: true });
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/**
 * GET /users/photos/:photoId — authenticated + same-college only:
 * a photo from another college's student is as invisible as their profile.
 *
 * Storage path (new): college check via a cheap metadata-only query (no bytes),
 * then 302 redirect to a short-lived signed Storage URL. Bytes never touch Render.
 * Legacy path (pre-migration rows): serves DB bytes with 1-year immutable caching.
 * Client URLs are unchanged — <img> tags follow the redirect transparently.
 */
export async function getPhoto(req: AuthRequest, res: Response) {
  try {
    const photoId = req.params.photoId as string;

    // 304 fast-path without any DB hit beyond metadata: photo rows are immutable
    // (replace = new id), so If-None-Match on the id is safe for both paths.
    const tag = `"${photoId}"`;
    if (req.headers['if-none-match'] === tag) return res.status(304).end();

    // Metadata-only query — NEVER select the legacy `data` bytes here.
    // (The old code fetched megabytes on every avatar view just to check college.)
    const meta = await prisma.userPhoto.findUnique({
      where: { id: photoId },
      select: {
        id: true,
        userId: true,
        slot: true,
        mimeType: true,
        storagePath: true,
        user: { select: { collegeId: true, isActive: true } },
      },
    });
    if (!meta || !meta.user.isActive) return res.status(404).json({ error: 'Photo not found' });

    // PRODUCT RULE: college-only visibility — also allow the owner themselves
    // (they may be mid-setup without a college yet). A viewer WITHOUT a
    // college sees nothing except their own photos.
    const isOwner = meta.userId === req.user!.id;
    if (!isOwner) {
      if (!req.user!.collegeId || !meta.user.collegeId || meta.user.collegeId !== req.user!.collegeId) {
        return res.status(404).json({ error: 'Photo not found' });
      }
    }

    // ── New path: redirect to a signed Storage URL ──
    if (meta.storagePath && isStorageConfigured()) {
      try {
        const signedUrl = await getSignedPhotoUrl(meta.storagePath);
        res.setHeader('ETag', tag);
        // Cache the redirect just under the URL TTL — repeat views cost zero.
        res.setHeader('Cache-Control', `private, max-age=${Math.max(PHOTO_URL_TTL_SEC - 60, 60)}`);
        return res.redirect(302, signedUrl);
      } catch (e: any) {
        console.error('[photo] sign failed, falling back to legacy bytes:', e?.message || e);
        // fall through to legacy bytes below (migration rows keep `data`)
      }
    }

    // ── Legacy path: serve DB bytes (only for pre-migration rows) ──
    const legacy = await prisma.userPhoto.findUnique({
      where: { id: photoId },
      select: { data: true, mimeType: true },
    });
    if (!legacy?.data) return res.status(404).json({ error: 'Photo not found' });

    res.setHeader('Content-Type', legacy.mimeType);
    // Photo rows are immutable: replacing a picture deletes the row and mints
    // a NEW id, so a URL is forever the same bytes. Cache it for a year —
    // every avatar in every feed/chat/deck after the first view costs zero.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', tag);
    res.send(Buffer.from(legacy.data));
  } catch (error: any) {
    sendError(res, error, 400);
  }
}
