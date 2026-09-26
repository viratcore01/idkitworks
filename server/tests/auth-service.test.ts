import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { AuthService } from '../src/services/auth.service';
import { FakeDb, install, makeUser, makeCollege, rejectsWithStatus, FakeDbOptions } from './helpers/fake-db';
import { isPasswordSet, hashPassword } from '../src/utils/password';

const COLLEGE_ID = 'college-1';
const DOMAIN_EMAIL = 'student@ipec.org.in';
/** What signup parks in password_hash until the funnel sets a real one. */
const PLACEHOLDER = '11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222';

/** Fresh fake DB + service per test — no state leaks between cases. */
function setup(seed: FakeDbOptions = {}) {
  const db = new FakeDb({ colleges: [makeCollege()], ...seed });
  install(db, prisma);
  return { db, svc: new AuthService() };
}

const validSignup = {
  collegeId: COLLEGE_ID,
  email: DOMAIN_EMAIL,
  displayName: 'Test Student',
};

// ─────────────────────────── signup: input validation ───────────────────────

test('signup rejects malformed payloads before touching the database', async () => {
  const { svc } = setup();
  const bad: any[] = [
    undefined,
    {},
    { ...validSignup, collegeId: '' },
    { ...validSignup, email: 'not-an-email' },
    { ...validSignup, displayName: 'x' }, // too short
    { ...validSignup, displayName: 'a'.repeat(51) },
  ];
  for (const payload of bad) {
    await rejectsWithStatus(() => svc.signup(payload), 400);
  }
});

test('signup refuses an unknown college', async () => {
  const { svc } = setup();
  await rejectsWithStatus(() => svc.signup({ ...validSignup, collegeId: 'nope' }), 400);
});

test('signup refuses a college that has no student-mail domain (un-onboarded campus)', async () => {
  const { svc } = setup({ colleges: [makeCollege({ id: 'college-2', name: 'Not Ready College', emailDomain: null })] });
  const err = await rejectsWithStatus(
    () => svc.signup({ ...validSignup, collegeId: 'college-2' }),
    400,
    'COLLEGE_NOT_ONBOARDED',
  );
  assert.match(err.message, /not onboarded/i);
});

test('signup refuses an email outside the college domain', async () => {
  const { svc } = setup();
  const err = await rejectsWithStatus(
    () => svc.signup({ ...validSignup, email: 'student@gmail.com' }),
    400,
    'COLLEGE_DOMAIN_MISMATCH',
  );
  assert.match(err.message, /@ipec\.org\.in/);
});

test('signup refuses disposable inboxes even on a plausible-looking domain', async () => {
  const { svc } = setup({
    colleges: [makeCollege({ emailDomain: 'mailinator.com' })],
  });
  await rejectsWithStatus(
    () => svc.signup({ ...validSignup, email: 'x@mailinator.com' }),
    400,
    'EMAIL_INVALID',
  );
});

test('signup surfaces a typo suggestion instead of creating the account', async () => {
  const { db, svc } = setup({ colleges: [makeCollege({ emailDomain: 'gmial.com' })] });
  const err = await rejectsWithStatus(
    () => svc.signup({ ...validSignup, email: 'student@gmial.com' }),
    400,
    'EMAIL_TYPO',
  );
  assert.equal(err.suggestion, 'student@gmail.com');
  assert.equal(db.rows('user').length, 0, 'a typo must not create a row');
});

// ─────────────────────────── signup: the happy path ─────────────────────────

test('signup creates a passwordless, unverified account and issues a session', async () => {
  const { db, svc } = setup();
  const result = await svc.signup(validSignup);

  assert.ok(result.accessToken && result.refreshToken);
  assert.equal(result.user.email, DOMAIN_EMAIL);
  assert.equal(result.user.collegeId, COLLEGE_ID);
  assert.equal(result.user.hasPassword, false, 'funnel accounts start with no password');
  assert.equal(result.user.collegeEmailVerified, false);
  assert.equal(result.user.verificationStatus, 'UNVERIFIED');

  const row = db.rows('user')[0];
  assert.equal(isPasswordSet(row.passwordHash), false, 'stored hash must be an unusable placeholder');
  assert.equal(row.collegeEmail, DOMAIN_EMAIL, 'the pending college email is remembered for resend/status');
  assert.equal(row.collegeEmailVerified, false);
  assert.ok(/^[a-z0-9_]{3,20}$/.test(row.username), `a placeholder handle is minted: ${row.username}`);
  assert.equal(row.usernameChosen, false, 'the real handle is picked later, in profile setup');
  assert.equal(result.user.usernameChosen, false);
  assert.equal(db.rows('refreshToken').length, 1, 'a refresh session row is stored');
});

