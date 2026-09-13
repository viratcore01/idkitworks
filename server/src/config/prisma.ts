import { PrismaClient } from '@prisma/client';

/**
 * Production hardening for pooled Postgres (Supabase Supavisor transaction mode):
 * - pgbouncer=true        → skip server-side prepared statements (required in
 *                           transaction mode; without it, concurrent load can
 *                           crash requests with "prepared statement already exists")
 * - connection_limit=10   → cap per-instance pool (Render free tier + Supabase)
 * - pool_timeout=20s      → wait instead of instantly 500-ing during spikes
 * Applied at runtime so it holds no matter what the env var contains.
 */
function tunedDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '10');
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '20');
    return url.toString();
  } catch {
    return raw; // unparsable — let Prisma surface its own error
  }
}

if (tunedDatabaseUrl(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = tunedDatabaseUrl(process.env.DATABASE_URL)!;
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Prisma's default pool (num_cpus * 2 + 1) exhausts Supabase's small
 * session-pooler ceilings on small instances (EMAXCONNSESSION at 15 clients).
 * The caps below are env-overridable so production can tune upward with the
 * database, and the modest default keeps many instances from stacking up.
 */
const CONNECTION_LIMIT = Number(process.env.DATABASE_CONNECTION_LIMIT || 5);
const POOL_TIMEOUT = Number(process.env.DATABASE_POOL_TIMEOUT || 30);
const baseUrl = process.env.DATABASE_URL || '';

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}connection_limit=${CONNECTION_LIMIT}&pool_timeout=${POOL_TIMEOUT}`,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
