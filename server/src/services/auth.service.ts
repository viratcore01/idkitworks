import { prisma } from '../config/prisma';
import { hashPassword, comparePassword } from '../utils/password';
import { checkEmail } from '../utils/email-validation';
import {
  generateAccessToken,
  generateRefreshToken,
  parseDuration,
} from '../utils/jwt';
import { env } from '../config/env';
import { JwtPayload } from '../types';

/**
 * Constant dummy hash for the login timing-oracle fix: when the email does
 * not exist we still run one bcrypt compare so "unknown email" and "wrong
 * password" take the same time to answer.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7tAUFnOnV0Co7f3OSJ8X6VzX2rZC0Ny';

interface SignupInput {
  email: string;
  password: string;
  username: string;
  displayName: string;
  collegeId?: string;
  course?: string;
  year?: number;
  avatarUrl?: string;
  bio?: string;
  interestIds?: string[];
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarColor: string | null;
    collegeId: string | null;
    isProfileSetup: boolean;
  };
}

function createPayload(user: { id: string; email: string; username: string; role: string }): JwtPayload {
  return { userId: user.id, email: user.email, username: user.username, role: user.role };
}

function createAuthResponse(user: any, accessToken: string, refreshToken: string): AuthTokens {
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
      // College gate key: the client needs it immediately after login
      collegeId: user.collegeId ?? null,
      isProfileSetup: !!(user.collegeId && user.course),
    },
  };
}

export class AuthService {
  async signup(input: SignupInput): Promise<AuthTokens> {
    // Type guards: malformed JSON bodies must never reach Prisma (engine errors leak paths).
    if (
      typeof input?.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) ||
      typeof input?.username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(input.username) ||
      typeof input?.displayName !== 'string' || input.displayName.trim().length < 2 ||
      typeof input?.password !== 'string' || input.password.length < 6 ||
      typeof input?.collegeId !== 'string' || !input.collegeId
    ) {
      const e: any = new Error('Invalid signup details'); e.status = 400; throw e;
    }

    // Email hygiene: syntax + disposable-inbox block + typo suggestion.
    const emailCheck = checkEmail(input.email);
    if (!emailCheck.ok) {
      const e: any = new Error(emailCheck.error || 'Invalid email'); e.status = 400;
      e.code = 'EMAIL_INVALID';
      throw e;
    }
    if (emailCheck.suggestion) {
      // Not fatal — but the client shows "did you mean?" before creating the account
      const e: any = new Error(`Did you mean ${emailCheck.suggestion}?`); e.status = 400;
      e.code = 'EMAIL_TYPO';
      e.suggestion = emailCheck.suggestion;
      throw e;
    }
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
    });

    if (existingUser) {
      if (existingUser.email === input.email) {
        throw new Error('Email already in use');
      }
      throw new Error('Username already taken');
    }

    // Interests: dedupe the payload and verify every id exists — a stale or
    // forged interest id would otherwise surface as an ugly FK-violation 500.
    const interestIds = [...new Set((input.interestIds || []).filter(Boolean))];
    if (interestIds.length > 15) {
      const e: any = new Error('Pick at most 15 interests'); e.status = 400; throw e;
    }
    if (interestIds.length) {
      const found = await prisma.interest.findMany({ where: { id: { in: interestIds } }, select: { id: true } });
      if (found.length !== interestIds.length) {
        const e: any = new Error('One or more interests not found'); e.status = 400; throw e;
      }
    }

    const passwordHash = await hashPassword(input.password);

    let user: any;
    try {
      user = await prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          username: input.username,
          displayName: input.displayName,
          collegeId: input.collegeId,
          course: input.course,
          year: input.year,
          avatarUrl: input.avatarUrl,
          bio: input.bio,
          interests: interestIds.length
            ? { create: interestIds.map((interestId) => ({ interestId })) }
            : undefined,
        },
      });
    } catch (err: any) {
      // Two people submitting the same email/username in the same second:
      // the DB unique index is the truth — answer 409, never 500.
      if (err?.code === 'P2002') {
        const e: any = new Error('Email or username already in use'); e.status = 409; throw e;
      }
      throw err;
    }

    const payload = createPayload(user);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

    // Housekeeping: expired tokens otherwise accumulate forever. Indexed and
    // fire-and-forget — never blocks the login response.
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    return createAuthResponse(user, accessToken, refreshToken);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    if (typeof email !== 'string' || typeof password !== 'string') {
      const e: any = new Error('Invalid email or password'); e.status = 401; throw e;
    }
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      // Always run one bcrypt compare, even for unknown emails — otherwise
      // response timing reveals which emails have accounts (enumeration).
      await comparePassword(password, DUMMY_HASH);
      throw new Error('Invalid email or password');
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    const payload = createPayload(user);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

    return createAuthResponse(user, accessToken, refreshToken);
  }

  /**
   * Rotate the refresh token. Race-safe under concurrent 401 storms:
   * deleteMany on the un-expired token is an atomic claim — exactly ONE
   * concurrent caller wins the rotation; every loser gets 401 and the
   * client recovers by re-reading the (shared) stored token. No grace
   * windows, no token-family explosion from multi-tab refresh bursts.
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { select: { id: true, email: true, username: true, role: true, isActive: true } } },
    });

    if (!stored || stored.expiresAt < new Date() || !stored.user?.isActive) {
      throw new Error('Invalid or expired refresh token');
    }

    // Atomic claim: the winner deletes the row; concurrent losers' deleteMany
    // affects 0 rows and they are told to re-authenticate.
    const claim = await prisma.refreshToken.deleteMany({
      where: { token: refreshToken, expiresAt: { gt: new Date() } },
    });
    if (claim.count === 0) {
      const e: any = new Error('Session was refreshed elsewhere — reloading');
      e.status = 401;
      throw e;
    }

    const payload = createPayload(stored.user as any);
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: stored.user.id,
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

    // Housekeeping: expired tokens otherwise accumulate forever. Indexed and
    // fire-and-forget — never blocks the refresh response.
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    include: {
      college: true,
      interests: { include: { interest: true } },
      photos: { select: { id: true, slot: true }, orderBy: { slot: 'asc' } },
      _count: { select: { posts: true } },
    },
    });

    if (!user) throw new Error('User not found');

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
      photos: user.photos.map((p) => ({ id: p.id, slot: p.slot })),
      bio: user.bio,
      college: user.college,
      collegeId: user.collegeId,
      course: user.course,
      year: user.year,
      isVerified: user.isVerified,
      verificationStatus: user.verificationStatus,
      role: user.role,
      interests: user.interests.map((ui) => ui.interest),
      postCount: user._count.posts,
      isProfileSetup: !!(user.collegeId && user.course),
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, data: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    avatarColor?: string;
    collegeId?: string;
    course?: string;
    year?: number;
    gender?: string;
    dateOfBirth?: string;
    interestIds?: string[];
  }) {
    // ── Server-side validation (real apps never trust the client) ──
    const update: any = {};

    if (data.displayName !== undefined) {
      const name = data.displayName.trim();
      if (name.length < 2 || name.length > 50) throw new Error('Name must be 2-50 characters');
      update.displayName = name;
    }
    if (data.bio !== undefined) {
      const bio = data.bio.trim();
      if (bio.length > 300) throw new Error('Bio must be under 300 characters');
      update.bio = bio;
    }
    if (data.course !== undefined) {
      const course = data.course.trim();
      if (course.length > 50) throw new Error('Course must be under 50 characters');
      update.course = course;
    }
    if (data.year !== undefined) {
      const yr = Number(data.year);
      if (![1, 2, 3, 4, 5].includes(yr)) throw new Error('Invalid year');
      update.year = yr;
    }
    if (data.gender !== undefined) {
      if (!['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'].includes(data.gender)) throw new Error('Invalid gender');
      update.gender = data.gender;
    }
    if (data.dateOfBirth !== undefined && data.dateOfBirth !== null && data.dateOfBirth !== '') {
      const dob = new Date(data.dateOfBirth);
      if (isNaN(dob.getTime())) throw new Error('Invalid date of birth');
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 16) throw new Error('You must be at least 16 to use Skola');
      if (age > 100) throw new Error('Invalid date of birth');
      update.dateOfBirth = dob;
    }
    if (data.avatarColor !== undefined) {
      // Discord-style picker: preset palette only
      if (!/^#[0-9A-Fa-f]{6}$/.test(data.avatarColor)) throw new Error('Invalid avatar color');
      update.avatarColor = data.avatarColor;
    }
    if (data.avatarUrl !== undefined && data.avatarUrl !== null) {
      const url = data.avatarUrl.trim();
      if (url && !/^https:\/\//.test(url)) throw new Error('Avatar URL must be https');
      update.avatarUrl = url || null;
    }
    if (data.collegeId !== undefined && data.collegeId !== null) {
      if (data.collegeId) {
        const college = await prisma.college.findUnique({ where: { id: data.collegeId } });
        if (!college) throw new Error('College not found');
      }

      // PRODUCT RULE: college is the isolation boundary. Once assigned, it cannot
      // be changed — otherwise a user could carry old-college posts, matches and
      // chats into a new college's feed. (Support/super-admin can override.)
      const current = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
      if (current?.collegeId && current.collegeId !== data.collegeId) {
        const e: any = new Error('Your college is already set. Contact support to change it.'); e.status = 403; throw e;
      }
      update.collegeId = data.collegeId || null;
    }

    // If updating interests, replace all (validate they exist)
    let interestConnect: any;
    if (data.interestIds) {
      if (data.interestIds.length > 15) throw new Error('Pick at most 15 interests');
      if (data.interestIds.length) {
        const found = await prisma.interest.findMany({ where: { id: { in: data.interestIds } } });
        if (found.length !== data.interestIds.length) throw new Error('One or more interests not found');
        interestConnect = data.interestIds.map((interestId) => ({ interestId }));
      }
      await prisma.userInterest.deleteMany({ where: { userId } });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...update,
        ...(data.interestIds && {
          interests: { create: interestConnect || [] },
        }),
      },
      include: {
        college: true,
        interests: { include: { interest: true } },
        photos: { select: { id: true, slot: true }, orderBy: { slot: 'asc' } },
      },
    });

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
      photos: user.photos.map((p) => ({ id: p.id, slot: p.slot })),
      bio: user.bio,
      college: user.college,
      course: user.course,
      year: user.year,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      age: user.dateOfBirth
        ? Math.floor((Date.now() - user.dateOfBirth.getTime()) / (365.25 * 24 * 3600 * 1000))
        : null,
      interests: user.interests.map((ui) => ui.interest),
    };
  }

  /** Which fields a user still needs to fill — powers the completeness meter. */
  async getProfileCompleteness(userId: string) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatarUrl: true,
        avatarColor: true,
        photos: { select: { id: true } },
        bio: true,
        course: true,
        year: true,
        gender: true,
        dateOfBirth: true,
        collegeId: true,
        interests: { select: { interestId: true } },
        matchPreference: { select: { id: true } },
      },
    });
    if (!u) throw new Error('User not found');

    const checks = [
      { key: 'college', done: !!u.collegeId, weight: 20, label: 'Add your college' },
      { key: 'bio', done: !!(u.bio && u.bio.length >= 10), weight: 15, label: 'Write a bio (10+ chars)' },
      { key: 'photo', done: !!u.avatarUrl || u.photos.length > 0, weight: 20, label: 'Add a profile photo' },
      { key: 'interests', done: u.interests.length >= 3, weight: 15, label: 'Pick 3+ interests' },
      { key: 'dob', done: !!u.dateOfBirth, weight: 15, label: 'Add your birth date' },
      { key: 'gender', done: !!u.gender && u.gender !== 'UNKNOWN', weight: 10, label: 'Set your gender' },
      { key: 'prefs', done: !!u.matchPreference, weight: 5, label: 'Set discovery preferences' },
    ];
    const score = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
    const missing = checks.filter((c) => !c.done).map((c) => ({ key: c.key, label: c.label, weight: c.weight }));
    return { score, missing };
  }
}