test('signup ignores a client-sent username (legacy callers) and still mints a placeholder', async () => {
  // Old app versions POSTed a username with signup; the server owns the handle
  // now, so the field is ignored — never trusted, never a 400.
  const { db, svc } = setup();
  const result = await (svc.signup as any)({ ...validSignup, username: 'admin' });
  assert.ok(result.accessToken);
  assert.notEqual(db.rows('user')[0].username, 'admin', 'a smuggled handle never lands on the row');
  assert.equal(db.rows('user')[0].usernameChosen, false);
});

test('signup normalizes email casing', async () => {
  const { svc } = setup();
  const result = await svc.signup({ ...validSignup, email: 'Student@IPEC.org.in' });
  assert.equal(result.user.email, 'student@ipec.org.in');
});

// ─────────────────────────── signup: conflicts ──────────────────────────────

test('signup refuses an email that belongs to a real (password-bearing) account', async () => {
  const { svc } = setup({ users: [makeUser({ email: DOMAIN_EMAIL, username: 'other', collegeEmail: DOMAIN_EMAIL })] });
  await rejectsWithStatus(() => svc.signup(validSignup), 409);
});

test('signup never 409s on a handle: a colliding placeholder is suffixed, not refused', async () => {
  // The handle is generated, so somebody holding the stem must not block the
  // signup — the generator just moves to a suffixed candidate.
  const { db, svc } = setup({
    users: [makeUser({ email: 'someone@ipec.org.in', username: 'taken', collegeEmail: 'someone@ipec.org.in' })],
  });
  const result = await svc.signup({ ...validSignup, displayName: 'Taken' });
  assert.ok(result.accessToken);
  assert.match(db.rows('user')[1].username, /^taken\d{3}$/);
});

test('signup refuses a college email already claimed by another account', async () => {
  // Legacy row: personal email, but the college address is already attached.
  const { svc } = setup({
    users: [makeUser({ id: 'legacy', email: 'x@gmail.com', username: 'legacy', collegeEmail: DOMAIN_EMAIL })],
  });
  await rejectsWithStatus(() => svc.signup(validSignup), 409);
});

test('signup answers 409, never 500, when the database reports a unique violation', async () => {
  const { svc } = setup();
  // Simulate losing a race: the pre-check passes, the INSERT hits UNIQUE.
  (prisma as any).user.create = async () => {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  };
  await rejectsWithStatus(() => svc.signup(validSignup), 409);
});

// ─────────────────────── signup: resume (abandoned funnel) ──────────────────

test('RESUME: an abandoned signup continues instead of 409-ing, and creates no duplicate row', async () => {
  const { db, svc } = setup({
    users: [makeUser({ email: DOMAIN_EMAIL, username: 'student', collegeEmail: DOMAIN_EMAIL, displayName: 'Old Name', passwordHash: PLACEHOLDER })],
  });
  const result = await svc.signup({ ...validSignup, displayName: 'New Name' });

  assert.ok(result.accessToken, 'the unfinished claimant gets a session back');
  assert.equal(db.rows('user').length, 1, 'no second row');
  assert.equal(db.rows('user')[0].displayName, 'New Name');
  assert.equal(result.user.hasPassword, false);
});

test('RESUME: a corrected email re-points the pending account (pre-verification only)', async () => {
  const { db, svc } = setup({
    users: [makeUser({ email: DOMAIN_EMAIL, username: 'student', collegeEmail: DOMAIN_EMAIL, passwordHash: PLACEHOLDER })],
  });
  // The wizard holds the session minted at creation, so the service resumes
  // the caller's own draft (the second call carries the first call's user id,
  // exactly like the client's Bearer token does).
  await svc.signup({ ...validSignup, email: 'newstudent@ipec.org.in' }, 'user-1');

  const row = db.rows('user')[0];
  assert.equal(row.email, 'newstudent@ipec.org.in');
  assert.equal(row.collegeEmail, 'newstudent@ipec.org.in');
  assert.equal(db.rows('user').length, 1);
});

test('RESUME: a DRAFT may move to another college — the "wrong college, start over" path', async () => {
  // Nothing about a draft is proven and no college-scoped row exists for it
  // yet (no posts, matches or chats), so the wizard may redo step 1. The new
  // college and address passed the same domain + hygiene gates as a fresh
  // signup, and the row stays UNVERIFIED — a fresh code is still required.
  const { db, svc } = setup({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other College', emailDomain: 'other.edu' })],
    users: [makeUser({ email: DOMAIN_EMAIL, username: 'student', collegeId: 'college-2', collegeEmail: DOMAIN_EMAIL, passwordHash: PLACEHOLDER })],
  });
  const result = await svc.signup({ ...validSignup, collegeId: 'college-2', email: 'student@other.edu' }, 'user-1');

  assert.equal(result.user.collegeId, 'college-2');
  assert.equal(db.rows('user').length, 1, 'a move never creates a second row');
  assert.equal(db.rows('user')[0].collegeEmailVerified, false, 'the move still needs a fresh code');
  assert.equal(db.rows('user')[0].collegeEmail, 'student@other.edu');
});

