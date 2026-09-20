import { PrismaClient } from '@prisma/client';

/**
 * Production pool for Supabase Supavisor (transaction mode):
 * - pgbouncer=true  → skip server-side prepared statements (required in
 *                     transaction mode; without it, concurrent load crashes
 *                     requests with "prepared statement already exists")
 * - connection_limit → cap per-instance pool (Render free + Supabase free).
 * - pool_timeout    → wait instead of instantly 500-ing during spikes.
 *
 * SINGLE SOURCE OF TRUTH: params are set exactly once here (overwrite, not
 * append), so DATABASE_URL can never carry duplicate connection_limit /
 * pool_timeout values. Tune upward via env as the database grows:
 *   DATABASE_CONNECTION_LIMIT (default 10), DATABASE_POOL_TIMEOUT (default 20s)
 */
const CONNECTION_LIMIT = Number(process.env.DATABASE_CONNECTION_LIMIT || 10);
const POOL_TIMEOUT = Number(process.env.DATABASE_POOL_TIMEOUT || 20);

function pooledDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('connection_limit', String(CONNECTION_LIMIT));
    url.searchParams.set('pool_timeout', String(POOL_TIMEOUT));
    return url.toString();
  } catch {
    return raw; // unparsable — let Prisma surface its own error
  }
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = pooledDatabaseUrl(process.env.DATABASE_URL)!;
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
