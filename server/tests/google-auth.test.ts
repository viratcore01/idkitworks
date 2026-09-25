import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, KeyObject } from 'node:crypto';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import { verifyGoogleIdToken, googleAuth } from '../src/services/google-auth.service';
import { FakeDb, install, makeUser, makeCollege, rejectsWithStatus, FakeDbOptions } from './helpers/fake-db';
import { isPasswordSet } from '../src/utils/password';

const COLLEGE_ID = 'college-1';
const DOMAIN_EMAIL = 'student@ipec.org.in';

// ── A real RSA keypair standing in for Google's signing key ──────────────────
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTHER_KEYS = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';

function jwkFor(key: KeyObject, kid: string) {
  const jwk = key.export({ format: 'jwk' }) as any;
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}

let jwksRequests: string[] = [];
function stubJwks(keys: any[] = [jwkFor(publicKey, KID)]) {
  jwksRequests = [];
  (globalThis as any).fetch = async (url: string) => {
    jwksRequests.push(String(url));
    return { ok: true, json: async () => ({ keys }) } as any;
  };
}

function stubJwksDown() {
  (globalThis as any).fetch = async () => {
    throw new TypeError('fetch failed');
  };
}

/** Mint an ID token exactly the way Google would (RS256 over header.payload). */
function mintToken(
  overrides: Record<string, any> = {},
  opts: { key?: KeyObject; kid?: string; alg?: string; mutatePayload?: (p: any) => any } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    sub: 'google-user-1',
    email: DOMAIN_EMAIL,
    email_verified: true,
    name: 'Test Student',
    picture: 'https://lh3.googleusercontent.com/a/pic',
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
  const finalPayload = opts.mutatePayload ? opts.mutatePayload(payload) : payload;
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(finalPayload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(opts.key ?? privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function setup(seed: FakeDbOptions = {}) {
  const db = new FakeDb({ colleges: [makeCollege()], ...seed });
  install(db, prisma);
  return { db };
}

// ───────────────────────────── token verification ───────────────────────────

test('a genuine Google ID token verifies and yields the identity claims', async () => {
  stubJwks();
  const payload = await verifyGoogleIdToken(mintToken({ email: 'Student@IPEC.org.in' }));
  assert.equal(payload.googleId, 'google-user-1');
  assert.equal(payload.email, 'student@ipec.org.in', 'email is normalized to lower case');
  assert.equal(payload.emailVerified, true);
  assert.equal(payload.name, 'Test Student');
  assert.equal(payload.picture, 'https://lh3.googleusercontent.com/a/pic');
});

test('SECURITY: a token signed by anyone other than Google is rejected', async () => {
  stubJwks();
  await assert.rejects(
    () => verifyGoogleIdToken(mintToken({}, { key: OTHER_KEYS.privateKey })),
    /Invalid Google token signature/,
  );
});

test('SECURITY: tampering with the claims invalidates the signature', async () => {
  stubJwks();
  const token = mintToken();
  const [header, , sig] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, sub: 'someone-else', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  await assert.rejects(() => verifyGoogleIdToken(`${header}.${forged}.${sig}`), /signature/);
});

test('SECURITY: alg confusion — a non-RS256 token is refused before any key work', async () => {
  stubJwks();
  await assert.rejects(() => verifyGoogleIdToken(mintToken({}, { alg: 'HS256' })), /Unsupported token algorithm/);
  await assert.rejects(() => verifyGoogleIdToken(mintToken({}, { alg: 'none' })), /Unsupported token algorithm/);
});

test('SECURITY: a token minted for a different app (wrong aud) is refused', async () => {
  stubJwks();
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ aud: 'someone-elses-client-id' })), /not issued for this app/);
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ aud: undefined })), /not issued for this app/);
});

test('SECURITY: expired and future-dated tokens are refused', async () => {
  stubJwks();
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ exp: now - 60 })), /expired/);
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ exp: undefined })), /expired/);
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ iat: now + 600 })), /issued in the future/);
});

