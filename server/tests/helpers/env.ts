/**
 * Test environment bootstrap — MUST be the first import in every test file.
 *
 * Two jobs:
 *  1. Force the mail transport to the dev fallback (log the code, never send),
 *     so a unit test can never burn real Gmail quota or flake on the network.
 *     dotenv does NOT override variables that are already defined, so setting
 *     them here (before `config/env` is evaluated) wins over server/.env.
 *  2. Point DATABASE_URL at an unreachable loopback address. The suites install
 *     an in-memory fake over the Prisma delegates, but if a code path ever
 *     escapes that fake the query dies against localhost:1 — pointing at the
 *     real Supabase URL would let a test WRITE to production data.
 */

process.env.NODE_ENV = 'test';

// Mail: no transport configured → sendOtpEmail() logs and resolves.
process.env.GMAIL_USER = '';
process.env.GMAIL_APP_PASSWORD = '';
process.env.GMAIL_OAUTH_CLIENT_ID = '';
process.env.GMAIL_OAUTH_CLIENT_SECRET = '';
process.env.GMAIL_OAUTH_REFRESH_TOKEN = '';

// Database: unreachable on purpose (see file header). Not a real target.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/zoclo_test_unreachable';
process.env.DIRECT_URL = process.env.DATABASE_URL;

// Deterministic secrets so token tests are reproducible.
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '60m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

// Google Sign-In tests set their own client id.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id.apps.googleusercontent.com';
