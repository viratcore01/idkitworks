import { prisma } from '../config/prisma';
import {
  generateAccessToken,
  generateRefreshToken,
  parseDuration,
} from '../utils/jwt';
import { env } from '../config/env';
import { JwtPayload } from '../types';

/**
 * Google Sign-In, real verification — not dummy:
 *
 * The browser gets an ID token from the official Google button and POSTs it
 * here. We cryptographically verify it against Google's public keys (JWKS,
 * cached + refreshed on rotation), checking:
 *   1. signature          — signed by Google, untouched in transit
 *   2. aud                — issued for OUR OAuth client (env), not another app
 *   3. exp / iat          — issued recently, not expired
 *   4. iss                — accounts.google.com (either accepted issuer form)
 *   5. email_verified     — Google already proved the human controls the inbox
 *
 * Zero dependencies: Node 18+'s global fetch + crypto.verify handle RS256.
 */

// ── JWKS cache: Google rotates keys; refetch when an unknown kid appears ──
interface GoogleJwk { kid: string; kty: string; n: string; e: string; alg?: string; use?: string }
let jwksCache: { keys: GoogleJwk[]; fetchedAt: number } | null = null;
const JWKS_TTL = 60 * 60 * 1000; // 1h hard refresh

async function fetchJwks(): Promise<GoogleJwk[]> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('Could not reach Google to verify sign-in');
  const data: any = await res.json();
  return (data.keys || []) as GoogleJwk[];
}

async function importKey(jwk: GoogleJwk): Promise<CryptoKeyLike> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as any,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}
// WebCrypto types exist in Node 18+ at runtime; keep TS happy across lib targets
type CryptoKeyLike = any;

async function getGoogleSigningKey(kid: string): Promise<CryptoKeyLike | null> {
  const needRefetch = !jwksCache || Date.now() - jwksCache.fetchedAt > JWKS_TTL;
  if (needRefetch) {
    jwksCache = { keys: await fetchJwks(), fetchedAt: Date.now() };
  }

  const jwk = jwksCache!.keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Unknown kid = key just rotated → force one refetch and retry
    jwksCache = { keys: await fetchJwks(), fetchedAt: Date.now() };
    const retry = jwksCache.keys.find((k) => k.kid === kid);
    if (retry) return importKey(retry);
    return null;
  }
  return importKey(jwk);
}

export interface GooglePayload {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

function b64urlJson(segment: string): any {
  const json = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(json);
}

export async function verifyGoogleIdToken(idToken: string): Promise<GooglePayload> {
  if (!env.GOOGLE_CLIENT_ID) {
    const e: any = new Error('Google Sign-In is not configured on this server');
    e.status = 503; e.code = 'GOOGLE_NOT_CONFIGURED';
    throw e;
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid Google token');
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('Unsupported token algorithm');

  // 1. Signature
  const key = await getGoogleSigningKey(header.kid);
  if (!key) throw new Error('Unknown Google signing key');
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2], 'base64url');
  // Note: 'RS256' is a JOSE name, not a WebCrypto algorithm — verify needs the spec name.
  const valid = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, data);
  if (!valid) throw new Error('Invalid Google token signature');

  // 2-4. Audience, expiry, issuer — the claims Google's own libs check
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw new Error('Google token was not issued for this app');
  if (!payload.exp || payload.exp < nowSec) throw new Error('Google token expired');
  if (!payload.iat || payload.iat > nowSec + 60) throw new Error('Google token issued in the future');
  const acceptableIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!acceptableIssuers.includes(payload.iss)) throw new Error('Wrong token issuer');
  if (payload.nonce !== undefined) throw new Error('Unexpected nonce in token');

  // 5. Google must have verified the email itself
  if (payload.email_verified !== true) throw new Error('Google account email is not verified');

  return {
    googleId: payload.sub,
    email: String(payload.email || '').toLowerCase(),
    emailVerified: true,
    name: payload.name,
    picture: payload.picture,
  };
}

// Reserved usernames can never be claimed by auto-generated handles
const RESERVED = new Set(['admin', 'skola', 'support', 'root', 'moderator', 'official', 'team', 'help', 'security']);

function baseHandle(fullName: string | undefined, email: string): string {
  const fromName = (fullName || email.split('@')[0])
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 14);
  const stem = fromName.length >= 3 ? fromName : 'student';
  return stem;
}

async function availableHandle(stem: string): Promise<string> {
  if (!RESERVED.has(stem) && /^[a-z0-9_]{3,20}$/.test(stem)) {
    const taken = await prisma.user.findUnique({ where: { username: stem }, select: { id: true } });
    if (!taken) return stem;
  }
  for (let i = 0; i < 30; i++) {
    const candidate = `${stem}${Math.floor(100 + Math.random() * 900)}`;
    if (RESERVED.has(candidate)) continue;
    const taken = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Practically unreachable; final fallback
  return `${stem}${Date.now().toString().slice(-6)}`;
}

export interface GoogleAuthResult {
  accessToken: string;
  refreshToken: string;
  created: boolean;
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarColor: string | null;
    collegeId: string | null;
    isProfileSetup: boolean;
  };
}

/**
 * The one handler behind both "Sign in with Google" and "Sign up with
 * Google": verified Google users are linked to an existing account with the
 * same email (its password keeps working) or given a new account. The
 * new account lands in the SAME funnel as password users — no college yet,
 * UNVERIFIED — so the college wall and student-ID gate apply unchanged.
 */
export async function googleAuth(idToken: string): Promise<GoogleAuthResult> {
  const g = await verifyGoogleIdToken(idToken);

  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId: g.googleId }, { email: g.email }] },
  });

  let created = false;
  if (user) {
    // Existing account: remember the Google link (idempotent).
    if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId: g.googleId } });
    }
    if (!user.isActive) throw new Error('This account has been deactivated');
  } else {
    // New account — replicate exactly what password signup creates.
    created = true;
    const username = await availableHandle(baseHandle(g.name, g.email));
    const displayName = (g.name || g.email.split('@')[0]).slice(0, 50);
    // passwordHash is NOT NULL: park a random secret no one can guess or use —
    // Google users keep signing in with Google; it exists to keep the shape.
    user = await prisma.user.create({
      data: {
        email: g.email,
        passwordHash: crypto.randomUUID() + crypto.randomUUID(),
        googleId: g.googleId,
        username,
        displayName,
        avatarUrl: g.picture || undefined,
        verificationStatus: 'UNVERIFIED',
      },
    });
  }

  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
  };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
    },
  });
  // Housekeeping, same as login/signup
  prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

  return {
    accessToken,
    refreshToken,
    created,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
      collegeId: user.collegeId ?? null,
      isProfileSetup: !!(user.collegeId && user.course),
    },
  };
}