test('SECURITY: wrong issuer and unverified Google email are refused', async () => {
  stubJwks();
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ iss: 'https://evil.example' })), /Wrong token issuer/);
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ email_verified: false })), /not verified/);
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ email_verified: undefined })), /not verified/);
});

test('SECURITY: a nonce-bearing token is refused (this endpoint is not a redirect flow)', async () => {
  stubJwks();
  await assert.rejects(() => verifyGoogleIdToken(mintToken({ nonce: 'abc' })), /Unexpected nonce/);
});

test('malformed tokens are refused without a 500', async () => {
  stubJwks();
  for (const bad of ['', 'a', 'a.b', 'a.b.c.d', 'not.base64.here', '....']) {
    await assert.rejects(() => verifyGoogleIdToken(bad));
  }
});

test('an unknown signing key forces one JWKS refetch, then fails closed', async () => {
  stubJwks(); // cache the good key
  await verifyGoogleIdToken(mintToken());
  const before = jwksRequests.length;

  await assert.rejects(() => verifyGoogleIdToken(mintToken({}, { kid: 'rotated-key' })), /Unknown Google signing key/);
  assert.equal(jwksRequests.length, before + 1, 'a rotated key triggers exactly one refetch');
});

test('the JWKS is cached: repeated verifications do not re-hit Google', async () => {
  stubJwks();
  await verifyGoogleIdToken(mintToken());
  const after = jwksRequests.length;
  await verifyGoogleIdToken(mintToken());
  await verifyGoogleIdToken(mintToken());
  assert.equal(jwksRequests.length, after, 'no extra network calls inside the TTL');
});

test('a Google outage surfaces as an honest 503, never a raw fetch error', async () => {
  stubJwksDown();
  const err = await rejectsWithStatus(
    () => verifyGoogleIdToken(mintToken({}, { kid: 'uncached-kid' })),
    503,
    'GOOGLE_UNAVAILABLE',
  );
  assert.match(err.message, /temporarily unavailable/);
  assert.ok(err.cause, 'the transport reason is kept for the server log');
});

test('when Google Sign-In is not configured the endpoint says so instead of 500-ing', async () => {
  const original = env.GOOGLE_CLIENT_ID;
  (env as any).GOOGLE_CLIENT_ID = '';
  try {
    const err = await rejectsWithStatus(() => verifyGoogleIdToken(mintToken()), 503, 'GOOGLE_NOT_CONFIGURED');
    assert.match(err.message, /not configured/);
  } finally {
    (env as any).GOOGLE_CLIENT_ID = original;
  }
});

// ─────────────────────────── the funnel handler ─────────────────────────────

test('Google signup with a funnel college creates an instantly VERIFIED account', async () => {
  stubJwks();
  const { db } = setup();
  const result = await googleAuth(mintToken(), COLLEGE_ID);

  assert.equal(result.created, true);
  assert.equal(result.user.email, DOMAIN_EMAIL);
  assert.equal(result.user.collegeId, COLLEGE_ID);
  assert.equal(result.user.collegeEmailVerified, true, 'Google already proved this inbox');
  assert.equal(result.user.verificationStatus, 'VERIFIED');
  assert.equal(result.user.hasPassword, false, 'password comes later via setInitialPassword');
  assert.equal(result.user.avatarUrl, 'https://lh3.googleusercontent.com/a/pic');

  const row = db.rows('user')[0];
  assert.equal(isPasswordSet(row.passwordHash), false, 'the parked secret is unusable as a password');
  assert.ok(/^[a-z0-9_]{3,20}$/.test(row.username), `generated username is valid: ${row.username}`);
  assert.equal(db.rows('refreshToken').length, 1);
});

test('SECURITY: a Gmail account can never auto-verify into a college it does not belong to', async () => {
  stubJwks();
  const { db } = setup();
  await rejectsWithStatus(() => googleAuth(mintToken({ email: 'someone@gmail.com' }), COLLEGE_ID), 400, 'COLLEGE_DOMAIN_MISMATCH');
  assert.equal(db.rows('user').length, 0, 'no junk row is created on a mismatch');
});

