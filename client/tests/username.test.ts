import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeUsernameInput,
  localUsernameStatus,
  localUsernameError,
  isReservedUsername,
  usernameFeedback,
  blocksSubmit,
} from '../src/utils/username';

/**
 * The handle field is checked locally (shape + reserved words, instant) and by
 * the server (is it claimed?). These are the local halves — the ones that must
 * agree with server/src/utils/username.ts.
 */

// ───────────────────────────── as-you-type filter ───────────────────────────

test('sanitizeUsernameInput lowercases, strips what cannot be in a handle, and caps the length', () => {
  assert.equal(sanitizeUsernameInput('StuDent'), 'student');
  assert.equal(sanitizeUsernameInput('my handle!!'), 'myhandle');
  assert.equal(sanitizeUsernameInput('a-b.c'), 'abc');
  assert.equal(sanitizeUsernameInput('under_score'), 'under_score');
  assert.equal(sanitizeUsernameInput('x'.repeat(40)), 'x'.repeat(20));
});

// ──────────────────────────────── local verdict ─────────────────────────────

test('localUsernameStatus: empty, invalid, reserved and ok', () => {
  assert.equal(localUsernameStatus(''), 'empty');
  assert.equal(localUsernameStatus('   '), 'empty');
  assert.equal(localUsernameStatus('ab'), 'invalid');
  assert.equal(localUsernameStatus('a'.repeat(21)), 'invalid');
  assert.equal(localUsernameStatus('admin'), 'reserved');
  assert.equal(localUsernameStatus('Admin'), 'reserved');
  assert.equal(localUsernameStatus('student'), 'ok');
  assert.equal(localUsernameStatus('viratcore01'), 'ok');
});

test('a reserved word cannot be smuggled through with a digit or underscore suffix', () => {
  // Handles are immutable, so "admin1" is the same impersonation as "admin".
  for (const probe of ['admin1', 'admin_007', 'support2', 'moderator99', 'official_']) {
    assert.equal(isReservedUsername(probe), true, `${probe} must read as reserved`);
    assert.equal(localUsernameStatus(probe), 'reserved');
  }
  assert.equal(isReservedUsername('student1'), false);
});

test('localUsernameError explains the rule, and is null for an acceptable handle', () => {
  assert.equal(localUsernameError('student'), null);
  assert.equal(localUsernameError(''), null, 'an untouched field is not an error yet');
  assert.match(String(localUsernameError('ab')), /3-20/);
  assert.match(String(localUsernameError('admin')), /reserved/i);
});

// ──────────────────────────────── UI feedback ───────────────────────────────

test('usernameFeedback maps every status to one line, with the right tone', () => {
  assert.equal(usernameFeedback('idle', ''), null, 'nothing typed, nothing said');
  assert.equal(usernameFeedback('empty', ''), null);

  assert.equal(usernameFeedback('checking', 'student')?.tone, 'wait');
  assert.equal(usernameFeedback('available', 'student')?.tone, 'ok');
  assert.equal(usernameFeedback('taken', 'student')?.tone, 'bad');
  assert.match(String(usernameFeedback('taken', 'student')?.text), /taken/i);
  assert.equal(usernameFeedback('reserved', 'admin')?.tone, 'bad');
  assert.equal(usernameFeedback('invalid', 'ab')?.tone, 'bad');
});

test('a FAILED check never reads as "taken" — the submit is still allowed', () => {
  // Offline or throttled must not tell the user their handle is taken, which is
  // the one message that would make them change a perfectly good one.
  const offline = usernameFeedback('unavailable', 'student');
  assert.equal(offline?.tone, 'wait');
  assert.doesNotMatch(String(offline?.text), /taken/i);
  assert.equal(blocksSubmit('unavailable'), false);
});

test('blocksSubmit stops only the verdicts the user has to act on', () => {
  assert.equal(blocksSubmit('invalid'), true);
  assert.equal(blocksSubmit('reserved'), true);
  assert.equal(blocksSubmit('taken'), true);
  // The server re-checks on save, so a pending or unknown state must not trap
  // the user on a screen: they can always continue and get the real verdict.
  assert.equal(blocksSubmit('checking'), false);
  assert.equal(blocksSubmit('idle'), false);
  assert.equal(blocksSubmit('empty'), false);
  assert.equal(blocksSubmit('available'), false);
});
