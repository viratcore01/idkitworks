import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../config/prisma';
import { AuthRequest, AuthUser } from '../types';

/**
 * PRODUCT RULE: Freebuff is hyperlocal and college-only.
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
      select: { isActive: true, collegeId: true },
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
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** College admins see only their college; super-admins see everything. */
export function isSuperAdmin(user?: AuthUser): boolean {
  return user?.role === 'super_admin';
}
