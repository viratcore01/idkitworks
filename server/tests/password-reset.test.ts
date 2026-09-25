import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { AuthService } from '../src/services/auth.service';
import { FakeDb, install, makeUser, makeCollege, rejectsWithStatus, FakeDbOptions } from './helpers/fake-db';
import { isPasswordSet, hashPassword } from '../src/utils/password';

const COLLEGE_ID = 'college-1';
const EMAIL = 'student@ipec.org.in';
const PLACEHOLDER = '11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222';

function setup(seed: FakeDbOptions = {}) {
  const db = new FakeDb({ colleges: [makeCollege()], ...seed });
  install(db, prisma);
  return { db, svc: new AuthService() };
}

function liveResetCode(db: FakeDb): string {
  const live = db
    .rows('emailOtp')
    .filter((o) => o.purpose === 'PASSWORD_RESET' && !o.usedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  assert.ok(live.length, 'expected a live reset code');
  return live[0].code;
}

// ────────────────────────────── request ────────────────────────────────────

test('an unknown identifier gets the same success response and no email', async () => {
  const { db, svc } = setup();
  const result = await svc.requestPasswordReset('nobody@ipec.org.in');
  assert.deepEqual(result, { sent: true, expiresIn: 600 });
  assert.equal(db.rows('emailOtp').length, 0);
});

test('malformed input is answered generically, never with an error', async () => {
  const { svc } = setup();
  for (const bad of ['', '   ', undefined as any, 123 as any, null as any]) {
    const result = await svc.requestPasswordReset(bad);
    assert.equal(result.sent, true);
  }
});

test('IDENTICAL RESPONSE: an existing account is indistinguishable from an unknown one', async () => {
  const { svc } = setup({ users: [makeUser()] });
  const known = await svc.requestPasswordReset(EMAIL);
  const unknown = await svc.requestPasswordReset('ghost@ipec.org.in');
  assert.deepEqual(known, unknown, 'any difference here is an account-existence oracle');
});

test('a known account receives a 10-minute reset code at its proven address', async () => {
  const { db, svc } = setup({ users: [makeUser({ collegeEmail: EMAIL })] });
  await svc.requestPasswordReset(EMAIL);

  const otp = db.rows('emailOtp')[0];
  assert.equal(otp.purpose, 'PASSWORD_RESET');
  assert.match(otp.code, /^\d{6}$/);
  assert.equal(otp.email, EMAIL);
  assert.equal(otp.usedAt, null);
  const ttl = (otp.expiresAt.getTime() - otp.createdAt.getTime()) / 60_000;
  assert.ok(Math.abs(ttl - 10) < 0.1, `expected a 10 minute TTL, got ${ttl}`);
});

test('usernames work as identifiers too', async () => {
  const { db, svc } = setup({ users: [makeUser({ username: 'student' })] });
  await svc.requestPasswordReset('StUdEnT');
  assert.equal(db.rows('emailOtp').length, 1);
});

test('the code goes to the account login email that was typed — never somewhere else', async () => {
  // A Google-created row keeps its Google address as the login identity; the
  // reset code must land there, not at its (separately verified) college inbox.
  const { db, svc } = setup({
    users: [makeUser({ email: 'personal@gmail.com', collegeEmail: EMAIL, collegeEmailVerified: true })],
  });
  await svc.requestPasswordReset('personal@gmail.com');
  assert.equal(db.rows('emailOtp')[0].email, 'personal@gmail.com');

  // The college address is only a login identity when it IS the row's email.
  const funnel = setup({ users: [makeUser({ email: EMAIL, collegeEmail: EMAIL, collegeEmailVerified: true })] });
  await funnel.svc.requestPasswordReset(EMAIL);
  assert.equal(funnel.db.rows('emailOtp')[0].email, EMAIL);
});

test('SECURITY: a Google-only account gets no reset code (no second door into it)', async () => {
  const { db, svc } = setup({ users: [makeUser({ passwordHash: PLACEHOLDER, googleId: 'g-1' })] });
  const result = await svc.requestPasswordReset(EMAIL);
  assert.equal(result.sent, true, 'still indistinguishable');
  assert.equal(db.rows('emailOtp').length, 0, 'but nothing was sent');
});

test('a deactivated account gets no reset code', async () => {
  const { db, svc } = setup({ users: [makeUser({ isActive: false })] });
  await svc.requestPasswordReset(EMAIL);
  assert.equal(db.rows('emailOtp').length, 0);
});

test('send throttling is silent: a fourth request within the window mails nothing', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  for (let i = 0; i < 3; i++) await svc.requestPasswordReset(EMAIL);
  assert.equal(db.rows('emailOtp').length, 3);

  const fourth = await svc.requestPasswordReset(EMAIL);
  assert.equal(fourth.sent, true, 'a 429 here would reveal that the account exists');
  assert.equal(db.rows('emailOtp').length, 3, 'but no fourth mail goes out');
});

test('each new reset code retires the previous one', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.requestPasswordReset(EMAIL);
  await svc.requestPasswordReset(EMAIL);
  assert.equal(db.rows('emailOtp').filter((o) => !o.usedAt).length, 1, 'only the newest code is redeemable');
});

// ─────────────────────────────── reset ─────────────────────────────────────

test('a wrong code is refused generically and counts the attempt', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);
  const wrong = code === '000000' ? '111111' : '000000';

  const err = await rejectsWithStatus(() => svc.resetPassword(EMAIL, wrong, 'new-password-1'), 400, 'RESET_CODE_INVALID');
  assert.match(err.message, /invalid or has expired/);
  assert.equal(db.rows('emailOtp')[0].attempts, 1);
  assert.equal(isPasswordSet(db.rows('user')[0].passwordHash), true, 'the old password still stands');
});

