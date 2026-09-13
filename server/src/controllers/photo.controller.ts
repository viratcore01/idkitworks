import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

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
    const photo = await prisma.userPhoto.findUnique({
      where: { id: req.params.photoId as string },
      include: { user: { select: { collegeId: true, isActive: true } } },
    });
    if (!photo || !photo.user.isActive) return res.status(404).json({ error: 'Photo not found' });

    // PRODUCT RULE: college-only visibility — also allow the owner themselves
    // (they may be mid-setup without a college yet).
    const sameCollege = !req.user!.collegeId || photo.user.collegeId === req.user!.collegeId;
    const isOwner = photo.userId === req.user!.id;
    if (!sameCollege && !isOwner) return res.status(404).json({ error: 'Photo not found' });

    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(photo.data));
  } catch (error: any) {
    sendError(res, error, 400);
  }
}
