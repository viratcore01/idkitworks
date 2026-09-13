import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../config/prisma';
import { AuthRequest, AuthUser } from '../types';

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
    if (purpose && payload.purpose !== purpose) {
      // A ?pt= value that isn't a photo token is never accepted.
      return res.status(401).json({ error: 'Invalid token' });
    }
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { isActive: true, collegeId: true },
    });
    if (!dbUser || !dbUser.isActive) return res.status(401).json({ error: 'Account unavailable' });
    req.user = {
      id: payload.userId,
      email: payload.email,
      username: payload.username,
      role: payload.role,
      collegeId: dbUser.collegeId,
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
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { isActive: true, collegeId: true, verificationStatus: true },
    });

    if (!dbUser || !dbUser.isActive) {
      return res.status(401).json({ error: 'Account unavailable' });
    }

    req.user = {
      id: payload.userId,
      email: payload.email,
      username: payload.username,
      role: payload.role,
      collegeId: dbUser.collegeId,
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
 * PRODUCT RULE (the dead-simple one): a person gets into the app — feed,
 * match, chat, everything — ONLY after a moderator approves their student ID.
 * Enforced HERE, on the server, per request: the client hiding screens is
 * convenience, this is the actual wall. Admins are exempt (they must be able
 * to reach the review queue and every page regardless of their own status).
 */
export function verificationRequired(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin' || req.user?.role === 'super_admin') return next();
  if (req.user?.verificationStatus !== 'VERIFIED') {
    return res.status(403).json({
      error: 'Your student ID must be verified by a moderator first',
      code: 'VERIFICATION_REQUIRED',
    });
  }
  next();
}
