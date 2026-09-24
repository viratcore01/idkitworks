import { timingSafeEqual } from 'crypto';
import { prisma } from '../config/prisma';
import { publish } from '../config/bus';
import { invalidateUser } from '../utils/user-cache';
import { sendOtpEmail } from '../utils/email';

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const MAX_EMAIL_LEN = 254;
// Practical email shape check — the college-domain match below is the real gate.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    const e: any = new Error('Enter a valid college email address');
    e.status = 400;
    throw e;
  }
  return email;
}

/** Constant-time 6-digit compare — never early-returns on first mismatch. */
function codesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export class EmailVerificationService {
  /**
   * Send OTP to college email for verification.
   * Validates that the email domain matches the user's selected college.
   */
  async sendOtp(userId: string, collegeEmail: string) {
    const email = normalizeEmail(collegeEmail);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true, collegeEmailVerified: true, collegeEmail: true, email: true },
    });

    if (!user) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }
    if (!user.collegeId) {
      const e: any = new Error('Select your college before verifying'); e.status = 400; throw e;
    }
    if (user.collegeEmailVerified) {
      const e: any = new Error('College email already verified'); e.status = 400; throw e;
    }

    const college = await prisma.college.findUnique({
      where: { id: user.collegeId },
      select: { emailDomain: true, name: true },
    });

    if (!college?.emailDomain) {
      const e: any = new Error('This college does not have email verification configured. Contact support.'); e.status = 400; throw e;
    }

    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (!emailDomain || emailDomain !== college.emailDomain.toLowerCase()) {
      const e: any = new Error(`Email must be from your college domain (@${college.emailDomain})`); e.status = 400; throw e;
    }

    // Check if this email is already used by another user
    const existingUser = await prisma.user.findFirst({
      where: { collegeEmail: email, NOT: { id: userId } },
      select: { id: true },
    });
    if (existingUser) {
      const e: any = new Error('This college email is already registered'); e.status = 409; throw e;
    }

    // Rate limit: max 3 OTP requests per 10 minutes
    const recentOtps = await prisma.emailOtp.count({
      where: {
        userId,
        purpose: 'COLLEGE_EMAIL_VERIFY',
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    if (recentOtps >= 3) {
      const e: any = new Error('Too many OTP requests. Please wait 10 minutes before trying again.'); e.status = 429; throw e;
    }

    // Housekeeping: drop expired codes so the table never grows unbounded
    // (indexed expiresAt scan — cheap). Fire-and-wait, never blocks the send.
    await prisma.emailOtp.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }).catch(() => {});

    // Delete any existing unused OTPs for this user/purpose
    await prisma.emailOtp.deleteMany({
      where: { userId, purpose: 'COLLEGE_EMAIL_VERIFY', usedAt: null },
    });

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Send BEFORE persisting: if the mail fails, no phantom OTP is left
    // behind that the user can never receive. Throws 502/503 on failure.
    await sendOtpEmail(email, code, college.name);

    await prisma.$transaction([
      prisma.emailOtp.create({
        data: {
          userId,
          email,
          code,
          purpose: 'COLLEGE_EMAIL_VERIFY',
          expiresAt,
        },
      }),
      // Remember the pending address on the profile so resend/status can
      // find it. Uniqueness is pre-checked above, so this never collides.
      // The address LOCKS only at verify time (collegeEmailVerified).
      prisma.user.update({
        where: { id: userId },
        data: { collegeEmail: email },
      }),
    ]);

    // Publish event for notification service
    publish('notification:new', {
      userIds: [userId],
      type: 'OTP_SENT',
      metadata: { email: email, purpose: 'COLLEGE_EMAIL_VERIFY' },
    });

    return { sent: true, expiresIn: OTP_TTL_MINUTES * 60 };
  }

  /**
   * Verify OTP and lock college email permanently.
   */
  async verifyOtp(userId: string, code: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true, collegeEmailVerified: true, collegeEmail: true },
    });

    if (!user) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }
    if (!user.collegeId) {
      const e: any = new Error('Select your college before verifying'); e.status = 400; throw e;
    }
    if (user.collegeEmailVerified) {
      const e: any = new Error('College email already verified'); e.status = 400; throw e;
    }

    const otpRecord = await prisma.emailOtp.findFirst({
      where: {
        userId,
        purpose: 'COLLEGE_EMAIL_VERIFY',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      const e: any = new Error('No valid OTP found. Request a new one.'); e.status = 400; throw e;
    }

    // Track attempts
    const attempts = (otpRecord as any).attempts || 0;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await prisma.emailOtp.update({ where: { id: otpRecord.id }, data: { usedAt: new Date() } });
      const e: any = new Error('Too many failed attempts. Request a new OTP.'); e.status = 400; throw e;
    }

    if (!/^\d{6}$/.test(code) || !codesMatch(otpRecord.code, code)) {
      await prisma.emailOtp.update({ where: { id: otpRecord.id }, data: { attempts: attempts + 1 } });
      const e: any = new Error('Invalid OTP'); e.status = 400; throw e;
    }

    // Verify the email matches what was sent
    const college = await prisma.college.findUnique({
      where: { id: user.collegeId },
      select: { emailDomain: true },
    });

    if (!college?.emailDomain) {
      const e: any = new Error('College email domain not configured'); e.status = 400; throw e;
    }

    const emailDomain = otpRecord.email.split('@')[1]?.toLowerCase();
    if (emailDomain !== college.emailDomain.toLowerCase()) {
      const e: any = new Error('Email domain mismatch'); e.status = 400; throw e;
    }

    // Mark OTP as used and update user in transaction
    await prisma.$transaction([
      prisma.emailOtp.update({
        where: { id: otpRecord.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          collegeEmail: otpRecord.email,
          collegeEmailVerified: true,
          collegeEmailVerifiedAt: new Date(),
          verificationStatus: 'VERIFIED',
          isVerified: true,
        },
      }),
    ]);

    invalidateUser(userId);
    publish('notification:new', { userIds: [userId], type: 'COLLEGE_EMAIL_VERIFIED' });

    return { verified: true, collegeEmail: otpRecord.email };
  }

  /**
   * Get verification status for the user.
   */
  async getStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        collegeId: true,
        collegeEmail: true,
        collegeEmailVerified: true,
        collegeEmailVerifiedAt: true,
        verificationStatus: true,
        isVerified: true,
      },
    });

    if (!user) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }

    const college = user.collegeId ? await prisma.college.findUnique({
      where: { id: user.collegeId },
      select: { emailDomain: true, name: true },
    }) : null;

    return {
      collegeId: user.collegeId,
      collegeName: college?.name || null,
      collegeEmailDomain: college?.emailDomain || null,
      collegeEmail: user.collegeEmail,
      collegeEmailVerified: user.collegeEmailVerified,
      collegeEmailVerifiedAt: user.collegeEmailVerifiedAt,
      verificationStatus: user.verificationStatus,
      isVerified: user.isVerified,
    };
  }

  /**
   * Resend OTP (rate limited).
   */
  async resendOtp(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true, collegeEmail: true, collegeEmailVerified: true },
    });

    if (!user?.collegeEmail || user.collegeEmailVerified) {
      const e: any = new Error('No pending verification'); e.status = 400; throw e;
    }

    return this.sendOtp(userId, user.collegeEmail);
  }
}