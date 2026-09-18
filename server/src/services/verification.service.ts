import { prisma } from '../config/prisma';
import { publish } from '../config/bus';
import { invalidateUser } from '../utils/user-cache';

/**
 * Student-ID verification — HUMAN-ONLY by product decision.
 *
 * Flow: student submits a photo of their college ID → it lands in the
 * moderator queue for their college → a moderator approves or rejects.
 * No automation decides anything. Simple, explainable, and impossible to
 * fool with a generated card.
 *
 * PRIVACY RULES:
 * - The ID image lives only until a decision is reached, then it is erased.
 *   A pending review keeps the bytes — the moderator needs to see the ID.
 * - The image never leaves the server except to college-scoped moderators
 *   via the authenticated review endpoint.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export class VerificationService {
  /** Submit an ID photo → straight to the college's moderator queue. */
  async submit(userId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      const e: any = new Error('Only JPG, PNG, WebP or HEIC images are allowed'); e.status = 400; throw e;
    }
    if (file.size > MAX_BYTES) {
      const e: any = new Error('Image must be under 8 MB'); e.status = 400; throw e;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true, verificationStatus: true },
    });
    if (!user?.collegeId) {
      const e: any = new Error('Select your college before verifying'); e.status = 400; throw e;
    }
    if (user.verificationStatus === 'VERIFIED') {
      const e: any = new Error('You are already verified'); e.status = 400; throw e;
    }

    // Replace any prior pending attempt (latest photo wins)
    await prisma.idVerification.deleteMany({ where: { userId, status: 'PENDING' } });

    const record = await prisma.idVerification.create({
      data: { userId, imageData: file.buffer, mimeType: file.mimetype, status: 'PENDING' },
    });

    await prisma.user.update({ where: { id: userId }, data: { verificationStatus: 'PENDING' } });
    invalidateUser(userId); // the verification gate reads this flag per request

    return { id: record.id, status: 'PENDING' as const };
  }

  /**
   * Resolve a verification. The image bytes are ALWAYS deleted here — this is
   * the single funnel every human decision goes through.
   */
  async resolve(recordId: string, userStatus: 'VERIFIED' | 'PENDING' | 'REJECTED', reason: string, decidedBy: string, userId: string, recordStatus: 'VERIFIED' | 'REJECTED' | 'PENDING' = userStatus === 'PENDING' ? 'PENDING' : userStatus) {
    const record = await prisma.idVerification.findUnique({ where: { id: recordId } });
    if (!record) return;

    await prisma.$transaction([
      prisma.idVerification.update({
        where: { id: recordId },
        data: {
          status: recordStatus,
          autoReason: reason,
          decidedBy,
          decidedAt: recordStatus === 'PENDING' ? null : new Date(),
          // PRIVACY: bytes are erased only at a FINAL decision (verify/reject).
          imageData: recordStatus === 'PENDING' ? undefined : null,
          mimeType: recordStatus === 'PENDING' ? record.mimeType : '',
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          verificationStatus: userStatus,
          // keep the legacy boolean flag in lockstep with the status field
          isVerified: userStatus === 'VERIFIED' ? true : userStatus === 'REJECTED' ? false : undefined,
        },
      }),
    ]);

    if (recordStatus === 'VERIFIED' || recordStatus === 'REJECTED') {
      publish('notification:new', { userIds: [userId] });
    }
    // Auth gate reads verificationStatus — flip it everywhere immediately.
    invalidateUser(userId);
  }

  /** Where am I in the flow? (image bytes never leave the server) */
  async status(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true, isVerified: true },
    });
    const pending = await prisma.idVerification.findFirst({
      where: { userId, status: 'PENDING' },
      select: { id: true, createdAt: true, autoReason: true },
    });
    const rejected = await prisma.idVerification.findFirst({
      where: { userId, status: 'REJECTED' },
      orderBy: { createdAt: 'desc' },
      select: { autoReason: true, decidedAt: true },
    });
    return {
      status: user?.verificationStatus || 'UNVERIFIED',
      isVerified: !!user?.isVerified,
      pending: pending ? { id: pending.id, submittedAt: pending.createdAt, note: pending.autoReason } : null,
      lastRejection: rejected?.autoReason || null,
    };
  }

  /** Admin queue: pending verifications for the admin's college (image included for human review). */
  async reviewQueue(collegeId: string | null, isSuper: boolean, page = 0, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const where: any = { status: 'PENDING' };
    if (!isSuper && collegeId) where.user = { collegeId };
    const [records, total] = await Promise.all([
      prisma.idVerification.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, displayName: true, email: true, avatarUrl: true, college: { select: { name: true, shortName: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        skip: page * take,
        take,
      }),
      prisma.idVerification.count({ where }),
    ]);
    return {
      total,
      items: records.map((r) => ({
        id: r.id,
        user: r.user,
        submittedAt: r.createdAt,
        autoNote: r.autoReason,
        imageUrl: `/api/verification/${r.id}/image`,
      })),
      hasMore: (page + 1) * take < total,
    };
  }

  /** The review image itself — admin-only, college-scoped. */
  async reviewImage(recordId: string, viewerCollegeId: string | null, isSuper: boolean) {
    const record = await prisma.idVerification.findUnique({
      where: { id: recordId },
      include: { user: { select: { collegeId: true } } },
    });
    if (!record || !record.imageData) return null;
    if (!isSuper && viewerCollegeId && record.user.collegeId !== viewerCollegeId) return null;
    return { data: Buffer.from(record.imageData), mime: record.mimeType || 'image/png' };
  }

  /** Human decision: approve or reject. Goes through the same privacy funnel. */
  async humanDecision(recordId: string, adminId: string, approve: boolean, viewerCollegeId: string | null, isSuper: boolean) {
    const record = await prisma.idVerification.findUnique({
      where: { id: recordId },
      include: { user: { select: { collegeId: true } } },
    });
    if (!record) { const e: any = new Error('Verification not found'); e.status = 404; throw e; }
    if (!isSuper && viewerCollegeId && record.user.collegeId !== viewerCollegeId) {
      const e: any = new Error('Verification not found'); e.status = 404; throw e;
    }
    if (record.status !== 'PENDING') { const e: any = new Error('Already decided'); e.status = 400; throw e; }

    await this.resolve(
      recordId,
      approve ? 'VERIFIED' : 'REJECTED',
      approve ? 'Approved by moderator' : 'Rejected by moderator — submit a clearer photo of your ID.',
      `admin:${adminId}`,
      record.userId,
    );
    return { decided: approve ? 'VERIFIED' : 'REJECTED' };
  }
}
