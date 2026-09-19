import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';
import { isPlausibleImage } from '../utils/image-validation';

/** Max 4 photos per user: slot 0 = profile pic, slots 1-3 = gallery. */
const MAX_PHOTOS = 4;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * POST /users/me/photos  (multipart: photo, slot)
 * Upserts the photo in the given slot. Slot 0 also becomes the profile picture.
 */
export async function uploadPhoto(req: AuthRequest, res: Response) {
  try {
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

    const slot = Math.min(Math.max(parseInt(req.body?.slot, 10) || 0, 0), MAX_PHOTOS - 1);
    const userId = req.user!.id;

    const photo = await prisma.$transaction(async (tx) => {
      // One photo per slot — replacing removes the old one
      await tx.userPhoto.deleteMany({ where: { userId, slot } });
      const created = await tx.userPhoto.create({
        data: { userId, slot, data: file.buffer, mimeType: file.mimetype },
      });
      if (slot === 0) {
        await tx.user.update({ where: { id: userId }, data: { avatarPhotoId: created.id } });
      }
      return created;
    });

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
    res.json({ deleted: true });
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/**
 * GET /users/photos/:photoId — binary image. Authenticated + same-college only:
 * a photo from another college's student is as invisible as their profile.
 */
export async function getPhoto(req: AuthRequest, res: Response) {
  try {
    const photoId = req.params.photoId as string;
    const photo = await prisma.userPhoto.findUnique({
      where: { id: photoId },
      include: { user: { select: { collegeId: true, isActive: true } } },
    });
    if (!photo || !photo.user.isActive) return res.status(404).json({ error: 'Photo not found' });

    // PRODUCT RULE: college-only visibility — also allow the owner themselves
    // (they may be mid-setup without a college yet). A viewer WITHOUT a
    // college sees nothing except their own photos.
    const isOwner = photo.userId === req.user!.id;
    if (!isOwner) {
      if (!req.user!.collegeId || !photo.user.collegeId || photo.user.collegeId !== req.user!.collegeId) {
        return res.status(404).json({ error: 'Photo not found' });
      }
    }

    res.setHeader('Content-Type', photo.mimeType);
    // Photo rows are immutable: replacing a picture deletes the row and mints
    // a NEW id, so a URL is forever the same bytes. Cache it for a year —
    // every avatar in every feed/chat/deck after the first view costs zero.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', `"${photoId}"`);
    res.send(Buffer.from(photo.data));
  } catch (error: any) {
    sendError(res, error, 400);
  }
}
