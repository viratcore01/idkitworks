import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, hasCollege, funnelDone, isFunnelVerified } from '../src/utils/funnel';
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
  // The OTP step lives INSIDE the signup wizard; the standalone verify page
  // is gone, so the funnel sends unverified users to the wizard.
  assert.equal(step({ collegeId: 'c1', college: COLLEGE, collegeEmailVerified: false }), '/signup');
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
    '/signup',
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

test('a missing hasPassword flag bounces to the password step (fail closed)', () => {
  assert.equal(step({ ...onboarded, hasPassword: undefined }), '/setup-password');
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

test('a fully onboarded account is never routed into the wizard again', () => {
  // The wizard is an onboarding surface: finished accounts must never be sent
  // back into it. (An unverified account WITH a college belongs there — the
  // OTP step lives inside it now.)
  assert.equal(hasCollege({ ...base, collegeId: 'c1', college: COLLEGE }), true);
  assert.notEqual(step(onboarded), '/signup');
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
  // PublicRoute must let it STAY on /signup — evicting it re-asks for the email.
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
  assert.equal(funnelDone({ ...base, ...onboarded, hasGoogle: true }), true);
});

test('a Google-linked account without a password is NOT done (password compulsory)', () => {
  assert.equal(funnelDone({ ...base, ...onboarded, hasPassword: false, hasGoogle: true }), false);
});

// ── The redirect-loop regression: the guards must never disagree ──
// The 2026-09-25 white tab: a Google account with college + profile done but
// OTP never completed. funnelDone (old) said "done" → PublicRoute evicted it
// from /signup to /home; CollegeRoute said "unverified" → bounced it back to
// /signup. Two guards, two answers, forever — Chrome throttled the navigations
// and the tab hung white. THE RULE: funnelDone must return false for EVERY
// account shape that nextStep would send to /signup, or the ping-pong returns.

test('the loop shape: college + profile done but UNVERIFIED is NOT done', () => {
  // This exact shape hung the tab. It must stay mid-funnel (the wizard's OTP).
  assert.equal(
    funnelDone({ ...base, ...onboarded, hasGoogle: true, isProfileSetup: true, verificationStatus: 'UNVERIFIED', collegeEmailVerified: false }),
    false,
  );
});

test('funnelDone and nextStep agree on every account shape (loop impossible)', () => {
  // THE INVARIANT: whenever nextStep says "/signup", funnelDone must say
  // "not done" — otherwise PublicRoute and CollegeRoute fight over the user.
  const shapes: Partial<User>[] = [
    midFunnel,
    { ...onboarded, hasGoogle: true, isProfileSetup: true, verificationStatus: 'UNVERIFIED' },
    { ...onboarded, hasGoogle: true, isProfileSetup: true, collegeEmailVerified: false },
    { ...onboarded, hasGoogle: true, isProfileSetup: true, verificationStatus: 'PENDING' },
    { ...onboarded, verificationStatus: 'UNVERIFIED', hasPassword: true, isProfileSetup: true },
  ];
  for (const shape of shapes) {
    if (nextStep({ ...base, ...shape }) === '/signup') {
      assert.equal(funnelDone({ ...base, ...shape }), false, `loop shape: ${JSON.stringify(shape)}`);
    }
  }
});

test('the OTP flag outranks a lagging verificationStatus (just-verified stays done)', () => {
  // Flag true + status UNVERIFIED = the beat between verify-success and the
  // status refresh; the account is genuinely verified and must count as done.
  assert.equal(
    funnelDone({ ...base, ...onboarded, hasGoogle: true, isProfileSetup: true, verificationStatus: 'UNVERIFIED', collegeEmailVerified: true }),
    true,
  );
});

test('legacy verified accounts (status VERIFIED, flag never set) stay done', () => {
  // Accounts verified before collegeEmailVerified existed have flag=false with
  // status=VERIFIED. The status is the truth there — flag-false must NOT
  // override it, or every legacy user gets bounced into the wizard on login.
  // Same answer both functions give = the mirror holds in this direction too.
  const legacy = { ...base, ...onboarded, hasGoogle: true, isProfileSetup: true, verificationStatus: 'VERIFIED' as const, collegeEmailVerified: false };
  assert.equal(funnelDone(legacy), true);
  assert.equal(nextStep(legacy), '/home');
});

test('profile details unfinished means not done, even with a password', () => {
  assert.equal(funnelDone({ ...base, ...onboarded, isProfileSetup: false }), false);
});

test('signed out is trivially not done', () => {
  assert.equal(funnelDone(null), false);
  assert.equal(funnelDone(undefined), false);
});

test('isFunnelVerified: the single definition every guard, page and the server mirror', () => {
  assert.equal(isFunnelVerified(null), false);
  assert.equal(isFunnelVerified(undefined), false);
  assert.equal(isFunnelVerified(base), false);
  assert.equal(isFunnelVerified({ ...base, collegeEmailVerified: true }), true);
  assert.equal(isFunnelVerified({ ...base, verificationStatus: 'VERIFIED' }), true);
  // Legacy split-brain (founder/admin-created): VERIFIED without the flag.
  assert.equal(isFunnelVerified({ ...base, verificationStatus: 'VERIFIED', collegeEmailVerified: false }), true);
  // Fail-closed on missing data: absent flags never read as verified.
  assert.equal(isFunnelVerified({ ...base, verificationStatus: undefined, collegeEmailVerified: undefined }), false);
});

test('legacy split-brain routes to the password step, never the wizard (server agreement)', () => {
  // status VERIFIED + flag false, passwordless: the server's setInitialPassword
  // accepts exactly this shape, so the funnel must offer the password screen.
  const split = {
    collegeId: 'c1',
    college: COLLEGE,
    verificationStatus: 'VERIFIED' as const,
    collegeEmailVerified: false,
    hasPassword: false,
    isProfileSetup: false,
  };
  assert.equal(step(split), '/setup-password');
  // Same split with a password but no profile: setup-profile, never /signup.
  assert.equal(step({ ...split, hasPassword: true }), '/setup-profile');
});