test('a malformed code is refused WITHOUT spending an attempt', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.requestPasswordReset(EMAIL);
  for (const bad of ['', '12345', '1234567', 'abcdef', undefined as any, 123456 as any]) {
    await rejectsWithStatus(() => svc.resetPassword(EMAIL, bad, 'new-password-1'), 400);
  }
  assert.equal(db.rows('emailOtp')[0].attempts, 0);
});

test('five wrong guesses burn the code', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    await rejectsWithStatus(() => svc.resetPassword(EMAIL, wrong, 'new-password-1'), 400);
  }
  await rejectsWithStatus(() => svc.resetPassword(EMAIL, code, 'new-password-1'), 400);
  assert.equal(isPasswordSet(db.rows('user')[0].passwordHash), true);
});

test('an expired code is refused', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);
  db.rows('emailOtp')[0].expiresAt = new Date(Date.now() - 1000);
  await rejectsWithStatus(() => svc.resetPassword(EMAIL, code, 'new-password-1'), 400, 'RESET_CODE_INVALID');
});

test('an unknown identifier fails with the identical generic error', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);

  const unknownErr = await rejectsWithStatus(() => svc.resetPassword('ghost@ipec.org.in', code, 'new-password-1'), 400);
  const wrongErr = await rejectsWithStatus(() => svc.resetPassword(EMAIL, '000001', 'new-password-1'), 400);
  assert.equal(unknownErr.message, wrongErr.message, 'the messages must not differ');
});

test('reset enforces the 8-128 password window before anything else', async () => {
  const { db, svc } = setup({ users: [makeUser()] });
  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);
  await rejectsWithStatus(() => svc.resetPassword(EMAIL, code, 'short'), 400);
  await rejectsWithStatus(() => svc.resetPassword(EMAIL, code, 'x'.repeat(129)), 400);
  assert.equal(db.rows('emailOtp')[0].usedAt, null, 'a rejected password does not consume the code');
});

test('SECURITY: a reset code issued for one account cannot reset another', async () => {
  const { db, svc } = setup({
    users: [
      makeUser({ id: 'victim', email: 'victim@ipec.org.in', username: 'victim' }),
      makeUser({ id: 'attacker', email: 'attacker@ipec.org.in', username: 'attacker' }),
    ],
  });
  const attackerHashBefore = db.rows('user').find((u) => u.id === 'attacker')!.passwordHash;
  await svc.requestPasswordReset('victim@ipec.org.in');
  const victimCode = liveResetCode(db);

  await rejectsWithStatus(() => svc.resetPassword('attacker@ipec.org.in', victimCode, 'new-password-1'), 400);
  assert.equal(
    db.rows('user').find((u) => u.id === 'attacker')!.passwordHash,
    attackerHashBefore,
    "the other account's password is untouched",
  );
  assert.equal(db.rows('emailOtp')[0].usedAt, null, "the victim's code is not burned by someone else's attempt");
});

test('a successful reset swaps the password and kills every session', async () => {
  const oldHash = await hashPassword('forgotten-password');
  const { db, svc } = setup({ users: [makeUser({ passwordHash: oldHash, collegeEmail: EMAIL })] });
  // Two devices signed in before the reset.
  await svc.login(EMAIL, 'forgotten-password');
  await svc.login(EMAIL, 'forgotten-password');
  assert.equal(db.rows('refreshToken').length, 2);

  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);
  await svc.resetPassword(EMAIL, code, 'brand-new-password');

  assert.equal(db.rows('refreshToken').length, 0, 'every device is signed out by a reset');
  assert.notEqual(db.rows('emailOtp')[0].usedAt, null);
  assert.equal(await svc.login(EMAIL, 'brand-new-password').then(() => true, () => false), true);
  assert.equal(await svc.login(EMAIL, 'forgotten-password').then(() => true, () => false), false);
});

test('SECURITY: a redeemed reset code cannot be replayed', async () => {
  const oldHash = await hashPassword('forgotten-password');
  const { db, svc } = setup({ users: [makeUser({ passwordHash: oldHash })] });
  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);
  await svc.resetPassword(EMAIL, code, 'brand-new-password');

  await rejectsWithStatus(() => svc.resetPassword(EMAIL, code, 'another-password'), 400);
  assert.equal(await svc.login(EMAIL, 'brand-new-password').then(() => true, () => false), true);
});

test('END TO END: the full funnel account can be recovered after forgetting its password', async () => {
  const { db, svc } = setup();
  // Sign up through the funnel, verify, set a password.
  const session = await svc.signup({ collegeId: COLLEGE_ID, email: EMAIL, username: 'student', displayName: 'Test Student' });
  const id = session.user.id;
  db.rows('user')[0].collegeEmailVerified = true;
  db.rows('user')[0].verificationStatus = 'VERIFIED';
  await svc.setInitialPassword(id, 'first-real-password');
  assert.equal(await svc.login(EMAIL, 'first-real-password').then(() => true, () => false), true);

  // Forgot it → reset → sign in again.
  await svc.requestPasswordReset(EMAIL);
  const code = liveResetCode(db);
  await svc.resetPassword(EMAIL, code, 'recovered-password');
  const back = await svc.login(EMAIL, 'recovered-password');
  assert.equal(back.user.id, id);
  assert.equal(back.user.hasPassword, true);
});