test('RESUME: a move is refused once the inbox is PROVEN (that is not a wizard action)', async () => {
  const { db, svc } = setup({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other College', emailDomain: 'other.edu' })],
    users: [makeUser({
      id: 'verified', email: DOMAIN_EMAIL, username: 'student', collegeId: COLLEGE_ID, collegeEmail: DOMAIN_EMAIL,
      collegeEmailVerified: true, verificationStatus: 'VERIFIED', passwordHash: PLACEHOLDER,
    })],
  });
  // Same inbox, still holding the proven row's session: the proven account is
  // never re-claimed — not even by its own wizard coming back around.
  await rejectsWithStatus(() => svc.signup(validSignup, 'verified'), 409, 'ALREADY_VERIFIED');
  assert.equal(db.rows('user')[0].collegeId, COLLEGE_ID, 'the proven boundary never moves');
  assert.equal(db.rows('user').length, 1, 'no second row either');
});

test('RESUME: a college-LESS account adopts the college the wizard collected (redo the college step)', async () => {
  // Pre-funnel rows exist with no college and no password. "Going back to the
  // college step" is the only screen that can fix them, so the wizard must be
  // able to fill the empty college — while a row that already HAS one still
  // refuses to move (asserted below).
  const { db, svc } = setup({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other College', emailDomain: 'other.edu' })],
    users: [makeUser({ email: DOMAIN_EMAIL, username: 'student', collegeId: null, collegeEmail: null, passwordHash: PLACEHOLDER })],
  });
  const result = await svc.signup(validSignup);

  assert.ok(result.accessToken);
  assert.equal(result.user.collegeId, COLLEGE_ID, 'the wizard pick is adopted');
  assert.equal(db.rows('user').length, 1, 'still one account, never a duplicate');

  // And it STAYS movable while nothing is proven: redoing the wizard for another
  // campus adopts the new pick (still no session for a stranger, still one
  // account, still a fresh code required).
  await svc.signup({ ...validSignup, collegeId: 'college-2', email: 'student@other.edu' }, 'user-1');
  assert.equal(db.rows('user').length, 1);
  assert.equal(db.rows('user')[0].collegeId, 'college-2');
  assert.equal(db.rows('user')[0].collegeEmailVerified, false);
});

test('RESUME: a verified account can never be resumed (no session for an existing secret)', async () => {
  const { svc } = setup({
    users: [makeUser({ email: DOMAIN_EMAIL, username: 'student', collegeEmailVerified: true, verificationStatus: 'VERIFIED', passwordHash: PLACEHOLDER })],
  });
  await rejectsWithStatus(() => svc.signup(validSignup), 409);
});

test('RESUME: a password-bearing but unverified account continues with its OWN session (no login → signup → "in use" loop)', async () => {
  // The loop: signup 409s "Email already in use" → user logs in fine → the
  // funnel bounces them into the wizard → the wizard asks for the email →
  // 409 again, forever (the OTP send sits behind this call). With their own
  // session the wizard must continue to the OTP step instead.
  // NOTE: makeUser's default hash is a real $2a bcrypt (password-bearing)
  // with UNVERIFIED status — exactly the legacy shape.
  const { db, svc } = setup({
    users: [makeUser({ id: 'legacy', email: DOMAIN_EMAIL, username: 'student' })],
  });
  const res: any = await svc.signup(validSignup, 'legacy');
  assert.equal(res.user.id, 'legacy', 'same row continues, no duplicate');
  assert.ok(res.accessToken, 'a fresh session is issued for the row');
  assert.equal(db.rows('user').length, 1);
  assert.equal(db.rows('refreshToken').length, 1);
});

test('SECURITY: a stranger’s session (or none) still 409s on a password-bearing unverified row', async () => {
  const { db, svc } = setup({
    users: [makeUser({ id: 'legacy', email: DOMAIN_EMAIL, username: 'student' })],
  });
  await rejectsWithStatus(() => svc.signup(validSignup), 409);
  await rejectsWithStatus(() => svc.signup(validSignup, 'someone-else'), 409);
  assert.equal(db.rows('refreshToken').length, 0, 'no session is minted for strangers');
  assert.equal(db.rows('user').length, 1);
});

