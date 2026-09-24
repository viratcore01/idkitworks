import { prisma } from '../config/prisma';
import {
  generateAccessToken,
  generateRefreshToken,
  parseDuration,
} from '../utils/jwt';
import { env } from '../config/env';
import { JwtPayload } from '../types';
import { invalidateUser } from '../utils/user-cache';
import { isPasswordSet } from '../utils/password';

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
  // Case-insensitive claims: a stem colliding with an existing username in
  // ANY case (e.g. stem "virat" vs account "Virat") must not be handed out.
  if (!RESERVED.has(stem) && /^[a-z0-9_]{3,20}$/.test(stem)) {
    const taken = await prisma.user.findFirst({ where: { username: { equals: stem, mode: 'insensitive' } }, select: { id: true } });
    if (!taken) return stem;
  }
  for (let i = 0; i < 30; i++) {
    const candidate = `${stem}${Math.floor(100 + Math.random() * 900)}`;
    if (RESERVED.has(candidate)) continue;
    const taken = await prisma.user.findFirst({ where: { username: { equals: candidate, mode: 'insensitive' } }, select: { id: true } });
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
    avatarPhotoId: string | null;
    avatarColor: string | null;
    collegeId: string | null;
    isProfileSetup: boolean;
    collegeEmailVerified: boolean;
    verificationStatus: string;
    hasPassword: boolean;
  };
}

/**
 * The one handler behind both "Sign in with Google" and "Sign up with
 * Google", with an optional funnel college:
 *
 * - WITHOUT collegeId (login button): legacy behavior — verified Google
 *   users are linked to an existing account with the same email (its password
 *   keeps working) or given a new UNVERIFIED account with no college, which
 *   lands in the normal funnel (college wall + college-email gate unchanged).
 * - WITH collegeId (signup wizard): the Google email's domain MUST equal the
 *   college's student-mail domain. Google already proved inbox control
 *   (email_verified), which is exactly what our OTP proves — so a match
 *   auto-verifies instantly, no code needed. A mismatch creates NOTHING (no
 *   junk rows): the user falls back to OTP or switches Google accounts.
 */
export async function googleAuth(idToken: string, collegeId?: string): Promise<GoogleAuthResult> {
  const g = await verifyGoogleIdToken(idToken);

  // Funnel college check FIRST — before any row exists or links. A personal
  // gmail must never auto-verify anyone into a college it doesn't belong to.
  let funnelCollege: { id: string; name: string; emailDomain: string } | null = null;
  if (collegeId) {
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { id: true, name: true, emailDomain: true },
    });
    if (!college) {
      const e: any = new Error('College not found'); e.status = 400; throw e;
    }
    if (!college.emailDomain) {
      const e: any = new Error(`${college.name} is not onboarded for verification yet — contact support`);
      e.status = 400; e.code = 'COLLEGE_NOT_ONBOARDED'; throw e;
    }
    const domain = g.email.split('@')[1]?.toLowerCase();
    if (domain !== college.emailDomain.toLowerCase()) {
      const e: any = new Error(
        `That Google account is @${domain || 'unknown'} — use your @${college.emailDomain} account, or verify with a code instead`,
      );
      e.status = 400; e.code = 'COLLEGE_DOMAIN_MISMATCH'; throw e;
    }
    funnelCollege = { id: college.id, name: college.name, emailDomain: college.emailDomain };
  }

  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId: g.googleId }, { email: g.email }] },
  });

  let created = false;
  if (user) {
    if (!user.isActive) throw new Error('This account has been deactivated');
    // Link by email match (same proven inbox) or by known googleId — never
    // attach a Google identity to a row holding a DIFFERENT email.
    if (!user.googleId) {
      if (user.email.toLowerCase() !== g.email.toLowerCase()) {
        const e: any = new Error('This Google account belongs to a different email — use the matching one');
        e.status = 403; throw e;
      }
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId: g.googleId } });
    }
    if (funnelCollege) {
      // College lock respected: fill only when empty, refuse cross-college.
      if (!user.collegeId) {
        user = await prisma.user.update({ where: { id: user.id }, data: { collegeId: funnelCollege.id } });
      } else if (user.collegeId !== funnelCollege.id) {
        const e: any = new Error('Your college is already set. Contact support to change it.');
        e.status = 403; throw e;
      }
      // Google proved THIS exact inbox and the domain matches the college:
      // identical assurance to completing OTP — verify instantly.
      if (!user.collegeEmailVerified && user.email.toLowerCase() === g.email.toLowerCase()) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            collegeEmail: g.email,
            collegeEmailVerified: true,
            collegeEmailVerifiedAt: new Date(),
            verificationStatus: 'VERIFIED',
            isVerified: true,
          },
        });
        invalidateUser(user.id);
      }
    }
  } else if (funnelCollege) {
    // New funnel account — verified from birth: Google proved the inbox and
    // the domain matches. Password comes later via setInitialPassword.
    created = true;
    const username = await availableHandle(baseHandle(g.name, g.email));
    const displayName = (g.name || g.email.split('@')[0]).slice(0, 50);
    // passwordHash is NOT NULL: park a random secret no one can guess or use.
    user = await prisma.user.create({
      data: {
        email: g.email,
        passwordHash: crypto.randomUUID() + crypto.randomUUID(),
        googleId: g.googleId,
        username,
        displayName,
        avatarUrl: g.picture || undefined,
        collegeId: funnelCollege.id,
        collegeEmail: g.email,
        collegeEmailVerified: true,
        collegeEmailVerifiedAt: new Date(),
        verificationStatus: 'VERIFIED',
        isVerified: true,
      },
    });
  } else {
    // New account — replicate exactly what funnel signup creates (minus the
    // college): passwordless, UNVERIFIED, no college yet.
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
      avatarPhotoId: (user as any).avatarPhotoId ?? null,
      avatarColor: user.avatarColor,
      collegeId: user.collegeId ?? null,
      isProfileSetup: !!(user.collegeId && user.course),
      collegeEmailVerified: user.collegeEmailVerified ?? false,
      verificationStatus: user.verificationStatus ?? 'UNVERIFIED',
      hasPassword: isPasswordSet(user.passwordHash),
    },
  };
}
