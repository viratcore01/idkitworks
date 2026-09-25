import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { AuthService } from '../src/services/auth.service';
import {
  checkUsernameLocally,
  isReservedUsername,
  normalizeUsername,
  usernameShapeError,
  USERNAME_PATTERN,
  RESERVED_USERNAMES,
} from '../src/utils/username';
import { FakeDb, install, makeUser, makeCollege, rejectsWithStatus, FakeDbOptions } from './helpers/fake-db';

const COLLEGE_ID = 'college-1';
const DOMAIN_EMAIL = 'student@ipec.org.in';

function setup(seed: FakeDbOptions = {}) {
  const db = new FakeDb({ colleges: [makeCollege()], ...seed });
  install(db, prisma);
  return { db, svc: new AuthService() };
}

// ───────────────────────────── shape rules ──────────────────────────────────

test('shape: 3-20 characters of lowercase letters, digits and underscore', () => {
  for (const ok of ['abc', 'student_1', 'a'.repeat(20), 'x9_']) {
    assert.equal(usernameShapeError(ok), null, `expected ${ok} to be allowed`);
    assert.equal(checkUsernameLocally(ok).available, true);
  }
  for (const bad of ['', 'ab', 'a'.repeat(21), 'has space', 'dash-ed', 'Dot.ted', '@handle']) {
    assert.notEqual(usernameShapeError(bad), null, `expected ${bad} to be refused`);
    assert.equal(checkUsernameLocally(bad).available, false);
  }
});

test('shape: normalization is lowercase + trim, and that is what is compared', () => {
  assert.equal(normalizeUsername('  StuDent  '), 'student');
  assert.equal(usernameShapeError(' StuDent '), null, 'casing and padding are normalized, not rejected');
  assert.equal(checkUsernameLocally(' StuDent ').username, 'student');
  assert.equal(USERNAME_PATTERN.test('Student'), false, 'the raw pattern stays strict lower-case');
});

// ─────────────────────── the impersonation list ─────────────────────────────

test('reserved: brand/staff/infrastructure words are unclaimable, in any casing or padding', () => {
  for (const word of ['admin', 'ADMIN', ' Admin ', 'support', 'skola', 'zoclo', 'official', 'moderator', 'api']) {
    assert.equal(isReservedUsername(word), true, `${word} must be reserved`);
    const check = checkUsernameLocally(word);
    assert.equal(check.available, false);
    assert.equal(check.reason, 'reserved');
    assert.match(check.error!, /reserved/i);
  }
});

test('reserved: a digit suffix does not smuggle a reserved word through', () => {
  // "admin1" reads as "admin" to a human, and handles are immutable — so the
  // guard ignores trailing digits.
  for (const word of ['admin1', 'admin_007', 'support2', 'moderator99']) {
    assert.equal(isReservedUsername(word), true, `${word} must be reserved`);
  }
  // …but ordinary digit suffixes on ordinary words are fine.
  assert.equal(isReservedUsername('student1'), false);
  assert.equal(isReservedUsername('viratcore01'), false);
});

test('reserved: the list is not empty and contains no unusable entries', () => {
  assert.ok(RESERVED_USERNAMES.size >= 10);
  for (const word of RESERVED_USERNAMES) {
    assert.equal(USERNAME_PATTERN.test(word), true, `${word} should itself be a legal-shaped handle`);
  }
});

// ─────────── profile setup closes the impersonation hole ───────────────────
// The handle is chosen ONCE in Complete Your Profile (never at signup): the
// same shape + reserved + uniqueness gates as the old wizard, enforced here.

test('SECURITY: profile setup refuses a reserved handle', async () => {
  const { db, svc } = setup({ users: [makeUser({ id: 'u1', usernameChosen: false })] });
  for (const username of ['admin', 'Admin', 'support', 'skola', 'moderator1']) {
    const err = await rejectsWithStatus(() => svc.updateProfile('u1', { username }), 400, 'USERNAME_RESERVED');
    assert.match(err.message, /reserved/i);
  }
  assert.equal(db.rows('user')[0].usernameChosen, false, 'nothing is finalized for a reserved handle');
});

test('profile setup accepts an ordinary handle exactly once, then locks it for life', async () => {
  const { db, svc } = setup({ users: [makeUser({ id: 'u1', usernameChosen: false })] });
  const result = await svc.updateProfile('u1', { username: 'Student_1' });
  assert.equal(result.username, 'student_1', 'the choice is stored normalized');
  assert.equal(result.usernameChosen, true);
  assert.equal(db.rows('user')[0].usernameChosen, true);

  // A second, different handle is refused…
  await rejectsWithStatus(() => svc.updateProfile('u1', { username: 'somethingelse' }), 403);
  // …while resubmitting the chosen one is a harmless no-op (stale forms).
  await svc.updateProfile('u1', { username: 'student_1' });
  assert.equal(db.rows('user')[0].username, 'student_1');
});

test('profile setup refuses a taken handle, case-insensitively, and creates no row', async () => {
  const { db, svc } = setup({
    users: [makeUser({ id: 'u1', usernameChosen: false }), makeUser({ id: 'u2', username: 'Taken' })],
  });
  await rejectsWithStatus(() => svc.updateProfile('u1', { username: 'TAKEN' }), 409);
  assert.equal(db.rows('user').length, 2, 'a taken handle duplicates nothing');
});

// ─────────────────── live availability (profile setup's check) ─────────────

test('availability: a free handle is available and reserves nothing', async () => {
  const { db, svc } = setup();
  const check = await svc.isUsernameAvailable('brandnew');
  assert.deepEqual(check, { username: 'brandnew', available: true });
  assert.equal(db.rows('user').length, 0, 'checking must never create or reserve a row');
});

test('availability: a claimed handle is taken, case-insensitively', async () => {
  const { svc } = setup({ users: [makeUser({ username: 'Taken' })] });
  for (const probe of ['taken', 'TAKEN', ' Taken ']) {
    const check = await svc.isUsernameAvailable(probe);
    assert.equal(check.available, false, `${probe} must read as taken`);
    assert.equal(check.reason, 'taken');
    assert.match(check.error!, /taken/i);
  }
});

test('availability: shape and reserved words are answered without a database hit', async () => {
  const { svc } = setup();
  // A delegate that would throw if touched: these answers must be local.
  (prisma as any).user.findFirst = async () => {
    throw new Error('the database must not be queried for a locally-decidable handle');
  };
  assert.equal((await svc.isUsernameAvailable('ab')).reason, 'invalid');
  assert.equal((await svc.isUsernameAvailable('admin')).reason, 'reserved');
  assert.equal((await svc.isUsernameAvailable('')).reason, 'invalid');
  assert.equal((await svc.isUsernameAvailable(undefined as any)).reason, 'invalid');
});

test('availability: a handle being checked does not break signup for someone else', async () => {
  // Advisory by contract: the check says free, the INSERT still owns the truth.
  const { svc } = setup({ users: [makeUser({ username: 'student' })] });
  assert.equal((await svc.isUsernameAvailable('student')).available, false);
  assert.equal((await svc.isUsernameAvailable('student2')).available, true);
});