test('SECURITY: a VERIFIED but passwordless account is never re-claimed by a fresh signup', async () => {
  // The dangerous case: the row exists, its inbox is proven, and no password
  // was set yet — so if signup handed out a session here, anyone who merely
  // KNOWS the address would get a session AND (being verified) the right to
  // set the initial password. Starting a signup requires no secret, so this
  // must fail, with a code that lets the honest client continue instead of
  // showing a dead-end "already in use".
  const { db, svc } = setup({
    users: [makeUser({
      email: DOMAIN_EMAIL, username: 'student', collegeEmail: DOMAIN_EMAIL,
      collegeEmailVerified: true, verificationStatus: 'VERIFIED', passwordHash: PLACEHOLDER,
    })],
  });
  const err = await rejectsWithStatus(() => svc.signup(validSignup), 409, 'ALREADY_VERIFIED');
  assert.match(err.message, /continue where you left off/i);
  assert.equal(db.rows('refreshToken').length, 0, 'no session is minted for a proven account');
  assert.equal(db.rows('user').length, 1);
});

test('RESUME: a Google-created passwordless account is not silently re-pointed by a fresh signup', async () => {
  // Pending rows have no college; re-running the wizard for a DIFFERENT college
  // must not move that identity (college is the isolation boundary).
  const { svc } = setup({
    users: [makeUser({ id: 'g', email: 'g@gmail.com', username: 'g', collegeId: null, googleId: 'g-1' })],
  });
  await rejectsWithStatus(() => svc.signup({ ...validSignup, email: 'g@gmail.com' }), 400, 'COLLEGE_DOMAIN_MISMATCH');
});

// ───────────────────── signup: stale-row housekeeping ───────────────────────

test('housekeeping purges abandoned signups older than 7 days, never real accounts', async () => {
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  const { db, svc } = setup({
    users: [
      makeUser({ id: 'abandoned', email: 'a@ipec.org.in', username: 'aaa', collegeEmail: 'a@ipec.org.in', passwordHash: PLACEHOLDER, createdAt: old }),
      makeUser({ id: 'has-password', email: 'b@ipec.org.in', username: 'bbb', collegeEmail: 'b@ipec.org.in', createdAt: old }),
      makeUser({ id: 'recent', email: 'c@ipec.org.in', username: 'ccc', collegeEmail: 'c@ipec.org.in', passwordHash: PLACEHOLDER, createdAt: new Date(Date.now() - 60_000) }),
    ],
  });
  await svc.signup({ ...validSignup, email: 'd@ipec.org.in' });

  const ids = db.rows('user').map((u) => u.id);
  assert.equal(ids.includes('abandoned'), false, 'stale passwordless signup is reclaimed');
  assert.equal(ids.includes('has-password'), true, 'an account with a password is never purged');
  assert.equal(ids.includes('recent'), true, 'fresh signups are untouched');
});

// ───────────────────────── setInitialPassword gating ────────────────────────

test('setInitialPassword refuses unverified accounts (session auth is not enough)', async () => {
  const { svc } = setup({ users: [makeUser()] });
  await rejectsWithStatus(() => svc.setInitialPassword('user-1', 'longenough1'), 403, 'VERIFICATION_REQUIRED');
});

test('setInitialPassword refuses an account that already has a password', async () => {
  const { db, svc } = setup({ users: [makeUser({ collegeEmailVerified: true, verificationStatus: 'VERIFIED' })] });
  await rejectsWithStatus(() => svc.setInitialPassword('user-1', 'longenough1'), 400);
  assert.equal(isPasswordSet(db.rows('user')[0].passwordHash), true, 'the original hash is untouched');
});

test('setInitialPassword enforces the 8-128 length window', async () => {
  const { svc } = setup({ users: [makeUser({ passwordHash: PLACEHOLDER, collegeEmailVerified: true, verificationStatus: 'VERIFIED' })] });
  await rejectsWithStatus(() => svc.setInitialPassword('user-1', 'short'), 400);
  await rejectsWithStatus(() => svc.setInitialPassword('user-1', 'x'.repeat(129)), 400);
  await rejectsWithStatus(() => svc.setInitialPassword('user-1', ''), 400);
});

test('setInitialPassword refuses an unknown or deactivated account', async () => {
  const { svc } = setup({ users: [makeUser({ id: 'off', passwordHash: PLACEHOLDER, collegeEmailVerified: true, isActive: false })] });
  await rejectsWithStatus(() => svc.setInitialPassword('ghost', 'longenough1'), 401);
  await rejectsWithStatus(() => svc.setInitialPassword('off', 'longenough1'), 401);
});

test('setInitialPassword succeeds for a verified, passwordless account', async () => {
  const { db, svc } = setup({ users: [makeUser({ passwordHash: PLACEHOLDER, collegeEmailVerified: true, verificationStatus: 'VERIFIED' })] });
  await svc.setInitialPassword('user-1', 'brand-new-pass');
  assert.equal(isPasswordSet(db.rows('user')[0].passwordHash), true);
  assert.equal(await svc.login(DOMAIN_EMAIL, 'brand-new-pass').then(() => true, () => false), true);
});

