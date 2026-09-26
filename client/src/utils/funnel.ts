import type { User } from '@/types';

/**
 * The single funnel router: every auth entry point (signup, Google, login,
 * OTP-verify, password-set, profile-save) lands here, so a user can never be
 * stuck on — or skip past — a step. The server re-enforces every transition;
 * this only decides which screen to show.
 *
 * Order: college → college-email verification → password → profile details.
 * A missing/undefined flag is treated as "step needed" (safe direction).
 */
/**
 * The ONE definition of "verified" for the whole client — and it must match
 * the server's setInitialPassword gate exactly (flag OR status). Every guard
 * (CollegeRoute, VerifiedRoute, PasswordRoute via nextStep), every page gate
 * (SetupPasswordPage), and funnelDone must use THIS and nothing else:
 * mirror-or-bust, because any semantic drift between two checks of the same
 * account is precisely the disagreement that strands users on a screen whose
 * header promises what the next call refuses.
 *
 * Fail-closed on missing data: an absent flag never reads as verified.
 */
export function isFunnelVerified(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.verificationStatus === 'VERIFIED' || user.collegeEmailVerified === true;
}

/**
 * Does this account already have its college?
 *
 * The college is chosen ONCE, in the wizard, before the account exists — after
 * that it is the isolation boundary for posts/matches/chats and is locked
 * server-side. Both signals are checked because the login/signup responses
 * carry collegeId while /auth/me also carries the college object: a screen must
 * treat either one as "already chosen", never as "no college".
 *
 * Anything that renders a college as editable must key off this — a missing
 * collegeId in one payload must never turn a locked field back into a picker.
 */
export function hasCollege(user: User | null | undefined): boolean {
  return !!(user?.collegeId || user?.college);
}

/**
 * Has this account finished onboarding — is it "just a user of the app"?
 *
 * Exactly one consumer: PublicRoute. A mid-funnel account (created by the
 * signup wizard's "Send my code", still unverified and passwordless) must be
 * allowed to STAY on /signup — the wizard owns its next three screens, and the
 * inline OTP is the reason the email is only ever typed once. Kicking such an
 * account out of the wizard bounces it /home → /verify, where the pitch screen
 * demands the same email a second time.
 *
 * "Done" therefore means the account can stand on its own: it has a way back
 * in (password or Google), no open funnel step in front of it, AND its college
 * email is verified. Verification is not optional here: an unverified account
 * that PublicRoute calls "done" gets evicted to /home, where CollegeRoute
 * bounces it straight back to /signup — an infinite guard ping-pong (the
 * redirect loop that hung the tab white on 2026-09-25). The two guards must
 * never disagree about the same account.
 *
 * The verification check below is the EXACT mirror of nextStep's ("status is
 * VERIFIED OR the OTP flag is true"). Mirror-or-bust: any semantic drift
 * between the two is precisely the guard disagreement that becomes a loop.
 * A just-verified account (flag true, status string still UNVERIFIED) counts
 * as done — the flag is the faster truth; the status refreshes a beat later.
 */
export function funnelDone(user: User | null | undefined): boolean {
  if (!user) return false;
  // Password is compulsory for EVERYONE — Google sign-in included. A Google
  // link is a way back in, never a substitute for the password: same bar as
  // the normal email funnel (college → verification → password → profile).
  const hasWayIn = user.hasPassword === true;
  if (!hasCollege(user) || !hasWayIn || !user.isProfileSetup) return false;
  return isFunnelVerified(user);
}

export function nextStep(user: User | null | undefined): string {
  if (!user) return '/login';
  // No college yet (legacy Google accounts created pre-funnel).
  if (!hasCollege(user)) return '/setup-profile';
  // Not verified → the signup wizard, which resumes straight at its OTP step
  // (the standalone verification page no longer exists).
  if (!isFunnelVerified(user)) return '/signup';
  // Verified but passwordless → set the first password. COMPULSORY, no
  // skipping — Google users go through the exact same step as email users.
  // Anything but an explicit true bounces (fail closed: a missing flag must
  // never read as "has a password").
  if (user.hasPassword !== true) return '/setup-password';
  // Profile details incomplete (course/year/etc).
  if (!user.isProfileSetup) return '/setup-profile';
  return '/home';
}
