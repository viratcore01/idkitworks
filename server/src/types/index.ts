import { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: string;
  /** Resolved from the live DB on every request (NOT from the token) so college changes apply instantly. */
  collegeId: string | null;
  /** Live DB value — the verification wall is enforced against this, per request. */
  verificationStatus?: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface JwtPayload {
  userId: string;
  email: string;
  username: string;
  role: string;
  /** Set on special-purpose tokens: 'photo' = long-lived <img> token. */
  purpose?: string;
}

export interface PaginatedQuery {
  limit?: string;
  cursor?: string;
}

export interface FeedQuery extends PaginatedQuery {
  type?: string;
}
