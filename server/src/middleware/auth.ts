import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../config/prisma';
import { AuthRequest, AuthUser } from '../types';
import { cachedLiveUser } from '../utils/user-cache';
import { isPasswordSet } from '../utils/password';

/**
 * Auth for image-serving routes: <img> tags can't send Authorization headers,
 * so the access token may arrive as ?t=<accessToken> instead of the header.
 * Same checks as authMiddleware — live DB user, active account.
 */
export async function photoAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  let token: string | undefined;
  if (header && header.startsWith('Bearer ')) token = header.split(' ')[1];
  if (!token && typeof req.query.t === 'string') token = req.query.t;
  // Long-lived photo token (see issuePhotoToken) — survives between sessions.
  let purpose: string | undefined;
  if (!token && typeof req.query.pt === 'string') {
    token = req.query.pt;
    purpose = 'photo';
  }
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const payload = verifyAccessToken(token);
    if (purpose === 'photo') {
      // A ?pt= value must be a dedicated photo token — never a short-lived access token.
      if (payload.purpose !== 'photo') {
        return res.status(401).json({ error: 'Invalid token' });
      }
    } else if ((payload as any).purpose === 'photo') {
      // Photo tokens are scoped to <img> serving only — they can never act as API credentials.
      return res.status(401).json({ error: 'Invalid token' });
    }
    // PERF: same 30s auth cache — a feed with 20 avatars = 20 image requests,
    // each previously hitting the DB just to re-read the same row.
    const dbUser = await cachedLiveUser(payload.userId, () =>
      prisma.user
        .findUnique({
          where: { id: payload.userId },
          select: { isActive: true, collegeId: true, role: true, moderatedCollegeId: true, isFounder: true },
        })
        .then((u) => (u ? { isActive: u.isActive, collegeId: u.collegeId, role: u.role, moderatedCollegeId: u.moderatedCollegeId, isFounder: u.isFounder, verificationStatus: 'UNVERIFIED' } : null)),
    );
    if (!dbUser || !dbUser.isActive) return res.status(401).json({ error: 'Account unavailable' });
    req.user = {
      id: payload.userId,
      email: payload.email,
      username: payload.username,
      role: (dbUser as any).role || payload.role,
      collegeId: dbUser.collegeId,
      scopeCollegeId: (dbUser as any).moderatedCollegeId ?? dbUser.collegeId,
      isFounder: !!(dbUser as any).isFounder,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * PRODUCT RULE: Skola is hyperlocal and college-only.
 * collegeId is always resolved from the LIVE database, never from the JWT,
 * so a user who switches college is re-scoped on their very next request.
 */
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    if ((payload as any).purpose === 'photo') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    // PERF: cached for 30s — every avatar <img> used to pay its own DB
    // round-trip here. Mutations that change this state call invalidateUser().
    // Role is read live from the DB (never trusted from the JWT) so
    // promote/demote takes effect within the cache TTL.
    const dbUser = await cachedLiveUser(payload.userId, () =>
      prisma.user
        .findUnique({
          where: { id: payload.userId },
          select: { isActive: true, collegeId: true, verificationStatus: true, role: true, moderatedCollegeId: true, isFounder: true },
        })
        .then((u) => (u ? { isActive: u.isActive, collegeId: u.collegeId, verificationStatus: u.verificationStatus, role: u.role, moderatedCollegeId: u.moderatedCollegeId, isFounder: u.isFounder } : null)),
    );

    if (!dbUser || !dbUser.isActive) {
      return res.status(401).json({ error: 'Account unavailable' });
    }

    req.user = {
      id: payload.userId,
      email: payload.email,
      username: payload.username,
      role: (dbUser as any).role || payload.role,
      collegeId: dbUser.collegeId,
      scopeCollegeId: (dbUser as any).moderatedCollegeId ?? dbUser.collegeId,
      isFounder: !!(dbUser as any).isFounder,
      verificationStatus: dbUser.verificationStatus,
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Main-app gate: every feed/match/chat/search route requires an assigned college.
 * A user without one has nothing to see — the app is college-only by design.
 */
export function collegeRequired(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user?.collegeId) {
    return res.status(403).json({
      error: 'College required',
      code: 'COLLEGE_REQUIRED',
    });
  }
  next();
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // super_admin is an admin everywhere; college scoping is applied per-query.
  if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** College admins see only their college; super-admins see everything. */
export function isSuperAdmin(user?: AuthUser): boolean {
  return user?.role === 'super_admin';
}

/**
 * The campus a staffer moderates: assigned college first, own college
 * otherwise. Every moderation gate (queues, reports, bans, takedowns) keys
 * off this — a moderator reassigned by the founder changes scope instantly.
 */
export function moderationScope(user?: AuthUser): string | null {
  return user?.scopeCollegeId ?? user?.collegeId ?? null;
}

/**
 * PRODUCT RULE (the dead-simple one): a person gets into the app — feed,
 * match, chat, everything — ONLY after college-email OTP verification.
 * Enforced HERE, on the server, per request: the client hiding screens is
 * convenience, this is the actual wall. Admins are exempt (they must be able
 * to reach the console and every page regardless of their own status).
 *
 * STALE-CACHE GUARD: auth state is cached for 30s. If the cache says
 * UNVERIFIED we do ONE live re-read before rejecting — otherwise a student
 * verified seconds ago stares at "must be verified" until the TTL expires.
 * (Fail-closed on the live read: any DB error still rejects.)
 */
export async function verificationRequired(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin' || req.user?.role === 'super_admin') return next();
  if (req.user?.verificationStatus === 'VERIFIED') return next();
  try {
    const live = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { verificationStatus: true },
    });
    if (live?.verificationStatus === 'VERIFIED') {
      req.user!.verificationStatus = 'VERIFIED';
      const { setCachedUser, getCachedUser } = await import('../utils/user-cache');
      const cached = getCachedUser(req.user!.id);
      if (cached) setCachedUser(req.user!.id, { ...cached, verificationStatus: 'VERIFIED' });
      return next();
    }
  } catch {
    /* fall through to the 403 below */
  }
  return res.status(403).json({
    error: 'Verify your college email first — check /verify for the code',
    code: 'VERIFICATION_REQUIRED',
  });
}

/**
 * PRODUCT RULE: password is compulsory for EVERYONE — Google sign-in included.
 * Same bar as the normal email funnel: verified → password → profile → feed.
 * Google proves the inbox, never the right to skip the password. No skipping:
 * every feed/match/chat/search/profile read sits behind this wall (alongside
 * college + verification), so a passwordless session can call the funnel
 * endpoints (/auth/*, /verify, /users/me/photos, profile setup) but nothing
 * else. Admins are exempt (they must reach the console regardless).
 */
export async function passwordRequired(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin' || req.user?.role === 'super_admin') return next();
  try {
    const live = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { passwordHash: true },
    });
    if (live && isPasswordSet(live.passwordHash)) return next();
  } catch {
    /* fall through to the 403 below */
  }
  return res.status(403).json({
    error: 'Set a password first — it is required for every account, including Google sign-in',
    code: 'PASSWORD_REQUIRED',
  });
}
