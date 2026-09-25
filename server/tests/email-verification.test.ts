import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { EmailVerificationService } from '../src/services/email-verification.service';
import { FakeDb, install, makeUser, makeCollege, rejectsWithStatus, FakeDbOptions } from './helpers/fake-db';

const COLLEGE_ID = 'college-1';
const EMAIL = 'student@ipec.org.in';

function setup(seed: FakeDbOptions = {}) {
  const db = new FakeDb({ colleges: [makeCollege()], ...seed });
  install(db, prisma);
  return { db, svc: new EmailVerificationService() };
}

/** The code the service just mailed (dev transport logs it; the row is the truth). */
function liveCode(db: FakeDb): string {
  const live = db
    .rows('emailOtp')
    .filter((o) => !o.usedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  assert.ok(live.length, 'expected a live OTP row');
  return live[0].code;
}

// ───────────────────────────────── send ────────────────────────────────────

test('sendOtp refuses a malformed address', async () => {
  const { svc } = setup({ users: [makeUser()] });
  for (const bad of ['', 'nope', 'a@b', 'x y@ipec.org.in', `${'x'.repeat(250)}@ipec.org.in`]) {
    await rejectsWithStatus(() => svc.sendOtp('user-1', bad), 400);
  }
});

test('sendOtp refuses an unknown user', async () => {
  const { svc } = setup();
  await rejectsWithStatus(() => svc.sendOtp('ghost', EMAIL), 404);
});

test('sendOtp requires a college on the account', async () => {
  const { svc } = setup({ users: [makeUser({ collegeId: null })] });
  await rejectsWithStatus(() => svc.sendOtp('user-1', EMAIL), 400);
});

test('sendOtp refuses a campus that is not onboarded for verification', async () => {
  const { svc } = setup({
    colleges: [makeCollege({ emailDomain: null })],
    users: [makeUser()],
  });
  await rejectsWithStatus(() => svc.sendOtp('user-1', EMAIL), 400);
});

test('sendOtp refuses an address outside the college domain', async () => {
  const { svc } = setup({ users: [makeUser()] });
  const err = await rejectsWithStatus(() => svc.sendOtp('user-1', 'student@gmail.com'), 400);
  assert.match(err.message, /@ipec\.org\.in/);
});

test('sendOtp refuses an address already verified by someone else', async () => {
  const { svc } = setup({
    users: [
      makeUser({ id: 'other-user', email: 'other@ipec.org.in', username: 'other', collegeEmail: EMAIL, collegeEmailVerified: true }),
      makeUser({ id: 'user-1', email: 'me@ipec.org.in', username: 'me' }),
    ],
  });
  await rejectsWithStatus(() => svc.sendOtp('user-1', EMAIL), 409);
});

test('sendOtp refuses an already-verified account', async () => {
  const { svc } = setup({ users: [makeUser({ collegeEmailVerified: true, verificationStatus: 'VERIFIED' })] });
  await rejectsWithStatus(() => svc.sendOtp('user-1', EMAIL), 400);
});

test('sendOtp mails a 6-digit code, remembers the address, and expires it in 10 minutes', async () => {
  const { db, svc } = setup({ users: [makeUser({ collegeEmail: null })] });
  const result = await svc.sendOtp('user-1', '  STUDENT@IPEC.ORG.IN  ');

  assert.deepEqual(result, { sent: true, expiresIn: 600 });

  const otp = db.rows('emailOtp')[0];
  assert.match(otp.code, /^\d{6}$/);
  assert.equal(otp.email, EMAIL, 'the address is normalized');
  assert.equal(otp.userId, 'user-1');
  assert.equal(otp.purpose, 'COLLEGE_EMAIL_VERIFY');
  assert.equal(otp.usedAt, null);
  const ttlMinutes = (otp.expiresAt.getTime() - otp.createdAt.getTime()) / 60_000;
  assert.ok(Math.abs(ttlMinutes - 10) < 0.1, `TTL should be ~10 minutes, got ${ttlMinutes}`);

  assert.equal(db.rows('user')[0].collegeEmail, EMAIL, 'resend/status need the pending address on the profile');
  assert.equal(db.rows('user')[0].collegeEmailVerified, false, 'sending a code does NOT verify anyone');
});

test('sendOtp keeps exactly one usable code at a time — the newest wins', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.sendOtp('user-1', EMAIL);
  const first = liveCode(db);
  await svc.sendOtp('user-1', EMAIL);

  assert.equal(liveCode(db) !== first || db.rows('emailOtp').length === 2, true);
  assert.equal(
    db.rows('emailOtp').filter((o) => !o.usedAt).length,
    1,
    'only the newest code can be redeemed',
  );
});

