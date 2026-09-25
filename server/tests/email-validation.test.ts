import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEmail } from '../src/utils/email-validation';

test('checkEmail accepts a normal address', () => {
  assert.deepEqual(checkEmail('student@ipec.org.in'), { ok: true });
  assert.deepEqual(checkEmail('  Student@IPEC.org.in  '), { ok: true });
});

test('checkEmail rejects malformed syntax', () => {
  assert.equal(checkEmail('').ok, false);
  assert.equal(checkEmail('nope').ok, false);
  assert.equal(checkEmail('@domain.com').ok, false);
  assert.equal(checkEmail('user@').ok, false);
  assert.equal(checkEmail('user@domain').ok, false, 'no TLD');
  assert.equal(checkEmail('user@@domain.com').ok, false);
  assert.equal(checkEmail('user name@domain.com').ok, false, 'space in local part');
  assert.equal(checkEmail('user@dom_ain.com').ok, false, 'underscore is not valid in a hostname');
});

test('checkEmail rejects an over-long local part (RFC 64-char cap)', () => {
  const long = `${'a'.repeat(65)}@domain.com`;
  assert.equal(checkEmail(long).ok, false);
});

test('checkEmail blocks disposable inboxes, including subdomains', () => {
  assert.equal(checkEmail('x@mailinator.com').ok, false);
  assert.equal(checkEmail('x@yopmail.com').ok, false);
  assert.equal(checkEmail('x@temp-mail.org').ok, false);
  assert.equal(checkEmail('x@mail.temp-mail.org').ok, false, 'subdomain of a disposable root');
  assert.equal(checkEmail('x@guerrillamail.com').ok, false);
});

test('checkEmail suggests a fix for common typos', () => {
  const typo = checkEmail('student@gmial.com');
  assert.equal(typo.ok, true);
  assert.equal(typo.suggestion, 'student@gmail.com');

  const shortTypo = checkEmail('student@yaho.com');
  assert.equal(shortTypo.suggestion, 'student@yahoo.com');
});

test('checkEmail does not "correct" a legitimate unknown domain', () => {
  const college = checkEmail('student@ipec.org.in');
  assert.equal(college.ok, true);
  assert.equal(college.suggestion, undefined);

  // Far from every known domain — must not be mangled into gmail.com
  const other = checkEmail('student@college-university.edu.in');
  assert.equal(other.ok, true);
  assert.equal(other.suggestion, undefined);
});
