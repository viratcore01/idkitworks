import { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: string;
  /** Resolved from the live DB on every request (NOT from the token) so college changes apply instantly. */
  collegeId: string | null;
  /**
   * The campus this staffer MODERATES: their assigned college if the founder
   * appointed them elsewhere, else their own college. All moderation scoping
   * keys off this — never off collegeId.
   */
  scopeCollegeId?: string | null;
  /** The creator. Immutable and untouchable — enforced in every staff path. */
  isFounder?: boolean;
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
