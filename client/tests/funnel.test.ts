import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, hasCollege, funnelDone } from '../src/utils/funnel';
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

test('hasCollege treats either signal as "already chosen"', () => {
  assert.equal(hasCollege(null), false);
  assert.equal(hasCollege(undefined), false);
  assert.equal(hasCollege(base), false);
  // The two payloads disagree by design (the auth responses carry collegeId,
  // /auth/me also carries the object). Neither may be read as "no college"
  // while the other says otherwise — that is how a locked field turns back into
  // an editable picker mid-signup.
  assert.equal(hasCollege({ ...base, collegeId: 'c1', college: null }), true);
  assert.equal(hasCollege({ ...base, collegeId: null, college: COLLEGE }), true);
  assert.equal(hasCollege({ ...base, collegeId: undefined, college: COLLEGE }), true);
});

test('an account with a college is never routed to the college step again', () => {
  const withCollege = { ...base, collegeId: 'c1', college: COLLEGE };
  assert.equal(hasCollege(withCollege), true);
  assert.notEqual(nextStep(withCollege), '/signup');
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

// ────────────────────── funnelDone (PublicRoute's only question) ──────────────────────

/** The account row the wizard's "Send my code" just created. */
const midFunnel: Partial<User> = {
  collegeId: 'c1',
  college: COLLEGE,
  collegeEmail: 'student@ipec.org.in',
  collegeEmailVerified: false,
  verificationStatus: 'UNVERIFIED',
  hasPassword: false,
  hasGoogle: false,
  isProfileSetup: false,
};

test('a wizard-minted account (just created, unverified, passwordless) is NOT done', () => {
  // PublicRoute must let it STAY on /signup — evicting it bounces
  // /home → CollegeRoute → /verify, which re-asks for the email.
  assert.equal(funnelDone({ ...base, ...midFunnel }), false);
});

test('a verified but passwordless account is still mid-funnel', () => {
  assert.equal(
    funnelDone({ ...base, ...midFunnel, collegeEmailVerified: true, verificationStatus: 'VERIFIED' }),
    false,
  );
});

test('no way back in (no password, no Google) means never "done"', () => {
  // The one account shape that must never be left alone on a public page.
  assert.equal(funnelDone({ ...base, ...onboarded, hasPassword: false, hasGoogle: false }), false);
});

test('a fully onboarded account is done and gets bounced off auth pages', () => {
  assert.equal(funnelDone({ ...base, ...onboarded, hasGoogle: false }), true);
  assert.equal(funnelDone({ ...base, ...onboarded, hasPassword: false, hasGoogle: true }), true);
});

test('profile details unfinished means not done, even with a password', () => {
  assert.equal(funnelDone({ ...base, ...onboarded, isProfileSetup: false }), false);
});

test('signed out is trivially not done', () => {
  assert.equal(funnelDone(null), false);
  assert.equal(funnelDone(undefined), false);
});
