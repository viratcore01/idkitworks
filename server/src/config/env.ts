import dotenv from 'dotenv';
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

// Production guard: never boot with placeholder secrets facing the internet.
if (isProd) {
  const problems: string[] = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev-secret')) {
    problems.push('JWT_SECRET must be set to a strong random value in production');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.includes('dev-refresh-secret')) {
    problems.push('JWT_REFRESH_SECRET must be set to a strong random value in production');
  }
  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is required in production');
  }
  if (problems.length) {
    console.error('❌ Refusing to start:', problems.join('; '));
    process.exit(1);
  }
}

function parsePort(raw: string | undefined): number {
  const port = parseInt(raw || '', 10);
  // PORT=0/NaN can never be intentional for a reachable server — fall back loudly.
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    if (raw !== undefined) console.warn(`⚠️  Ignoring invalid PORT="${raw}" — using 5000`);
    return 5000;
  }
  return port;
}

export const env = {
  PORT: parsePort(process.env.PORT),
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-this',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-this',
  // 60m default: every active user rotates tokens this often (1 DB write per
  // rotation). At launch scale 15m access tokens quadruple refresh-write load
  // for negligible security gain — the rotating 7d refresh is the real
  // session control, and the client auto-refreshes at any TTL. Override via
  // JWT_EXPIRES_IN only if you need tighter stolen-token windows.
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '60m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  DATABASE_URL: process.env.DATABASE_URL || '',
  // Google Sign-In (optional): set GOOGLE_CLIENT_ID to enable the feature.
  // The client detects support via /api/health so the button only shows when
  // the server can actually verify tokens.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  // Outbound mail (company Gmail): sends the college-email OTP codes.
  // Missing creds = dev logs the code, production refuses to send (503)
  // rather than fail silently.
  //
  // TWO transports are supported and the code picks automatically:
  //   1. Gmail REST API over HTTPS (port 443) — preferred. Required on hosts
  //      that block outbound SMTP (Render free/starter, most PaaS). Uses
  //      GMAIL_OAUTH_* below. No app password involved.
  //   2. SMTP + app password — works on a laptop or a host with SMTP open.
  // Spaces stripped: Google shows the app password grouped
  // (xxxx xxxx xxxx xxxx) and a spaced paste authenticates nowhere —
  // normalize once here so every environment (local .env, Render dashboard)
  // behaves identically.
  GMAIL_USER: process.env.GMAIL_USER || '',
  GMAIL_APP_PASSWORD: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  // Gmail API OAuth 2.0 (refresh-token flow). All three together enable the
  // HTTPS transport. Mint the refresh token with `npm run ops:gmail-auth`.
  GMAIL_OAUTH_CLIENT_ID: process.env.GMAIL_OAUTH_CLIENT_ID || '',
  GMAIL_OAUTH_CLIENT_SECRET: process.env.GMAIL_OAUTH_CLIENT_SECRET || '',
  GMAIL_OAUTH_REFRESH_TOKEN: process.env.GMAIL_OAUTH_REFRESH_TOKEN || '',
};