test('Google signup refuses an unknown or un-onboarded college', async () => {
  stubJwks();
  setup();
  await rejectsWithStatus(() => googleAuth(mintToken(), 'no-such-college'), 400);
  setup({ colleges: [makeCollege({ emailDomain: null })] });
  await rejectsWithStatus(() => googleAuth(mintToken(), COLLEGE_ID), 400, 'COLLEGE_NOT_ONBOARDED');
});

test('Google login (no college) creates a passwordless, unverified, college-less account', async () => {
  stubJwks();
  const { db } = setup();
  const result = await googleAuth(mintToken({ email: 'personal@gmail.com' }));

  assert.equal(result.created, true);
  assert.equal(result.user.collegeId, null);
  assert.equal(result.user.verificationStatus, 'UNVERIFIED');
  assert.equal(db.rows('user').length, 1);
});

test('an existing email/password account is linked to Google — and its password keeps working', async () => {
  stubJwks();
  const { db } = setup({ users: [makeUser({ collegeEmail: DOMAIN_EMAIL })] });
  const result = await googleAuth(mintToken());
  assert.equal(result.created, false);
  assert.equal(db.rows('user').length, 1, 'linking never duplicates the account');
  assert.equal(db.rows('user')[0].googleId, 'google-user-1');
  assert.equal(isPasswordSet(db.rows('user')[0].passwordHash), true, 'the existing password is untouched');
});

test('SECURITY: Google is never attached to a row holding a different email', async () => {
  stubJwks();
  setup({ users: [makeUser({ id: 'x', email: 'other@gmail.com', username: 'other' })] });
  // A brand-new Google identity whose email collides with an unlinked row of a
  // DIFFERENT address must create its own account, never inherit that row.
  const result = await googleAuth(mintToken({ sub: 'google-user-9', email: 'attacker@gmail.com' }));
  assert.equal(result.created, true);
  assert.equal(result.user.email, 'attacker@gmail.com');
});

test('SECURITY: a row already bound to another Google identity cannot be entered', async () => {
  stubJwks();
  setup({
    users: [makeUser({ id: 'x', email: 'other@gmail.com', username: 'other', googleId: 'google-user-1' })],
  });
  // Same email, different Google identity → fail closed.
  await rejectsWithStatus(() => googleAuth(mintToken({ sub: 'google-user-2', email: 'other@gmail.com' })), 403);
});

test('an existing account keeps its college, and a cross-college Google signup is refused', async () => {
  stubJwks();
  const { db } = setup({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other', emailDomain: 'other.edu' })],
    users: [makeUser({ id: 'g-user', collegeId: null, collegeEmail: null, googleId: 'google-user-1', email: DOMAIN_EMAIL })],
  });
  // First funnel pass fills the empty college and verifies.
  const first = await googleAuth(mintToken(), COLLEGE_ID);
  assert.equal(first.user.collegeId, COLLEGE_ID);
  assert.equal(db.rows('user')[0].collegeEmailVerified, true);

  // Second pass with a different college must not move the account. The Google
  // email has to match that college's domain to reach the lock (a mismatch is
  // refused earlier, on the domain check).
  await rejectsWithStatus(
    () => googleAuth(mintToken({ email: 'student@other.edu' }), 'college-2'),
    403,
  );
  assert.equal(db.rows('user')[0].collegeId, COLLEGE_ID);
  assert.equal(db.rows('user')[0].collegeEmail, DOMAIN_EMAIL, 'the verified email is unchanged too');
});

test('a deactivated account cannot sign in with Google', async () => {
  stubJwks();
  setup({ users: [makeUser({ googleId: 'google-user-1', isActive: false })] });
  await assert.rejects(() => googleAuth(mintToken()), /deactivated/);
});

test('a Google-created account can never be entered through the password form', async () => {
  stubJwks();
  const { db } = setup();
  await googleAuth(mintToken({ email: 'personal@gmail.com' }));
  const row = db.rows('user')[0];
  assert.equal(isPasswordSet(row.passwordHash), false);
  assert.equal(await import('../src/utils/password').then((m) => m.comparePassword('anything', row.passwordHash)), false);
});
