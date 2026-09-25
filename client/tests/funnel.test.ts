import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from '../src/utils/funnel';
import type { User } from '../src/types';

/**
 * The funnel router is the single decision point for "where does this person
 * go next" across signup, Google, login, OTP and profile save. Every branch is
 * asserted here because a wrong answer strands a user mid-onboarding.
 */

const COLLEGE = { id: 'c1', name: 'College One', shortName: null, city: null, state: null, logoUrl: null };

const base: User = {
  id: 'u1',
  email: 'student@ipec.org.in',
  username: 'student',
  displayName: 'Student',
  avatarUrl: null,
  bio: null,
  course: null,
  year: null,
  college: null,
  isVerified: false,
  verificationStatus: 'UNVERIFIED',
  interests: [],
};

/** The funnel answer for `base` with a few fields overridden. */
const step = (over: Partial<User>): string => nextStep({ ...base, ...over });

/** A user who has cleared every other gate. */
const onboarded: Partial<User> = {
  collegeId: 'c1',
  college: COLLEGE,
  verificationStatus: 'VERIFIED',
  hasPassword: true,
  isProfileSetup: true,
};

test('signed out goes to login', () => {
  assert.equal(nextStep(null), '/login');
  assert.equal(nextStep(undefined), '/login');
});

test('no college yet goes to profile setup (legacy Google accounts)', () => {
  assert.equal(step({ collegeId: null, college: null }), '/setup-profile');
  assert.equal(step({ collegeId: undefined, college: null }), '/setup-profile');
});

test('unverified goes to the OTP flow', () => {
  assert.equal(step({ collegeId: 'c1', college: COLLEGE, collegeEmailVerified: false }), '/verify');
});

test('verified via the OTP flag moves on even while verificationStatus lags', () => {
  // verificationStatus is refreshed a beat later; the OTP flag is the truth.
  assert.equal(step({ ...onboarded, verificationStatus: 'UNVERIFIED', collegeEmailVerified: true }), '/home');
});

test('verified but passwordless sets the first password', () => {
  assert.equal(step({ ...onboarded, hasPassword: false }), '/setup-password');
});

test('verification comes before the password step', () => {
  assert.equal(
    step({ ...onboarded, verificationStatus: 'UNVERIFIED', hasPassword: false, isProfileSetup: false }),
    '/verify',
  );
});

test('the password step comes before profile details', () => {
  assert.equal(step({ ...onboarded, hasPassword: false, isProfileSetup: false }), '/setup-password');
});

test('verified with a password but no profile goes to profile setup', () => {
  assert.equal(step({ ...onboarded, isProfileSetup: false }), '/setup-profile');
});

test('fully onboarded goes to the feed', () => {
  assert.equal(step(onboarded), '/home');
});

test('an absent hasPassword flag does not bounce the user (Google-only accounts)', () => {
  assert.equal(step({ ...onboarded, hasPassword: undefined }), '/home');
});

test('an absent isProfileSetup flag errs toward showing the setup screen', () => {
  assert.equal(step({ ...onboarded, isProfileSetup: undefined }), '/setup-profile');
});

test('no route is ever returned without a leading slash', () => {
  const variants: Partial<User>[] = [
    {},
    { collegeId: 'c1', college: COLLEGE },
    onboarded,
    { ...onboarded, hasPassword: false },
  ];
  for (const variant of variants) {
    assert.match(step(variant), /^\/[a-z-]+$/);
  }
});
