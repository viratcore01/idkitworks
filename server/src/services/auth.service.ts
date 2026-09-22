import { prisma, TX_OPTIONS } from '../config/prisma';
import { hashPassword, comparePassword, isPasswordSet } from '../utils/password';
import { checkEmail } from '../utils/email-validation';
import {
  generateAccessToken,
  generateRefreshToken,
  parseDuration,
} from '../utils/jwt';
import { env } from '../config/env';
import { JwtPayload } from '../types';
import { invalidateUser } from '../utils/user-cache';
import { verifyGoogleIdToken } from './google-auth.service';

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
      typeof input?.password !== 'string' || input.password.length < 6 || input.password.length > 128 ||
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
    // USERNAME UNIQUENESS IS CASE-INSENSITIVE (Virat == virat == VIRAT):
    // the DB has UNIQUE (LOWER(username)) as the race-proof backstop, and this
    // pre-check gives the friendly 409 instead of a raw P2002.
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: { equals: input.username, mode: 'insensitive' } }] },
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
      // Two people submitting the same email/username in the same second
      // (including case variants — UNIQUE (LOWER(username)) catches those):
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

  /**
   * Login with EITHER email or username (both case-insensitive — usernames
   * are case-insensitively unique by product rule, emails case-insensitive
   * by convention). One generic error for every failure path so the response
   * never becomes an account-existence oracle (timing + message).
   */
  async login(identifier: string, password: string): Promise<AuthTokens> {
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim()) {
      const e: any = new Error('Invalid email/username or password'); e.status = 401; throw e;
    }
    // Overlong passwords can never be valid (signup caps at 128) — reject
    // before bcrypt burns CPU on a 100kb payload.
    if (password.length > 128) {
      await comparePassword(password.slice(0, 128), DUMMY_HASH);
      throw new Error('Invalid email/username or password');
    }
    const id = identifier.trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: id, mode: 'insensitive' } },
          { username: { equals: id, mode: 'insensitive' } },
        ],
      },
    });

    if (!user) {
      // Always run one bcrypt compare, even for unknown identifiers —
      // otherwise response timing reveals which emails/usernames have
      // accounts (enumeration).
      await comparePassword(password, DUMMY_HASH);
      throw new Error('Invalid email/username or password');
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email/username or password');
    }

    if (!user.isActive) {
      // Distinct, honest message for suspended accounts — but only AFTER the
      // password proves ownership (a wrong password still says "invalid",
      // so the error never becomes an account-existence oracle).
      // NOTE: there is no self-serve return from here. Deactivation was
      // removed: logout and delete-forever are the only account exits.
      const e: any = new Error('Your account has been suspended. Contact support if you think this is a mistake.');
      e.status = 403;
      throw e;
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

  /**
   * Change password for a logged-in user. Verifies the current password,
   * then logs out EVERYWHERE (all refresh tokens die) — a password change
   * after a device theft must actually end the thief's session.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      const e: any = new Error('Invalid password'); e.status = 400; throw e;
    }
    if (newPassword.length < 6 || newPassword.length > 128) {
      const e: any = new Error('New password must be 6-128 characters'); e.status = 400; throw e;
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      const e: any = new Error('Account unavailable'); e.status = 401; throw e;
    }
    const ok = await comparePassword(currentPassword, user.passwordHash);
    if (!ok) {
      const e: any = new Error('Current password is incorrect'); e.status = 403; throw e;
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    invalidateUser(userId);
  }

  /**
   * SET a password for a Google-created account that never had one.
   * Unlike changePassword this does NOT ask for the current password (there
   * isn't one — passwordHash is a random placeholder). Authorization is a
   * FRESH Google ID token for the LINKED Google account instead: session auth
   * alone must never mint a password, or a stolen session would become
   * permanent account ownership. Same session-kill as changePassword.
   */
  async setPasswordViaGoogle(userId: string, idToken: string, newPassword: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
      const e: any = new Error('New password must be 6-128 characters'); e.status = 400; throw e;
    }
    if (typeof idToken !== 'string' || !idToken) {
      const e: any = new Error('Missing Google credential'); e.status = 400; throw e;
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      const e: any = new Error('Account unavailable'); e.status = 401; throw e;
    }
    if (!user.googleId) {
      const e: any = new Error('Google is not linked to this account'); e.status = 400; throw e;
    }
    if (isPasswordSet(user.passwordHash)) {
      const e: any = new Error('This account already has a password — change it instead'); e.status = 400; throw e;
    }
    const g = await verifyGoogleIdToken(idToken);
    if (g.googleId !== user.googleId) {
      const e: any = new Error('Google account does not match this profile'); e.status = 403; throw e;
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    invalidateUser(userId);
  }

  /**
   * PERMANENT account deletion (user-invoked "delete my account").
   *
   * This is the ONLY account exit besides logout. Everything the user owned
   * is wiped — profile, photos, ID documents, posts, comments, messages,
   * likes, saves, swipes, matches, notifications, reports they filed,
   * sessions — and the email/username are freed, so signing up again with
   * the same email starts completely fresh (new id, empty everything).
   *
   * What is kept: the user ROW itself (anonymized + locked) so foreign keys
   * from moderation/safety rows never dangle — reports filed AGAINST them,
   * ended match rows and conversation shells stay for safety review, with all
   * PII scrubbed. Deleting the row itself would either 500 on FK constraints
   * or cascade-wipe evidence peers and moderators rely on.
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isFounder: true } });
    if (!user) {
      const e: any = new Error('Account not found'); e.status = 404; throw e;
    }
    if (user.isFounder) {
      // The creator cannot delete the supreme account — not even by hand.
      const e: any = new Error('The founder account cannot be deleted'); e.status = 403; throw e;
    }

    // This transaction fans out into ~10 statements plus a per-conversation
    // cleanup loop, so it needs TX_OPTIONS' budget rather than Prisma's 5s
    // default — an account deletion that 500s halfway is the worst kind of
    // failure to leave a user staring at.
    await prisma.$transaction(async (tx) => {
      // Notifications: received ones die; authored ones lose their actor link.
      await tx.notification.deleteMany({ where: { recipientId: userId } });
      await tx.notification.updateMany({ where: { actorId: userId }, data: { actorId: null } });
      // Reports filed BY the user die; reports they RESOLVED (as admin) keep
      // the row but lose the resolver link.
      await tx.report.deleteMany({ where: { reporterId: userId } });
      await tx.report.updateMany({ where: { resolverId: userId }, data: { resolverId: null } });
      // Blocks either direction die with the account.
      await tx.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
      // Swipes either direction die.
      await tx.matchLike.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } });
      // Matches end (rows preserved for safety, peer sees them gone).
      await tx.match.updateMany({
        where: { OR: [{ userA: userId }, { userB: userId }], status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: new Date(), endedBy: userId },
      });
      // Authored messages die; memberships die; conversations left empty die.
      await tx.message.deleteMany({ where: { senderId: userId } });
      const memberships = await tx.conversationMember.findMany({ where: { userId }, select: { conversationId: true } });
      await tx.conversationMember.deleteMany({ where: { userId } });
      for (const m of memberships) {
        const remaining = await tx.conversationMember.count({ where: { conversationId: m.conversationId } });
        if (remaining === 0) {
          await tx.conversation.delete({ where: { id: m.conversationId } }).catch(() => {});
        }
      }
      // Authored comments die; authored posts die (their likes/saves/replies
      // cascade from the post row).
      await tx.comment.deleteMany({ where: { authorId: userId } });
      await tx.post.deleteMany({ where: { authorId: userId } });
      await tx.savedPost.deleteMany({ where: { userId } });
      await tx.postLike.deleteMany({ where: { userId } });
      // Photos: clear the avatar pointer first (no SetNull on that relation),
      // then wipe the bytes.
      await tx.user.update({ where: { id: userId }, data: { avatarPhotoId: null } });
      await tx.userPhoto.deleteMany({ where: { userId } });
      // ID documents die entirely.
      await tx.idVerification.deleteMany({ where: { userId } });
      await tx.userInterest.deleteMany({ where: { userId } });
      await tx.matchPreference.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      const tag = `del_${userId.slice(0, 8)}${Date.now().toString(36).slice(-5)}`;
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `${tag}@deleted.local`,
          username: tag,
          displayName: 'Deleted User',
          bio: null,
          avatarUrl: null,
          avatarColor: null,
          dateOfBirth: null,
          googleId: null,
          passwordHash: `DELETED_${userId}`,
          course: null,
          year: null,
          gender: 'UNKNOWN',
          relationshipGoals: [],
          isVerified: false,
          verificationStatus: 'UNVERIFIED',
          isActive: false,
          role: 'user',
          collegeId: null,
          moderatedCollegeId: null,
        },
      });
    }, TX_OPTIONS);

    invalidateUser(userId);
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
      isFounder: (user as any).isFounder || false,
      moderatedCollegeId: (user as any).moderatedCollegeId || null,
      interests: user.interests.map((ui) => ui.interest),
      postCount: user._count.posts,
      isProfileSetup: !!(user.collegeId && user.course),
      createdAt: user.createdAt,
      // Auth-method flags: the Settings screen shows "Change password" only
      // when a real password exists, and "Set a password" for Google-only
      // accounts (whose passwordHash is an unguessable placeholder).
      hasGoogle: !!user.googleId,
      hasPassword: isPasswordSet(user.passwordHash),
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
    relationshipGoals?: string[] | null;
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
    // MULTI-SELECT "Looking for": dedupe, keep only known goals, empty list =
    // "rather not say" (stored as [] — must never silently filter anyone out).
    if (data.relationshipGoals !== undefined) {
      if (data.relationshipGoals === null || (Array.isArray(data.relationshipGoals) && data.relationshipGoals.length === 0)) {
        update.relationshipGoals = [];
      } else if (Array.isArray(data.relationshipGoals)) {
        const VALID = ['DATING', 'RELATIONSHIP', 'HOOKUP', 'CASUAL', 'NOT_SURE'];
        const goals = [...new Set(data.relationshipGoals.filter((g) => typeof g === 'string' && VALID.includes(g)))];
        update.relationshipGoals = goals;
      } else {
        throw new Error('Invalid relationship goals');
      }
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
      invalidateUser(userId); // the auth gate resolves collegeId per request
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
      relationshipGoals: user.relationshipGoals,
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