test('RATE LIMIT: sends are capped per user, not just per IP', async () => {
  const { db, svc } = setup({ users: [makeUser()] });

  for (let i = 0; i < 3; i++) await svc.sendOtp('user-1', EMAIL);
  const err = await rejectsWithStatus(() => svc.sendOtp('user-1', EMAIL), 429);
  assert.match(err.message, /10 minutes/);
  // The old code must still work — a throttled request changes nothing.
  assert.equal(db.rows('emailOtp').filter((o) => !o.usedAt).length, 1);
});

test('RATE LIMIT: the window slides — sends older than 10 minutes stop counting', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  const stale = new Date(Date.now() - 11 * 60 * 1000);
  for (let i = 0; i < 5; i++) {
    db.rows('emailOtp').push({
      id: `old-${i}`, userId: 'user-1', email: EMAIL, code: '111111',
      purpose: 'COLLEGE_EMAIL_VERIFY', attempts: 0,
      expiresAt: new Date(stale.getTime() + 60_000), usedAt: new Date(), createdAt: stale,
    });
  }
  const result = await svc.sendOtp('user-1', EMAIL);
  assert.equal(result.sent, true, 'stale history must not lock the user out forever');
});

// ──────────────────────────────── verify ───────────────────────────────────

test('verifyOtp refuses an unknown user, a college-less account, and an already-verified account', async () => {
  const { svc } = setup({ users: [makeUser()] });
  await rejectsWithStatus(() => svc.verifyOtp('ghost', '123456'), 404);
  await rejectsWithStatus(() => svc.verifyOtp('user-1', '123456'), 400, undefined);

  const verified = setup({ users: [makeUser({ collegeEmailVerified: true, verificationStatus: 'VERIFIED' })] });
  await rejectsWithStatus(() => verified.svc.verifyOtp('user-1', '123456'), 400);
});

test('verifyOtp rejects a wrong-length or non-numeric code without consuming an attempt', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.sendOtp('user-1', EMAIL);
  await rejectsWithStatus(() => svc.verifyOtp('user-1', '12345'), 400);
  await rejectsWithStatus(() => svc.verifyOtp('user-1', 'abcdef'), 400);
  assert.equal(db.rows('emailOtp')[0].attempts, 0);
});

test('verifyOtp rejects a wrong code, counts the attempt, and keeps the user unverified', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.sendOtp('user-1', EMAIL);
  const code = liveCode(db);
  const wrong = code === '000000' ? '111111' : '000000';

  const err = await rejectsWithStatus(() => svc.verifyOtp('user-1', wrong), 400);
  assert.equal(err.message, 'Invalid OTP');
  assert.equal(db.rows('emailOtp')[0].attempts, 1);
  assert.equal(db.rows('user')[0].collegeEmailVerified, false);
});

test('verifyOtp locks a code out after 5 failed attempts', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.sendOtp('user-1', EMAIL);
  const code = liveCode(db);
  const wrong = code === '000000' ? '111111' : '000000';

  for (let i = 0; i < 5; i++) {
    await rejectsWithStatus(() => svc.verifyOtp('user-1', wrong), 400);
  }
  // Sixth try is refused even though the code would now be correct.
  const err = await rejectsWithStatus(() => svc.verifyOtp('user-1', code), 400);
  assert.match(err.message, /Too many failed attempts/);
  assert.notEqual(db.rows('emailOtp')[0].usedAt, null, 'the burned code is retired');
  assert.equal(db.rows('user')[0].collegeEmailVerified, false);
});

