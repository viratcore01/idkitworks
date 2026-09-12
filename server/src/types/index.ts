import { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: string;
  /** Resolved from the live DB on every request (NOT from the token) so college changes apply instantly. */
  collegeId: string | null;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface JwtPayload {
  userId: string;
  email: string;
  username: string;
  role: string;
}

export interface PaginatedQuery {
  limit?: string;
  cursor?: string;
}

export interface FeedQuery extends PaginatedQuery {
  type?: string;
}
