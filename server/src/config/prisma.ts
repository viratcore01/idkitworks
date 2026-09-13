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

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
