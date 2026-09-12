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
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  DATABASE_URL: process.env.DATABASE_URL || '',
};
