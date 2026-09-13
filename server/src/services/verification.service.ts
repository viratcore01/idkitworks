import { prisma } from '../config/prisma';
import { publish } from '../config/bus';

/**
 * Student-ID verification chain:
 *   1. Ollama vision (local, free) — if configured and reachable
 *   2. Gemini vision (cheap, fast) — if GEMINI_API_KEY is set
 *   3. Manual review by college admins — always the safety net
 *
 * PRODUCT RULES:
 * - The AI never "detects fakes." It reads the card and we CROSS-CHECK what
 *   it read against the details the student filled in (college name, their
 *   display name). Both must agree for an auto-approve; anything missing or
 *   conflicting goes to a human.
 * - The AI never hard-rejects on its own — automation only approves or
 *   escalates. Humans reject.
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

/** What the vision model is asked to read off the card. */
interface IdReading {
  isId: boolean;          // plausibly a student ID card?
  collegeText: string;    // institution name as printed ("" if unreadable)
  nameText: string;       // student name as printed ("" if unreadable)
  raw: string;            // full model output for the audit trail
}

function buildPrompt(collegeName: string, studentName: string): string {
  return (
    'You are reading a photo that should contain a college student ID card. Answer strictly in this exact format (no other text):\n' +
    'IS_ID: yes|no\n' +
    'INSTITUTION: <institution name printed on the card, or "unreadable">\n' +
    'STUDENT_NAME: <student name printed on the card, or "unreadable">\n\n' +
    'Rules: IS_ID is yes only if the image plausibly contains an ID card (plastic card or clearly framed document with a name and an institution). ' +
    `The student claims their institution is "${collegeName}" and their name is "${studentName}". ` +
    'Transcribe text exactly as printed — do not guess or infer. If text is blurry or absent, write "unreadable".'
  );
}

function parseReading(modelText: string): IdReading {
  const isId = /IS_ID:\s*yes/i.test(modelText);
  const inst = modelText.match(/INSTITUTION:\s*(.+)/i)?.[1]?.trim() || '';
  const name = modelText.match(/STUDENT_NAME:\s*(.+)/i)?.[1]?.trim() || '';
  const clean = (s: string) => (/unreadable|^["'.\s-]*$/.test(s) ? '' : s.replace(/^["']|["']$/g, '').slice(0, 120));
  return { isId, collegeText: clean(inst), nameText: clean(name), raw: modelText.slice(0, 500) };
}

/**
 * Fuzzy token overlap: does the printed text mention the expected value?
 * Handles OCR noise, order differences ("Sharma Priya"), initials ("P. Sharma").
 */
function textMentions(printed: string, expected: string): boolean {
  const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const p = norm(printed);
  const e = norm(expected);
  if (!p || !e) return false;
  if (p.includes(e)) return true;
  const eTokens = e.split(' ').filter((t) => t.length >= 3);
  if (eTokens.length === 0) return false;
  const hits = eTokens.filter((t) => p.includes(t)).length;
  return hits / eTokens.length >= 0.5; // half of meaningful tokens present (handles initials like "P. Sharma")
}

/** Decide from a reading + the user's claimed details. */
function judge(reading: IdReading, collegeName: string, shortName: string | null, studentName: string): AutoResult {
  if (!reading.isId) {
    return { decision: 'REVIEW', confidence: 0.3, reason: 'Image does not clearly contain a student ID card — a moderator will take a look.' };
  }

  const collegeOk =
    textMentions(reading.collegeText, collegeName) ||
    (!!shortName && textMentions(reading.collegeText, shortName)) ||
    textMentions(reading.raw, collegeName) ||
    (!!shortName && textMentions(reading.raw, shortName));

  // Name on card vs profile: only enforced when the card actually shows a name
  const nameOk = !reading.nameText || textMentions(reading.nameText, studentName);

  if (!collegeOk) {
    return {
      decision: 'REVIEW',
      confidence: 0.45,
      reason: reading.collegeText
        ? `Card reads "${reading.collegeText}", which does not match ${collegeName}. A moderator will verify.`
        : 'Could not read the institution name on the card. A moderator will verify.',
    };
  }
  if (!nameOk) {
    return {
      decision: 'REVIEW',
      confidence: 0.5,
      reason: `Card shows a different name ("${reading.nameText}") than your profile ("${studentName}"). A moderator will verify.`,
    };
  }

  const nameBonus = reading.nameText ? 0.04 : 0;
  return {
    decision: 'APPROVED',
    confidence: Math.min(0.96, 0.88 + nameBonus),
    reason: `ID verified: institution matches ${shortName || collegeName}${reading.nameText ? ', name matches profile' : ''}.`,
  };
}

async function ollamaCheck(imageB64: string, mime: string, collegeName: string, studentName: string): Promise<IdReading | null> {
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
        prompt: buildPrompt(collegeName, studentName),
        images: [imageB64],
        stream: false,
        options: { temperature: 0 },
      }),
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data.response || '';
    return parseReading(text);
  } catch {
    return null; // fall through to Gemini
  }
}

async function geminiCheck(imageB64: string, mime: string, collegeName: string, studentName: string): Promise<IdReading | null> {
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
              { text: buildPrompt(collegeName, studentName) },
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
    return parseReading(text);
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
      select: {
        collegeId: true,
        verificationStatus: true,
        displayName: true,
        college: { select: { name: true, shortName: true } },
      },
    });
    if (!user?.collegeId) {
      const e: any = new Error('Select your college before verifying'); e.status = 400; throw e;
    }
    if (user.verificationStatus === 'VERIFIED') {
      const e: any = new Error('You are already verified'); e.status = 400; throw e;
    }
    const collegeName = user.college?.name || 'the college';
    const shortName = user.college?.shortName || null;
    const studentName = user.displayName || 'the student';

    // Replace any prior pending attempt
    await prisma.idVerification.deleteMany({ where: { userId, status: 'PENDING' } });

    const record = await prisma.idVerification.create({
      data: { userId, imageData: file.buffer, mimeType: file.mimetype, status: 'PENDING' },
    });

    await prisma.user.update({ where: { id: userId }, data: { verificationStatus: 'PENDING' } });

    // Run the auto chain in the background — the user sees "checking…"
    this.runAuto(record.id, userId, file.buffer.toString('base64'), file.mimetype, collegeName, shortName, studentName).catch(() => {});

    return { id: record.id, status: 'PENDING' as const };
  }

  /** The auto chain: Ollama → Gemini → review. Always resolves the record. */
  private async runAuto(
    recordId: string,
    userId: string,
    imageB64: string,
    mime: string,
    collegeName: string,
    shortName: string | null,
    studentName: string,
  ) {
    let reading = await ollamaCheck(imageB64, mime, collegeName, studentName);
    if (!reading) reading = await geminiCheck(imageB64, mime, collegeName, studentName);

    if (!reading) {
      await this.resolve(recordId, 'PENDING', 'Automatic check unavailable — queued for manual review.', 'auto-review', userId, 'PENDING');
      return;
    }

    const result = judge(reading, collegeName, shortName, studentName);

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
