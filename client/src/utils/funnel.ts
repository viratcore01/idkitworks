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
export function nextStep(user: User | null | undefined): string {
  if (!user) return '/login';
  // No college yet (legacy Google accounts created pre-funnel).
  if (!user.collegeId && !user.college) return '/setup-profile';
  // Not verified → the OTP flow (Google-domain users skip: already VERIFIED).
  if (user.verificationStatus !== 'VERIFIED' && !user.collegeEmailVerified) return '/verify';
  // Verified but passwordless → set the first password (skippable for
  // Google users — nothing here is a wall, the server gates the real actions).
  if (user.hasPassword === false) return '/setup-password';
  // Profile details incomplete (course/year/etc).
  if (!user.isProfileSetup) return '/setup-profile';
  return '/home';
}