// ──────────────────────────────── login ────────────────────────────────────

test('login accepts email or username, case-insensitively', async () => {
  const hash = await hashPassword('real-password-1');
  const { svc } = setup({ users: [makeUser({ passwordHash: hash })] });
  for (const id of ['student@ipec.org.in', 'STUDENT@IPEC.ORG.IN', 'student', 'StUdEnT']) {
    const result = await svc.login(id, 'real-password-1');
    assert.ok(result.accessToken, `login failed for identifier "${id}"`);
    assert.equal(result.user.email, 'student@ipec.org.in');
  }
});

test('login mints a working session for correct credentials', async () => {
  const { db, svc } = setup();
  await svc.signup(validSignup);
  const id = db.rows('user')[0].id;
  // Verification is the gate for setInitialPassword — mark it as the OTP flow would.
  db.rows('user')[0].collegeEmailVerified = true;
  db.rows('user')[0].verificationStatus = 'VERIFIED';
  await svc.setInitialPassword(id, 'real-password-1');

  const result = await svc.login(DOMAIN_EMAIL, 'real-password-1');
  assert.ok(result.accessToken && result.refreshToken);
  assert.equal(result.user.hasPassword, true);
  assert.equal(result.user.id, id);
});

test('SECURITY: unknown identifier and wrong password return the identical error (no enumeration oracle)', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await db.delegate('user'); // no-op, keeps lint quiet about unused db

  let unknownMsg = '';
  let wrongMsg = '';
  try {
    await svc.login('nobody@ipec.org.in', 'whatever');
  } catch (e: any) {
    unknownMsg = e.message;
  }
  try {
    await svc.login('student', 'whatever');
  } catch (e: any) {
    wrongMsg = e.message;
  }
  assert.equal(unknownMsg, 'Invalid email/username or password');
  assert.equal(wrongMsg, unknownMsg);
});

test('SECURITY: a 100KB password is rejected without burning bcrypt CPU', async () => {
  const { svc } = setup({ users: [makeUser()] });
  const started = Date.now();
  await assert.rejects(() => svc.login('student', 'x'.repeat(100_000)), /Invalid email\/username or password/);
  assert.ok(Date.now() - started < 5_000, 'must fail fast');
});

test('login rejects malformed input instead of throwing a 500', async () => {
  const { svc } = setup({ users: [makeUser()] });
  await assert.rejects(() => svc.login('' as any, 'x' as any), /Invalid email\/username or password/);
  await assert.rejects(() => svc.login(undefined as any, undefined as any), /Invalid email\/username or password/);
  await assert.rejects(() => svc.login('student', undefined as any), /Invalid email\/username or password/);
});

test('login tells a suspended account apart — but only after the password proves ownership', async () => {
  const { db, svc } = setup();
  await svc.signup(validSignup);
  const id = db.rows('user')[0].id;
  db.rows('user')[0].collegeEmailVerified = true;
  db.rows('user')[0].verificationStatus = 'VERIFIED';
  await svc.setInitialPassword(id, 'real-password-1');
  db.rows('user')[0].isActive = false;

  const err = await rejectsWithStatus(() => svc.login(DOMAIN_EMAIL, 'real-password-1'), 403);
  assert.match(err.message, /suspended/i);
  // A wrong password on the same account must NOT reveal the suspension.
  await assert.rejects(() => svc.login(DOMAIN_EMAIL, 'wrong-password'), /Invalid email\/username or password/);
});

test('SECURITY: a Google-only account cannot be entered with a password', async () => {
  const { svc } = setup({
    users: [makeUser({ passwordHash: '11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222', googleId: 'g-1' })],
  });
  await assert.rejects(() => svc.login(DOMAIN_EMAIL, 'anything'), /Invalid email\/username or password/);
  await assert.rejects(() => svc.login(DOMAIN_EMAIL, ''), /Invalid email\/username or password/);
});

// ─────────────────────────────── refresh ──────────────────────────────────

test('refresh rotates the token: the old one dies, the new one works', async () => {
  const { db, svc } = setup();
  const first = await svc.signup(validSignup);
  const rotated = await svc.refresh(first.refreshToken);

  assert.notEqual(rotated.refreshToken, first.refreshToken);
  assert.equal(db.rows('refreshToken').length, 1, 'exactly one live session row');
  assert.equal(db.rows('refreshToken')[0].token, rotated.refreshToken);
  await assert.rejects(() => svc.refresh(first.refreshToken), /refreshed elsewhere|Invalid or expired/);
});

test('SECURITY: replaying a rotated (possibly stolen) refresh token is refused', async () => {
  const { svc } = setup();
  const first = await svc.signup(validSignup);
  await svc.refresh(first.refreshToken);
  await rejectsWithStatus(() => svc.refresh(first.refreshToken), 401);
});

