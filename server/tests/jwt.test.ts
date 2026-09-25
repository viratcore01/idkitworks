import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  parseDuration,
} from '../src/utils/jwt';

const payload = { userId: 'user-1', email: 'a@ipec.org.in', username: 'a', role: 'user' };

test('parseDuration understands every supported unit', () => {
  assert.equal(parseDuration('30s'), 30_000);
  assert.equal(parseDuration('15m'), 900_000);
  assert.equal(parseDuration('60m'), 3_600_000);
  assert.equal(parseDuration('12h'), 43_200_000);
  assert.equal(parseDuration('7d'), 604_800_000);
});

test('parseDuration falls back safely on garbage input', () => {
  assert.equal(parseDuration('forever'), 900_000);
  assert.equal(parseDuration('10'), 900_000);
  assert.equal(parseDuration(''), 900_000);
});

test('access tokens round-trip and carry a unique jti', () => {
  const t1 = generateAccessToken(payload);
  const t2 = generateAccessToken(payload);
  // Regression guard: without jti, two logins in the same second produced
  // byte-identical tokens and collided on the RefreshToken unique index.
  assert.notEqual(t1, t2, 'two tokens minted back-to-back must differ');
  const decoded: any = verifyAccessToken(t1);
  assert.equal(decoded.userId, 'user-1');
  assert.equal(decoded.role, 'user');
  assert.ok(decoded.jti && decoded.jti.length > 10);
  assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
});

test('SECURITY: an access token is not accepted where a refresh token is required (and vice versa)', () => {
  const access = generateAccessToken(payload);
  const refresh = generateRefreshToken(payload);
  assert.throws(() => verifyRefreshToken(access), /invalid signature/);
  assert.throws(() => verifyAccessToken(refresh), /invalid signature/);
});

test('SECURITY: tampered and unsigned tokens are rejected', () => {
  const token = generateAccessToken(payload);
  const [header, body, sig] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ ...payload, userId: 'attacker', role: 'super_admin' })).toString('base64url');
  assert.throws(() => verifyAccessToken(`${header}.${forgedBody}.${sig}`), /invalid signature/);
  assert.throws(() => verifyAccessToken('not.a.token'));
  assert.throws(() => verifyAccessToken(''));
  // alg=none attack
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.throws(() => verifyAccessToken(`${noneHeader}.${forgedBody}.`));
});
