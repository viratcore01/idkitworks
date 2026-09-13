import { prisma } from '../config/prisma';
import { hashPassword, comparePassword } from '../utils/password';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  parseDuration,
} from '../utils/jwt';
import { env } from '../config/env';
import { JwtPayload } from '../types';

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
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
    });

    if (existingUser) {
      if (existingUser.email === input.email) {
        throw new Error('Email already in use');
      }
      throw new Error('Username already taken');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.user.create({
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
        interests: input.interestIds?.length
          ? {
              create: input.interestIds.map((interestId) => ({ interestId })),
            }
          : undefined,
      },
    });

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

  async login(email: string, password: string): Promise<AuthTokens> {
    if (typeof email !== 'string' || typeof password !== 'string') {
      const e: any = new Error('Invalid email or password'); e.status = 401; throw e;
    }
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
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

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new Error('Invalid or expired refresh token');
    }

    // Rotate refresh token
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const payload = createPayload(stored.user);
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: stored.user.id,
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

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