test('refresh refuses unknown, malformed, expired, and deactivated-account tokens', async () => {
  const { db, svc } = setup();
  const session = await svc.signup(validSignup);

  await rejectsWithStatus(() => svc.refresh('not-a-real-token'), 401);
  await rejectsWithStatus(() => svc.refresh(undefined as any), 401);
  await rejectsWithStatus(() => svc.refresh('' as any), 401);

  db.rows('refreshToken')[0].expiresAt = new Date(Date.now() - 1000);
  await rejectsWithStatus(() => svc.refresh(session.refreshToken), 401);

  db.rows('refreshToken')[0].expiresAt = new Date(Date.now() + 60_000);
  db.rows('user')[0].isActive = false;
  await rejectsWithStatus(() => svc.refresh(session.refreshToken), 401);
});

test('logout is idempotent and only kills the session it was given', async () => {
  const hash = await hashPassword('real-password-1');
  const { db, svc } = setup({ users: [makeUser({ passwordHash: hash })] });
  const phone = await svc.login(DOMAIN_EMAIL, 'real-password-1');
  const laptop = await svc.login(DOMAIN_EMAIL, 'real-password-1');
  assert.equal(db.rows('refreshToken').length, 2, 'two devices, two sessions');

  await svc.logout(phone.refreshToken);
  assert.equal(db.rows('refreshToken').length, 1, 'the other device stays signed in');
  assert.equal(db.rows('refreshToken')[0].token, laptop.refreshToken);

  // Idempotent + defensive: a repeat call, a missing token, or a junk value
  // must never surface as a 400 to a client that is on its way out.
  await svc.logout(phone.refreshToken);
  await svc.logout(undefined as any);
  await svc.logout('' as any);
  await svc.logout(12345 as any);
  assert.equal(db.rows('refreshToken').length, 1);
});

// ──────────────────────────── changePassword ──────────────────────────────

test('changePassword verifies the current password and kills every session', async () => {
  const { db, svc } = setup();
  const session = await svc.signup(validSignup);
  const id = session.user.id;
  db.rows('user')[0].collegeEmailVerified = true;
  db.rows('user')[0].verificationStatus = 'VERIFIED';
  await svc.setInitialPassword(id, 'first-password');

  await rejectsWithStatus(() => svc.changePassword(id, 'wrong', 'second-password'), 403);
  await rejectsWithStatus(() => svc.changePassword(id, 'first-password', 'short'), 400);

  await svc.changePassword(id, 'first-password', 'second-password');
  assert.equal(db.rows('refreshToken').length, 0, 'a password change logs out every device');
  assert.equal(await svc.login(DOMAIN_EMAIL, 'second-password').then(() => true, () => false), true);
  assert.equal(await svc.login(DOMAIN_EMAIL, 'first-password').then(() => true, () => false), false);
});

// ──────────────────────────────── getMe ────────────────────────────────────

test('getMe derives age from date of birth — it is never a stored field', async () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000);
  const YEAR_DAYS = 365.25;
  const { db, svc } = setup();
  db.rows('user').push(
    makeUser({ id: 'exact', dateOfBirth: daysAgo(20 * YEAR_DAYS) }),
    makeUser({ id: 'just-under', dateOfBirth: daysAgo(20 * YEAR_DAYS - 2) }),
    makeUser({ id: 'just-over', dateOfBirth: daysAgo(20 * YEAR_DAYS + 2) }),
  );

  assert.equal((await svc.getMe('exact')).age, 20);
  assert.equal((await svc.getMe('just-under')).age, 19, 'two days shy of the birthday is still 19');
  assert.equal((await svc.getMe('just-over')).age, 20, 'two days past it is still 20');

  // The value follows the DOB, not a snapshot taken at signup: changing the
  // stored birth date changes the reported age on the very next read.
  db.rows('user').find((u) => u.id === 'exact')!.dateOfBirth = daysAgo(21 * YEAR_DAYS);
  assert.equal((await svc.getMe('exact')).age, 21);
});

test('getMe returns null age when no birth date is on file', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  void db;
  assert.equal((await svc.getMe('user-1')).age, null);
});

test('getMe maps relations and exposes auth-method flags, never the hash', async () => {
  const { svc } = setup({ users: [makeUser()] });
  const me: any = await svc.getMe('user-1');
  assert.equal(me.hasPassword, true);
  assert.equal(me.hasGoogle, false);
  assert.equal(me.username, 'student');
  assert.equal(me.passwordHash, undefined, 'the hash must never leave the server');
  assert.equal(me.isProfileSetup, false, 'no course yet');
});

