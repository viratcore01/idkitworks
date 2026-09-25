import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, comparePassword, isPasswordSet } from '../src/utils/password';

test('hashPassword produces a real bcrypt hash that verifies', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(await comparePassword('correct horse battery', hash), true);
  assert.equal(await comparePassword('wrong password', hash), false);
});

test('hashes are salted — the same password never produces the same hash', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(await comparePassword('same-password', a), true);
  assert.equal(await comparePassword('same-password', b), true);
});

test('isPasswordSet distinguishes real hashes from placeholders', () => {
  assert.equal(isPasswordSet('$2a$12$C6UzMDM.H6dfI/f/IKcEeO7tAUFnOnV0Co7f3OSJ8X6VzX2rZC0Ny'), true);
  assert.equal(isPasswordSet('$2b$10$abcdefghijklmnopqrstuv'), true);
  // Google-created accounts park two UUIDs; deleted rows park DELETED_<id>.
  assert.equal(isPasswordSet('11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222'), false);
  assert.equal(isPasswordSet('DELETED_user-1'), false);
  assert.equal(isPasswordSet(''), false);
  assert.equal(isPasswordSet(null), false);
  assert.equal(isPasswordSet(undefined), false);
});

test('SECURITY: a placeholder hash can never authenticate a password login', async () => {
  const placeholder = '11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222';
  // Login compares whatever the user typed against the stored hash. A
  // passwordless (Google) account must NEVER match, and bcrypt must not throw
  // a 500 while doing it.
  for (const attempt of ['', 'password', placeholder, 'undefined', 'null']) {
    assert.equal(await comparePassword(attempt, placeholder), false, `"${attempt}" must not match a placeholder`);
  }
});

test('SECURITY: the dummy hash used to equalize login timing is a valid bcrypt hash', async () => {
  // login() runs one bcrypt compare against this constant for unknown users.
  // If it were malformed, bcrypt would return early and re-open the timing
  // oracle that reveals which emails exist.
  const DUMMY = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7tAUFnOnV0Co7f3OSJ8X6VzX2rZC0Ny';
  assert.equal(DUMMY.length, 60);
  assert.equal(await comparePassword('anything', DUMMY), false);
});
