import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { AuthService } from '../src/services/auth.service';
import { comparePassword } from '../src/utils/password';
import { FakeDb, install, makeUser, makeCollege } from './helpers/fake-db';

/**
 * The setup-password trap: the funnel (nextStep, funnelDone, the page gate,
 * PasswordRoute) calls an account verified when verificationStatus is
 * VERIFIED **OR** collegeEmailVerified is true — but setInitialPassword used
 * to demand the flag alone. A row that is VERIFIED without the flag
 * (founder-side/admin-created accounts, legacy rows) rendered "Email
 * verified", got force-routed back on any navigation, 403'd every submit,
 * and had no exit. The server now mirrors the funnel's OR exactly.
 */

const svc = new AuthService();
// Placeholder park-job: sorts as "no password" (does not start with $2).
const PLACEHOLDER = '11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222';

function setup(users: any[]) {
  const db = new FakeDb({ colleges: [makeCollege()], users });
  install(db, prisma);
  return db;
}

const base = { passwordHash: PLACEHOLDER, email: 'her@college.edu' };

test('TRAP STATE: VERIFIED status without the OTP flag can set the first password', async () => {
  const db = setup([
    makeUser({ id: 'her-1', ...base, verificationStatus: 'VERIFIED', collegeEmailVerified: false }),
  ]);
  await svc.setInitialPassword('her-1', 'brand-new-password');
  const row = await db.delegate('user').findUnique({ where: { id: 'her-1' } });
  assert.match(row.passwordHash, /^\$2[aby]\$/, 'a real bcrypt hash replaced the placeholder');
  assert.equal(await comparePassword('brand-new-password', row.passwordHash), true);
});

test('flag-true accounts keep working exactly as before', async () => {
  const db = setup([
    makeUser({ id: 'flag-1', ...base, email: 'flag@college.edu', verificationStatus: 'UNVERIFIED', collegeEmailVerified: true }),
  ]);
  await svc.setInitialPassword('flag-1', 'another-password');
  const row = await db.delegate('user').findUnique({ where: { id: 'flag-1' } });
  assert.equal(await comparePassword('another-password', row.passwordHash), true);
});

test('a stolen pre-verification session (neither flag) is still refused', async () => {
  setup([makeUser({ id: 'draft-1', ...base, email: 'draft@college.edu' })]);
  await assert.rejects(() => svc.setInitialPassword('draft-1', 'some-password'), (e: any) => {
    assert.equal(e.status, 403);
    assert.equal(e.code, 'VERIFICATION_REQUIRED');
    return true;
  });
});

test('an existing password is never overwritten here; short passwords rejected; unknown users 401', async () => {
  const db = setup([
    makeUser({ id: 'haspw-1', ...base, email: 'haspw@college.edu', verificationStatus: 'VERIFIED' }),
  ]);
  // Give haspw-1 a REAL password first.
  await db.delegate('user').update({
    where: { id: 'haspw-1' },
    data: { passwordHash: '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7tAUFnOnV0Co7f3OSJ8X6VzX2rZC0Ny' },
  });
  await assert.rejects(() => svc.setInitialPassword('haspw-1', 'overwrite-attempt'), (e: any) => {
    assert.equal(e.status, 400);
    return true;
  });
  await assert.rejects(() => svc.setInitialPassword('haspw-1', 'short'), /8-128/);
  await assert.rejects(() => svc.setInitialPassword('nobody', 'some-password'), (e: any) => {
    assert.equal(e.status, 401);
    return true;
  });
});