test('getMe returns the OWNER its own DOB and gender so locked fields can render read-only', async () => {
  // Only ever /auth/me (the owner). Without these the setup screen could not
  // tell "already set" from "never captured" and re-asked for both.
  const dob = new Date('2005-06-15T00:00:00Z');
  const { svc } = setup({ users: [makeUser({ gender: 'FEMALE', dateOfBirth: dob })] });
  const me: any = await svc.getMe('user-1');
  assert.equal(me.gender, 'FEMALE');
  assert.equal(me.dateOfBirth, dob);
  assert.equal(typeof me.age, 'number', 'age is still computed from the DOB (see its own test)');
});

// ───────────────────────── updateProfile: locks ────────────────────────────

test('LOCK: the display name is fixed to what the account was created with', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await rejectsWithStatus(() => svc.updateProfile('user-1', { displayName: 'Someone Else' }), 403);
  // Resubmitting the same name (whitespace differences are fine) is allowed.
  await svc.updateProfile('user-1', { displayName: '  Test Student  ' });
  assert.equal(db.rows('user')[0].displayName, 'Test Student');
});

test('LOCK: a name that was NEVER captured can be filled exactly once, then locks', async () => {
  // A Google token with no `name` claim parks an empty name (no more invented
  // "viratcore01"), so the setup screen asks once — and this is that one time.
  const { db, svc } = setup({ users: [makeUser({ displayName: '', googleId: 'g-1' })] });

  await svc.updateProfile('user-1', { displayName: 'Virat Sisodia' });
  assert.equal(db.rows('user')[0].displayName, 'Virat Sisodia');

  // …and from there it is locked like any other name.
  await rejectsWithStatus(() => svc.updateProfile('user-1', { displayName: 'Someone Else' }), 403);
  assert.equal(db.rows('user')[0].displayName, 'Virat Sisodia');

  // Whitespace-only counts as never captured, so a row cannot be locked to blank.
  const blank = setup({ users: [makeUser({ id: 'blank', displayName: '   ' })] });
  await blank.svc.updateProfile('blank', { displayName: 'A Real Name' });
  assert.equal(blank.db.rows('user')[0].displayName, 'A Real Name');
});

test('a name that is still empty must satisfy the 2-50 rule when it is filled', async () => {
  const { svc } = setup({ users: [makeUser({ displayName: '' })] });
  await assert.rejects(() => svc.updateProfile('user-1', { displayName: 'x' }), /2-50/);
  await assert.rejects(() => svc.updateProfile('user-1', { displayName: 'a'.repeat(51) }), /2-50/);
});

test('LOCK: date of birth is write-once', async () => {
  const { db, svc } = setup({ users: [makeUser({ dateOfBirth: new Date('2005-06-15T00:00:00Z') })] });
  await rejectsWithStatus(() => svc.updateProfile('user-1', { dateOfBirth: '2000-01-01' }), 403);
  // Same calendar day = harmless resubmission (half-finished profiles).
  await svc.updateProfile('user-1', { dateOfBirth: '2005-06-15' });
  assert.equal(db.rows('user')[0].dateOfBirth.toDateString(), new Date('2005-06-15T00:00:00Z').toDateString());
});

test('LOCK: gender is write-once, but settable from the UNKNOWN default', async () => {
  const { db, svc } = setup({ users: [makeUser({ gender: 'UNKNOWN' })] });
  await svc.updateProfile('user-1', { gender: 'FEMALE' });
  assert.equal(db.rows('user')[0].gender, 'FEMALE');
  await rejectsWithStatus(() => svc.updateProfile('user-1', { gender: 'MALE' }), 403);
});

test('LOCK: the college cannot be moved once set, but can be filled when empty', async () => {
  const { db, svc } = setup({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other', emailDomain: 'other.edu' })],
    users: [makeUser({ collegeId: COLLEGE_ID })],
  });
  await rejectsWithStatus(() => svc.updateProfile('user-1', { collegeId: 'college-2' }), 403);
  await svc.updateProfile('user-1', { collegeId: COLLEGE_ID });

  // Legacy Google accounts arrive with no college — the first assignment is legal.
  const legacy = setup({
    colleges: [makeCollege()],
    users: [makeUser({ id: 'g-user', collegeId: null, collegeEmail: null })],
  });
  await legacy.svc.updateProfile('g-user', { collegeId: COLLEGE_ID });
  assert.equal(legacy.db.rows('user')[0].collegeId, COLLEGE_ID);

  // Clearing the college is not an escape hatch either: a null/empty value is
  // ignored, so the assignment above stands.
  await legacy.svc.updateProfile('g-user', { collegeId: null } as any);
  await legacy.svc.updateProfile('g-user', { collegeId: '' } as any);
  assert.equal(legacy.db.rows('user')[0].collegeId, COLLEGE_ID);
});

test('LOCK: the college email can never be written through the profile endpoint', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await rejectsWithStatus(() => svc.updateProfile('user-1', { collegeEmail: 'attacker@ipec.org.in' } as any), 403);
  assert.equal(db.rows('user')[0].collegeEmail, null);
});