test('verifyOtp refuses when no code was requested, and when the code has expired', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await rejectsWithStatus(() => svc.verifyOtp('user-1', '123456'), 400);

  await svc.sendOtp('user-1', EMAIL);
  const code = liveCode(db);
  db.rows('emailOtp')[0].expiresAt = new Date(Date.now() - 1000);
  await rejectsWithStatus(() => svc.verifyOtp('user-1', code), 400);
});

test('SECURITY: a code issued for one account cannot verify another', async () => {
  const { db, svc } = setup({
    users: [
      makeUser({ id: 'victim', email: 'victim@ipec.org.in', username: 'victim' }),
      makeUser({ id: 'attacker', email: 'attacker@ipec.org.in', username: 'attacker' }),
    ],
  });
  await svc.sendOtp('victim', EMAIL);
  const victimCode = liveCode(db);

  // Same college email, different user → its own OTP row is required.
  await rejectsWithStatus(() => svc.verifyOtp('attacker', victimCode), 400);
  assert.equal(db.rows('user').find((u) => u.id === 'attacker')!.collegeEmailVerified, false);
  assert.equal(db.rows('user').find((u) => u.id === 'victim')!.collegeEmailVerified, false);
});

test('verifyOtp succeeds: the account becomes VERIFIED and the email locks', async () => {
  const { db, svc } = setup({ users: [makeUser({ collegeEmail: EMAIL })] });
  await svc.sendOtp('user-1', EMAIL);
  const code = liveCode(db);

  const result = await svc.verifyOtp('user-1', code);
  assert.deepEqual(result, { verified: true, collegeEmail: EMAIL });

  const user = db.rows('user')[0];
  assert.equal(user.collegeEmailVerified, true);
  assert.equal(user.verificationStatus, 'VERIFIED');
  assert.equal(user.isVerified, true);
  assert.equal(user.collegeEmail, EMAIL);
  assert.ok(user.collegeEmailVerifiedAt instanceof Date);
  assert.notEqual(db.rows('emailOtp')[0].usedAt, null, 'a used code is burned');

  // Replay is impossible.
  await rejectsWithStatus(() => svc.verifyOtp('user-1', code), 400);
});

test('SECURITY: a code is single-use — the second redemption is refused', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.sendOtp('user-1', EMAIL);
  const code = liveCode(db);
  await svc.verifyOtp('user-1', code);

  db.rows('user')[0].collegeEmailVerified = false;
  db.rows('user')[0].verificationStatus = 'UNVERIFIED';
  await rejectsWithStatus(() => svc.verifyOtp('user-1', code), 400);
});

// ────────────────────────────── status / resend ────────────────────────────

test('getStatus reports the college, its domain, and the pending address', async () => {
  const { svc } = setup({ users: [makeUser({ collegeEmail: EMAIL })] });
  const status = await svc.getStatus('user-1');
  assert.equal(status.collegeId, COLLEGE_ID);
  assert.equal(status.collegeName, 'Ideal Institute of Technology');
  assert.equal(status.collegeEmailDomain, 'ipec.org.in');
  assert.equal(status.collegeEmail, EMAIL);
  assert.equal(status.collegeEmailVerified, false);
  await rejectsWithStatus(() => svc.getStatus('ghost'), 404);
});

test('resendOtp needs a pending verification and re-sends to the remembered address', async () => {
  const { db, svc } = setup({ users: [makeUser()] });

  await rejectsWithStatus(() => svc.resendOtp('user-1'), 400);

  await svc.sendOtp('user-1', EMAIL);
  const first = liveCode(db);
  await svc.resendOtp('user-1');
  assert.equal(liveCode(db) !== first || db.rows('emailOtp').length === 2, true);

  db.rows('user')[0].collegeEmailVerified = true;
  await rejectsWithStatus(() => svc.resendOtp('user-1'), 400);
});

test('a verified account can no longer be re-pointed by the OTP flow', async () => {
  const { db, svc } = setup({ users: [makeUser({ collegeEmailVerified: true, verificationStatus: 'VERIFIED' })] });
  await rejectsWithStatus(() => svc.sendOtp('user-1', 'other@ipec.org.in'), 400);
  assert.equal(db.rows('user')[0].collegeEmailVerified, true);
});
