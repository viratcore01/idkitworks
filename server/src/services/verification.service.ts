import { prisma } from '../config/prisma';
import { publish } from '../config/bus';

/**
 * Student-ID verification chain:
 *   1. Ollama vision (local, free) — if configured and reachable
 *   2. Gemini vision (cheap, fast) — if GEMINI_API_KEY is set
 *   3. Manual review by college admins — always the safety net
 *
 * PRODUCT RULES:
 * - The AI never "detects fakes." It only answers: does this look like a
 *   student ID, and does the text on it match the user's chosen college?
 * - The ID image is deleted the moment a decision is reached (auto or human).
 *   Only the decision + reason remain. Privacy first.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || ''; // e.g. http://localhost:11434
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llava:7b';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export type AutoDecision = 'APPROVED' | 'REJECTED' | 'REVIEW' | 'SKIPPED';

export interface AutoResult {
  decision: AutoDecision;
  confidence: number; // 0..1
  reason: string;
}

function judge(collegeName: string, mentionsCollege: boolean, looksLikeId: boolean): AutoResult {
  if (!looksLikeId) {
    return { decision: 'REVIEW', confidence: 0.3, reason: 'Image does not clearly contain a student ID card.' };
  }
  if (mentionsCollege) {
    return { decision: 'APPROVED', confidence: 0.92, reason: `ID shows ${collegeName}.` };
  }
  // Plausible ID but couldn't confirm the college → human eyes
  return { decision: 'REVIEW', confidence: 0.55, reason: 'ID looks valid but college could not be confirmed automatically.' };
}

function buildPrompt(collegeName: string): string {
  return (
    `You are a student-ID checker for a college-only app. The student claims to attend "${collegeName}". ` +
    'Look at the image and answer strictly in this exact format:\n' +
    'IS_ID: yes|no\n' +
    `COLLEGE_MATCH: yes|no\n` +
    'READABLE_TEXT: <the institution name or text you can read, or "none">' +
    ' Judge only whether the image plausibly contains a student ID card and whether its text mentions the college. ' +
    'Do not judge authenticity or quality beyond readability.'
  );
}

async function ollamaCheck(imageB64: string, mime: string, collegeName: string): Promise<AutoResult | null> {
  if (!OLLAMA_URL) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 45_000);
    const res = await fetch(`${OLLAMA_URL.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: buildPrompt(collegeName),
        images: [imageB64],
        stream: false,
        options: { temperature: 0 },
      }),
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data.response || '';
    const isId = /IS_ID:\s*yes/i.test(text);
    const match = /COLLEGE_MATCH:\s*yes/i.test(text);
    return judge(collegeName, match, isId);
  } catch {
    return null; // fall through to Gemini
  }
}

async function geminiCheck(imageB64: string, mime: string, collegeName: string): Promise<AutoResult | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: buildPrompt(collegeName) },
              { inline_data: { mime_type: mime, data: imageB64 } },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const isId = /IS_ID:\s*yes/i.test(text);
    const match = /COLLEGE_MATCH:\s*yes/i.test(text);
    return judge(collegeName, match, isId);
  } catch {
    return null;
  }
}

export class VerificationService {
  /** Submit an ID photo. Runs the auto chain; anything unclear → admin queue. */
  async submit(userId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      const e: any = new Error('Only JPG, PNG, WebP or HEIC images are allowed'); e.status = 400; throw e;
    }
    if (file.size > MAX_BYTES) {
      const e: any = new Error('Image must be under 8 MB'); e.status = 400; throw e;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true, verificationStatus: true, college: { select: { name: true } } },
    });
    if (!user?.collegeId) {
      const e: any = new Error('Select your college before verifying'); e.status = 400; throw e;
    }
    if (user.verificationStatus === 'VERIFIED') {
      const e: any = new Error('You are already verified'); e.status = 400; throw e;
    }
    const collegeName = user.college?.name || 'the college';

    // Replace any prior pending attempt
    await prisma.idVerification.deleteMany({ where: { userId, status: 'PENDING' } });

    const record = await prisma.idVerification.create({
      data: { userId, imageData: file.buffer, mimeType: file.mimetype, status: 'PENDING' },
    });

    await prisma.user.update({ where: { id: userId }, data: { verificationStatus: 'PENDING' } });

    // Run the auto chain in the background — the user sees "checking…"
    this.runAuto(record.id, userId, file.buffer.toString('base64'), file.mimetype, collegeName).catch(() => {});

    return { id: record.id, status: 'PENDING' as const };
  }

  /** The auto chain: Ollama → Gemini → review. Always resolves the record. */
  private async runAuto(recordId: string, userId: string, imageB64: string, mime: string, collegeName: string) {
    let result = await ollamaCheck(imageB64, mime, collegeName);
    if (!result) result = await geminiCheck(imageB64, mime, collegeName);
    if (!result) result = { decision: 'SKIPPED' as const, confidence: 0, reason: 'No verification engine configured — queued for manual review.' };

    if (result.decision === 'APPROVED') {
      await this.resolve(recordId, 'VERIFIED', result.reason, 'auto', userId);
    } else {
      // Never hard-reject on automation alone — a human confirms everything
      await this.resolve(recordId, 'PENDING', result.reason, 'auto-review', userId, 'PENDING');
    }
  }

  /**
   * Resolve a verification. The image bytes are ALWAYS deleted here — this is
   * the single funnel every decision (auto or human) goes through.
   */
  async resolve(recordId: string, userStatus: 'VERIFIED' | 'PENDING' | 'REJECTED', reason: string, decidedBy: string, userId: string, recordStatus: 'VERIFIED' | 'REJECTED' | 'PENDING' = userStatus === 'PENDING' ? 'PENDING' : userStatus) {
    const record = await prisma.idVerification.findUnique({ where: { id: recordId } });
    if (!record) return;

    await prisma.$transaction([
      prisma.idVerification.update({
        where: { id: recordId },
        data: {
          status: recordStatus,
          autoDecision: record.autoDecision || (decidedBy.startsWith('auto') ? decidedBy.toUpperCase() : null),
          autoConfidence: record.autoConfidence,
          autoReason: reason,
          decidedBy,
          decidedAt: recordStatus === 'PENDING' ? null : new Date(),
          // PRIVACY: bytes are erased only at a FINAL decision (verify/reject).
          // A pending human review keeps them — the reviewer needs to see the ID.
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