// ─────────────────────── updateProfile: validation ─────────────────────────

test('updateProfile rejects an under-16 birth date', async () => {
  const { svc } = setup({ users: [makeUser()] });
  const justUnder = new Date(Date.now() - (16 * 365.25 - 30) * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await assert.rejects(() => svc.updateProfile('user-1', { dateOfBirth: justUnder }), /16/);
});

test('updateProfile rejects impossible birth dates', async () => {
  const { svc } = setup({ users: [makeUser()] });
  const ancient = new Date(Date.now() - 120 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await assert.rejects(() => svc.updateProfile('user-1', { dateOfBirth: ancient }), /Invalid date of birth/);
  await assert.rejects(() => svc.updateProfile('user-1', { dateOfBirth: 'not-a-date' }), /Invalid date of birth/);
});

test('updateProfile validates bio, course, year, gender and avatar URL', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await assert.rejects(() => svc.updateProfile('user-1', { bio: 'x'.repeat(301) }), /300/);
  await assert.rejects(() => svc.updateProfile('user-1', { course: 'x'.repeat(51) }), /50/);
  await assert.rejects(() => svc.updateProfile('user-1', { year: 0 }), /Invalid year/);
  await assert.rejects(() => svc.updateProfile('user-1', { year: 6 }), /Invalid year/);
  await assert.rejects(() => svc.updateProfile('user-1', { gender: 'APACHE_HELICOPTER' }), /Invalid gender/);
  await assert.rejects(() => svc.updateProfile('user-1', { avatarUrl: 'http://insecure.example/a.png' }), /https/);

  await svc.updateProfile('user-1', { bio: 'hi', course: 'CSE', year: 3, avatarUrl: 'https://cdn.example/a.png' });
  assert.equal(db.rows('user')[0].year, 3);
  assert.equal(db.rows('user')[0].course, 'CSE');
});

test('updateProfile dedupes and filters relationship goals, and an empty pick means "rather not say"', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.updateProfile('user-1', { relationshipGoals: ['DATING', 'DATING', 'BOGUS', 'CASUAL'] });
  assert.deepEqual(db.rows('user')[0].relationshipGoals, ['DATING', 'CASUAL']);

  await svc.updateProfile('user-1', { relationshipGoals: [] });
  assert.deepEqual(db.rows('user')[0].relationshipGoals, []);

  await assert.rejects(() => svc.updateProfile('user-1', { relationshipGoals: 'DATING' as any }), /relationship goals/);
});

test('updateProfile caps interests at 15 and validates that they exist', async () => {
  const { db, svc } = setup({
    users: [makeUser()],
    interests: [
      { id: 'i1', name: 'Music', category: null },
      { id: 'i2', name: 'Cricket', category: null },
    ],
  });
  await assert.rejects(() => svc.updateProfile('user-1', { interestIds: Array.from({ length: 16 }, () => 'i1') }), /15/);
  await assert.rejects(() => svc.updateProfile('user-1', { interestIds: ['ghost'] }), /not found/);

  await svc.updateProfile('user-1', { interestIds: ['i1', 'i2'] });
  assert.equal(db.rows('userInterest').length, 2);
  await svc.updateProfile('user-1', { interestIds: ['i1'] });
  assert.equal(db.rows('userInterest').length, 1, 'interests are replaced, not appended');
});

test('updateProfile reports a missing account instead of crashing', async () => {
  const { svc } = setup();
  await rejectsWithStatus(() => svc.updateProfile('ghost', { bio: 'x' }), 404);
});

// ───────────────────────── profile completeness ────────────────────────────

test('profile completeness scores the empty profile at zero and the filled one at 100', async () => {
  const { db, svc } = setup({ users: [makeUser({ collegeId: null, gender: 'UNKNOWN' })] });
  const empty = await svc.getProfileCompleteness('user-1');
  assert.equal(empty.score, 0);
  assert.equal(empty.missing.length, 7);

  Object.assign(db.rows('user')[0], {
    collegeId: COLLEGE_ID,
    bio: 'I study computer science and play cricket.',
    dateOfBirth: new Date('2004-01-01T00:00:00Z'),
    gender: 'FEMALE',
  });
  db.rows('userPhoto').push({ id: 'p1', userId: 'user-1', slot: 0 });
  db.rows('userInterest').push(
    { userId: 'user-1', interestId: 'i1' },
    { userId: 'user-1', interestId: 'i2' },
    { userId: 'user-1', interestId: 'i3' },
  );
  db.rows('matchPreference').push({ id: 'mp1', userId: 'user-1' });

  const full = await svc.getProfileCompleteness('user-1');
  assert.equal(full.score, 100);
  assert.deepEqual(full.missing, []);
});
