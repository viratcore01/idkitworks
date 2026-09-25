import { prisma, TX_OPTIONS } from '../config/prisma';
import { hashPassword, comparePassword, isPasswordSet } from '../utils/password';
import { checkEmail } from '../utils/email-validation';
import { checkUsernameLocally, normalizeUsername, UsernameAvailability } from '../utils/username';
import { sendPasswordResetEmail } from '../utils/email';
import { codesMatch, generateOtpCode, OTP_PATTERN } from '../utils/otp';
import {
  generateAccessToken,
  generateRefreshToken,
  parseDuration,
} from '../utils/jwt';
import { env } from '../config/env';
import { JwtPayload } from '../types';
import { invalidateUser } from '../utils/user-cache';
import { verifyGoogleIdToken, availableHandle, baseHandle } from './google-auth.service';

/**
 * Constant dummy hash for the login timing-oracle fix: when the email does
 * not exist we still run one bcrypt compare so "unknown email" and "wrong
 * password" take the same time to answer.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7tAUFnOnV0Co7f3OSJ8X6VzX2rZC0Ny';

/**
 * Funnel step 1+2 (college → identity). The account is created WITHOUT a
 * password — the password is set later via setInitialPassword, which the
 * server allows ONLY after college-email verification. Identity (email, name)
 * is collected up front so uniqueness fails fast, before the user spends a
 * one-time code. The USERNAME is deliberately not collected here: every path
 * mints a generated placeholder and the owner picks the real handle once, in
 * profile setup (usernameChosen flips there, profile setup completes).
 */
interface SignupStartInput {
  collegeId: string;
  email: string;
  displayName: string;
}

/**
 * Explicit 409 for identity collisions.
 *
 * These used to be bare `Error('Email already in use')` and the controller
 * recovered the status by substring-matching the message (`includes('already')`)
 * — a fragile coupling where re-wording a message silently downgrades a 409 to
 * a 400. The status is now part of the error, like every other actionable
 * failure in this file.
 */
function conflict(message: string): never {
  const e: any = new Error(message);
  e.status = 409;
  throw e;
}

/** Stale passwordless+unverified rows are junk (abandoned signups) — purged on every start. */
const PENDING_PURGE_DAYS = 7;

/** Forgotten-password codes: 10-minute life, 3 sends per window, 5 guesses. */
const RESET_PURPOSE = 'PASSWORD_RESET';
const RESET_TTL_MINUTES = 10;
const MAX_RESET_SENDS_PER_WINDOW = 3;
const MAX_RESET_ATTEMPTS = 5;

async function purgeStalePendingSignups(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - PENDING_PURGE_DAYS * 24 * 3600 * 1000);
    const candidates = await prisma.user.findMany({
      where: {
        collegeEmailVerified: false,
        verificationStatus: { not: 'VERIFIED' },
        createdAt: { lt: cutoff },
      },
      select: { id: true, passwordHash: true },
    });
    for (const c of candidates) {
      // Only rows that never set a password: anyone with a real password is a
      // real user, even if unverified. Per-row + best-effort: rows referenced
      // by safety tables (reports filed) are skipped, never forced.
      if (isPasswordSet(c.passwordHash)) continue;
      try {
        await prisma.user.delete({ where: { id: c.id } });
      } catch { /* referenced elsewhere — leave it */ }
    }
  } catch { /* housekeeping never blocks signup */ }
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarPhotoId: string | null;
    collegeId: string | null;
    isProfileSetup: boolean;
    collegeEmail: string | null;
    collegeEmailVerified: boolean;
    verificationStatus: string;
    hasPassword: boolean;
    usernameChosen: boolean;
  };
}

function createPayload(user: { id: string; email: string; username: string; role: string }): JwtPayload {
  return { userId: user.id, email: user.email, username: user.username, role: user.role };
}

function createAuthResponse(user: any, accessToken: string, refreshToken: string): AuthTokens {
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarPhotoId: user.avatarPhotoId ?? null,
      // College gate key: the client needs it immediately after login
      collegeId: user.collegeId ?? null,
      isProfileSetup: !!(user.collegeId && user.course && user.usernameChosen),
      // A generated placeholder handle is not "setup": the owner still owes
      // profile setup its one-time username choice.
      usernameChosen: user.usernameChosen ?? true,
      // The verified/being-verified inbox: /verify uses it to open straight on
      // the OTP form (no intro re-asking for the email the wizard has) and the
      // wizard's fast path matches it against a re-submitted identity.
      collegeEmail: user.collegeEmail ?? null,
      collegeEmailVerified: user.collegeEmailVerified ?? false,
      verificationStatus: user.verificationStatus ?? 'UNVERIFIED',
      // Funnel routing needs this immediately (no extra /me round-trip):
      // placeholder hashes (funnel/Google accounts) read as "no password".
      hasPassword: isPasswordSet(user.passwordHash),
    },
  };
}

export class AuthService {
  async signup(input: SignupStartInput, resumeUserId?: string): Promise<AuthTokens> {
    // Type guards: malformed JSON bodies must never reach Prisma (engine errors leak paths).
    if (
      typeof input?.collegeId !== 'string' || !input.collegeId ||
      typeof input?.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim()) ||
      typeof input?.displayName !== 'string' || input.displayName.trim().length < 2 || input.displayName.trim().length > 50
    ) {
      const e: any = new Error('Invalid signup details'); e.status = 400; throw e;
    }
    const email = input.email.trim().toLowerCase();

    // College anchors the whole funnel: it must exist AND be onboarded for
    // verification (have a student-mail domain). Fail fast here — creating an
    // account that can never verify would strand the user mid-funnel.
    const college = await prisma.college.findUnique({
      where: { id: input.collegeId },
      select: { id: true, name: true, emailDomain: true },
    });
    if (!college) {
      const e: any = new Error('College not found'); e.status = 400; throw e;
    }
    if (!college.emailDomain) {
      const e: any = new Error(`${college.name} is not onboarded for verification yet — contact support`);
      e.status = 400; e.code = 'COLLEGE_NOT_ONBOARDED'; throw e;
    }
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain !== college.emailDomain.toLowerCase()) {
      const e: any = new Error(`Use your college email (@${college.emailDomain})`);
      e.status = 400; e.code = 'COLLEGE_DOMAIN_MISMATCH'; throw e;
    }

    // Email hygiene: syntax + disposable-inbox block + typo suggestion.
    const emailCheck = checkEmail(email);
    if (!emailCheck.ok) {
      const e: any = new Error(emailCheck.error || 'Invalid email'); e.status = 400;
      e.code = 'EMAIL_INVALID';
      throw e;
    }
    if (emailCheck.suggestion) {
      // Not fatal — but the client shows "did you mean?" before creating the account
      const e: any = new Error(`Did you mean ${emailCheck.suggestion}?`); e.status = 400;
      e.code = 'EMAIL_TYPO';
      e.suggestion = emailCheck.suggestion;
      throw e;
    }

    // Free squatted identities from signups abandoned a week ago.
    await purgeStalePendingSignups();

    // Returning wizard? The caller still holds the session minted when the
    // draft was created (the client attaches it automatically). When it
    // identifies an UNFINISHED draft of its own — no password, inbox unproven
    // — the signup continues THAT row, so a corrected email or a redone
    // college step resumes instead of orphaning the draft and minting a
    // second row. (The handle used to be this link; it lives in profile setup
    // now, so the session is the link.) Proven or password-bearing rows never
    // resume — they fall through to the stranger path below with all its
    // 409s. A missing/invalid session behaves exactly like a logged-out call.
    let existingUser: any = null;
    if (typeof resumeUserId === 'string' && resumeUserId) {
      const mine = await prisma.user.findUnique({ where: { id: resumeUserId } });
      if (
        mine &&
        !isPasswordSet(mine.passwordHash) &&
        !mine.collegeEmailVerified &&
        mine.verificationStatus !== 'VERIFIED'
      ) {
        existingUser = mine;
      }
    }

    // USERNAME is not collected at signup (the handle is generated below and
    // chosen once in profile setup), so uniqueness here is email-only: the
    // login address plus collegeEmail, so a legacy personal-email account
    // holding this college address blocks reuse. The DB's UNIQUE
    // (LOWER(username)) stays the race-proof backstop for the generator.
    existingUser ??= await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { collegeEmail: email },
        ],
      },
    });

    if (existingUser) {
      const hasPw = isPasswordSet(existingUser.passwordHash);
      const verified = existingUser.collegeEmailVerified || existingUser.verificationStatus === 'VERIFIED';
      /** Whether the matched row holds this inbox (always true — email is the only match now). */
      const sameInbox = existingUser.email === email || (existingUser as any).collegeEmail === email;

      // ── PROVEN account: verification is the ownership event ──
      //
      // Once the college inbox is verified, this row is not a draft any more,
      // and the wizard must never re-claim it: starting a signup needs no
      // secret, so "claim the row" would hand a session — and, while no
      // password exists, initial-password rights — to anyone who merely knows
      // the address. The wizard can only CONTINUE such an account, which it
      // does with the session it already holds. The distinct code lets the
      // client put the user back exactly where they stopped instead of showing
      // a dead-end "already in use".
      if (verified) {
        if (!hasPw && sameInbox) {
          const e: any = new Error('This college email is already verified — continue where you left off');
          e.status = 409; e.code = 'ALREADY_VERIFIED'; throw e;
        }
        conflict('Email already in use');
      }

      if (!hasPw) {
        // ── DRAFT (unverified, passwordless): a wizard-owned row ──
        //
        // RESUME, not 409: this claimant started signup and never finished —
        // no secret exists yet, so re-issuing a session leaks nothing (the
        // only thing it unlocks is requesting an OTP to this same inbox).
        //
        // COLLEGE MAY MOVE here, and only here. Nothing about a draft is
        // proven, so the wizard's step-1 "wrong college, start over" is the one
        // self-serve fix that exists; the move re-runs the same domain +
        // onboarded-campus gates above, and re-pointing the address means a
        // fresh OTP anyway (verification is what locks the boundary, which is
        // why a verified row is handled above and never gets here). An EMPTY
        // college is the same story from the other direction: it is exactly
        // what the wizard's college step exists to fill ("Sign in with Google"
        // on the login page creates such a row).
        // Refresh the claimed name (the handle is generated once at creation
        // and never re-rolled here — the owner picks the real one in profile
        // setup).
        // Coming back through the signup wizard may come with a CORRECTED
        // email (step-2 "wrong address? fix it"). The new address already
        // passed the same domain + hygiene gates above; re-point the pending
        // account at it after a dedicated clash check. Pre-verification the
        // account is worth exactly one OTP to its own inbox, so re-pointing
        // = re-owning — verification (an inbox-proof event) is what locks it.
        const updateData: { displayName: string; email?: string; collegeEmail?: string; collegeId?: string } = {
          displayName: input.displayName.trim(),
        };
        if (existingUser.collegeId !== input.collegeId) updateData.collegeId = input.collegeId;
        if (existingUser.email !== email) {
          const emailClash = await prisma.user.findFirst({
            where: { OR: [{ email }, { collegeEmail: email }], NOT: { id: existingUser.id } },
            select: { id: true },
          });
          if (emailClash) conflict('Email already in use');
          updateData.email = email;
          // The pending college address follows the login address: an
          // unverified collegeEmail is a memory of where the last code went,
          // and the wizard is about to send a new one.
          if (!(existingUser as any).collegeEmailVerified) updateData.collegeEmail = email;
        }
        const user = await prisma.user.update({
          where: { id: existingUser.id },
          data: updateData,
        });
        return this.issueSession(user);
      }

      // A password exists but the inbox was never proven (legacy row): a real
      // account — the password, not this request, owns it.
      conflict('Email already in use');
    }

    // No password yet — parked placeholder (same shape as Google-created
    // accounts). The real password is set post-verification via
    // setInitialPassword, which the server gates on collegeEmailVerified.
    // The handle is a generated placeholder too — the owner picks the real
    // one once, in profile setup (usernameChosen flips there).
    const placeholderHash = crypto.randomUUID() + crypto.randomUUID();
    const username = await availableHandle(baseHandle(input.displayName, email));

    let user: any;
    try {
      user = await prisma.user.create({
        data: {
          email,
          passwordHash: placeholderHash,
          username,
          usernameChosen: false,
          displayName: input.displayName.trim(),
          collegeId: input.collegeId,
          collegeEmail: email,
        },
      });
    } catch (err: any) {
      // Two people submitting the same email in the same second: the DB
      // unique index is the truth — answer 409, never 500.
      if (err?.code === 'P2002') {
        conflict('Email already in use');
      }
      throw err;
    }

    return this.issueSession(user);
  }

  /**
   * Live "is this handle free?" check behind the wizard's identity step.
   *
   * ADVISORY ONLY. It exists so the user isn't told "taken" only after they
   * spend an OTP on it — the authoritative gate stays the DB's
   * UNIQUE (LOWER(username)) at insert time, so a race still ends in a clean
   * 409 rather than a two-people-one-handle mistake. Checking never reserves
   * anything: a handle is only claimed by the INSERT that succeeds.
   *
   * Shape and reserved words are answered without touching the database.
   */
  async isUsernameAvailable(raw: unknown): Promise<UsernameAvailability> {
    const local = checkUsernameLocally(raw);
    if (!local.available) return local;

    const taken = await prisma.user.findFirst({
      where: { username: { equals: local.username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (taken) {
      return {
        username: local.username,
        available: false,
        reason: 'taken',
        error: 'That username is already taken',
      };
    }
    return local;
  }

  /** Mint a fresh session pair for a user row (signup start/resume). */
  private async issueSession(user: any): Promise<AuthTokens> {
    const payload = createPayload(user);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

    // Housekeeping: expired tokens otherwise accumulate forever. Indexed and
    // fire-and-forget — never blocks the response.
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    return createAuthResponse(user, accessToken, refreshToken);
  }

  /**
   * SET the first password for a funnel account. Allowed ONLY when the
   * college email is verified AND no password exists yet — session auth alone
   * is never enough (a stolen pre-verification session must not become
   * permanent ownership), and an existing password is never overwritten here
   * (changePassword owns that path). No session kill: the placeholder was
   * unguessable, so there is no stolen session to revoke — the owner sails
   * straight into profile setup.
   */
  async setInitialPassword(userId: string, newPassword: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      const e: any = new Error('Password must be 8-128 characters'); e.status = 400; throw e;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { collegeEmailVerified: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive) {
      const e: any = new Error('Account unavailable'); e.status = 401; throw e;
    }
    if (!user.collegeEmailVerified) {
      const e: any = new Error('Verify your college email first');
      e.status = 403; e.code = 'VERIFICATION_REQUIRED'; throw e;
    }
    if (isPasswordSet(user.passwordHash)) {
      const e: any = new Error('This account already has a password — change it instead'); e.status = 400; throw e;
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    invalidateUser(userId);
  }

  /**
   * ── Step 1 of forgotten-password: mail a reset code ──
   *
   * DELIBERATE TRADE-OFF: every input produces the SAME successful response —
   * known identifier, unknown identifier, Google-only account, or a throttled
   * request. Any difference (404, 429, a distinct message) turns this endpoint
   * into an account-existence oracle, which is precisely what login goes to
   * lengths to avoid. The cost is that a throttled user isn't told why no mail
   * arrived; the client's own 60-second resend cooldown covers the common case,
   * and the per-IP limiter (which does not depend on the account) still answers
   * 429 for outright abuse.
   *
   * The code goes to the account's LOGIN email — the address the person asking
   * has on file and just typed (for funnel accounts that IS the verified college
   * email; a Google-created row keeps its Google address). Sending it to some
   * other proven inbox would be safe but baffling ("we mailed your other
   * account"), and it is never taken from the request body.
   */
  async requestPasswordReset(identifier: string): Promise<{ sent: true; expiresIn: number }> {
    const generic = { sent: true as const, expiresIn: RESET_TTL_MINUTES * 60 };
    if (typeof identifier !== 'string' || !identifier.trim()) return generic;
    const id = identifier.trim();

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: id, mode: 'insensitive' } },
          { username: { equals: id, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, collegeEmail: true, passwordHash: true, isActive: true, collegeId: true },
    });
    if (!user || !user.isActive) return generic;

    // Google-only accounts have no password to reset: minting a first password
    // is a separate action that requires a FRESH Google ID token
    // (setPasswordViaGoogle). Doing it from an email code would quietly open a
    // second, weaker door into those accounts. Skipped — and, per the
    // trade-off above, indistinguishable from a send.
    if (!isPasswordSet(user.passwordHash)) return generic;

    const windowStart = new Date(Date.now() - RESET_TTL_MINUTES * 60 * 1000);
    const recent = await prisma.emailOtp.count({
      where: { userId: user.id, purpose: RESET_PURPOSE, createdAt: { gte: windowStart } },
    });
    if (recent >= MAX_RESET_SENDS_PER_WINDOW) return generic;

    // Housekeeping + retire any live reset code (marked used, not deleted, so
    // the send counter above can see it — same reasoning as the verify flow).
    await prisma.emailOtp.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
    await prisma.emailOtp.updateMany({
      where: { userId: user.id, purpose: RESET_PURPOSE, usedAt: null },
      data: { usedAt: new Date() },
    });

    const to = user.email;
    const college = user.collegeId
      ? await prisma.college.findUnique({ where: { id: user.collegeId }, select: { name: true } })
      : null;

    const code = generateOtpCode();
    // Send BEFORE persisting: a failed send must not leave a "phantom" code the
    // user can never receive (same guarantee as the verification flow).
    //
    // A send failure is LOGGED, not returned: surfacing it would tell the caller
    // that this identifier has an account (the mail is only attempted for real
    // ones), re-opening the enumeration oracle this endpoint is built to close.
    try {
      await sendPasswordResetEmail(to, code, college?.name ?? null);
    } catch (err: any) {
      console.error('[password-reset] mail send failed for user', user.id, err?.message || err);
      return generic;
    }

    await prisma.emailOtp.create({
      data: {
        userId: user.id,
        email: to,
        code,
        purpose: RESET_PURPOSE,
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
      },
    });

    return generic;
  }

  /**
   * ── Step 2 of forgotten-password: redeem the code and set a new password ──
   *
   * One generic failure for every bad path (unknown identifier, missing/expired
   * code, wrong code, attempt exhaustion) so nothing here reports whether an
   * account exists. Success sets the password and kills EVERY session — a reset
   * is exactly the moment you want a stolen device signed out.
   */
  async resetPassword(identifier: string, code: string, newPassword: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      const e: any = new Error('Password must be 8-128 characters'); e.status = 400; throw e;
    }
    const invalid = (): never => {
      const e: any = new Error('That code is invalid or has expired — request a new one');
      e.status = 400; e.code = 'RESET_CODE_INVALID';
      throw e;
    };
    // Shape check BEFORE any lookup: a malformed code is a client bug, not a
    // guess, and must not spend one of the five attempts.
    if (typeof identifier !== 'string' || !identifier.trim()) invalid();
    if (typeof code !== 'string' || !OTP_PATTERN.test(code.trim())) invalid();

    const id = identifier.trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: id, mode: 'insensitive' } },
          { username: { equals: id, mode: 'insensitive' } },
        ],
      },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) invalid();

    const otp = await prisma.emailOtp.findFirst({
      where: { userId: user!.id, purpose: RESET_PURPOSE, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) invalid();

    if (otp!.attempts >= MAX_RESET_ATTEMPTS) {
      await prisma.emailOtp.update({ where: { id: otp!.id }, data: { usedAt: new Date() } });
      invalid();
    }
    if (!codesMatch(otp!.code, code.trim())) {
      await prisma.emailOtp.update({ where: { id: otp!.id }, data: { attempts: otp!.attempts + 1 } });
      invalid();
    }

    // Redeem, rotate the secret, and end every session — atomically enough that
    // an interrupted reset can never leave a used code beside an old password.
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.emailOtp.update({ where: { id: otp!.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: user!.id }, data: { passwordHash } }),
      prisma.refreshToken.deleteMany({ where: { userId: user!.id } }),
    ]);
    invalidateUser(user!.id);
  }

  /**
   * Login with EITHER email or username (both case-insensitive — usernames
   * are case-insensitively unique by product rule, emails case-insensitive
   * by convention). One generic error for every failure path so the response
   * never becomes an account-existence oracle (timing + message).
   */
  async login(identifier: string, password: string): Promise<AuthTokens> {
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim()) {
      const e: any = new Error('Invalid email/username or password'); e.status = 401; throw e;
    }
    // Overlong passwords can never be valid (signup caps at 128) — reject
    // before bcrypt burns CPU on a 100kb payload.
    if (password.length > 128) {
      await comparePassword(password.slice(0, 128), DUMMY_HASH);
      throw new Error('Invalid email/username or password');
    }
    const id = identifier.trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: id, mode: 'insensitive' } },
          { username: { equals: id, mode: 'insensitive' } },
        ],
      },
    });

    if (!user) {
      // Always run one bcrypt compare, even for unknown identifiers —
      // otherwise response timing reveals which emails/usernames have
      // accounts (enumeration).
      await comparePassword(password, DUMMY_HASH);
      throw new Error('Invalid email/username or password');
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email/username or password');
    }

    if (!user.isActive) {
      // Distinct, honest message for suspended accounts — but only AFTER the
      // password proves ownership (a wrong password still says "invalid",
      // so the error never becomes an account-existence oracle).
      // NOTE: there is no self-serve return from here. Deactivation was
      // removed: logout and delete-forever are the only account exits.
      const e: any = new Error('Your account has been suspended. Contact support if you think this is a mistake.');
      e.status = 403;
      throw e;
    }

    const payload = createPayload(user);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

    return createAuthResponse(user, accessToken, refreshToken);
  }

  /**
   * Rotate the refresh token. Race-safe under concurrent 401 storms:
   * deleteMany on the un-expired token is an atomic claim — exactly ONE
   * concurrent caller wins the rotation; every loser gets 401 and the
   * client recovers by re-reading the (shared) stored token. No grace
   * windows, no token-family explosion from multi-tab refresh bursts.
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Type guard before the query: Prisma rejects malformed `where` values with
    // a validation error, which surfaces as a misleading 400 instead of the
    // 401 that "your session ended" deserves.
    if (typeof refreshToken !== 'string' || !refreshToken) {
      const e: any = new Error('Invalid or expired refresh token'); e.status = 401; throw e;
    }
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { select: { id: true, email: true, username: true, role: true, isActive: true } } },
    });

    if (!stored || stored.expiresAt < new Date() || !stored.user?.isActive) {
      const e: any = new Error('Invalid or expired refresh token'); e.status = 401; throw e;
    }

    // Atomic claim: the winner deletes the row; concurrent losers' deleteMany
    // affects 0 rows and they are told to re-authenticate.
    const claim = await prisma.refreshToken.deleteMany({
      where: { token: refreshToken, expiresAt: { gt: new Date() } },
    });
    if (claim.count === 0) {
      const e: any = new Error('Session was refreshed elsewhere — reloading');
      e.status = 401;
      throw e;
    }

    const payload = createPayload(stored.user as any);
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: stored.user.id,
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

    // Housekeeping: expired tokens otherwise accumulate forever. Indexed and
    // fire-and-forget — never blocks the refresh response.
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  /**
   * Revoke one session. Idempotent by contract: a missing, empty, or already
   * revoked token is a no-op, never an error — the client fires this on the way
   * out and must not be greeted with a 400 for having already logged out.
   */
  async logout(refreshToken: unknown): Promise<void> {
    if (typeof refreshToken !== 'string' || !refreshToken) return;
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  /**
   * Change password for a logged-in user. Verifies the current password,
   * then logs out EVERYWHERE (all refresh tokens die) — a password change
   * after a device theft must actually end the thief's session.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      const e: any = new Error('Invalid password'); e.status = 400; throw e;
    }
    // 8-floor everywhere (signup, set-initial, set-via-google, change):
    // one minimum means no path mints a weaker password than another.
    if (newPassword.length < 8 || newPassword.length > 128) {
      const e: any = new Error('New password must be 8-128 characters'); e.status = 400; throw e;
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      const e: any = new Error('Account unavailable'); e.status = 401; throw e;
    }
    const ok = await comparePassword(currentPassword, user.passwordHash);
    if (!ok) {
      const e: any = new Error('Current password is incorrect'); e.status = 403; throw e;
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    invalidateUser(userId);
  }

  /**
   * SET a password for a Google-created account that never had one.
   * Unlike changePassword this does NOT ask for the current password (there
   * isn't one — passwordHash is a random placeholder). Authorization is a
   * FRESH Google ID token for the LINKED Google account instead: session auth
   * alone must never mint a password, or a stolen session would become
   * permanent account ownership. Same session-kill as changePassword.
   */
  async setPasswordViaGoogle(userId: string, idToken: string, newPassword: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      const e: any = new Error('New password must be 8-128 characters'); e.status = 400; throw e;
    }
    if (typeof idToken !== 'string' || !idToken) {
      const e: any = new Error('Missing Google credential'); e.status = 400; throw e;
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      const e: any = new Error('Account unavailable'); e.status = 401; throw e;
    }
    if (!user.googleId) {
      const e: any = new Error('Google is not linked to this account'); e.status = 400; throw e;
    }
    if (isPasswordSet(user.passwordHash)) {
      const e: any = new Error('This account already has a password — change it instead'); e.status = 400; throw e;
    }
    const g = await verifyGoogleIdToken(idToken);
    if (g.googleId !== user.googleId) {
      const e: any = new Error('Google account does not match this profile'); e.status = 403; throw e;
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    invalidateUser(userId);
  }

  /**
   * PERMANENT account deletion (user-invoked "delete my account").
   *
   * This is the ONLY account exit besides logout. Everything the user owned
   * is wiped — profile, photos, OTP records, posts, comments, messages,
   * likes, saves, swipes, matches, notifications, reports they filed,
   * sessions — and the email/username are freed, so signing up again with
   * the same email starts completely fresh (new id, empty everything).
   *
   * What is kept: the user ROW itself (anonymized + locked) so foreign keys
   * from moderation/safety rows never dangle — reports filed AGAINST them,
   * ended match rows and conversation shells stay for safety review, with all
   * PII scrubbed. Deleting the row itself would either 500 on FK constraints
   * or cascade-wipe evidence peers and moderators rely on.
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isFounder: true } });
    if (!user) {
      const e: any = new Error('Account not found'); e.status = 404; throw e;
    }
    if (user.isFounder) {
      // The creator cannot delete the supreme account — not even by hand.
      const e: any = new Error('The founder account cannot be deleted'); e.status = 403; throw e;
    }

    // This transaction fans out into ~10 statements plus a per-conversation
    // cleanup loop, so it needs TX_OPTIONS' budget rather than Prisma's 5s
    // default — an account deletion that 500s halfway is the worst kind of
    // failure to leave a user staring at.
    await prisma.$transaction(async (tx) => {
      // Notifications: received ones die; authored ones lose their actor link.
      await tx.notification.deleteMany({ where: { recipientId: userId } });
      await tx.notification.updateMany({ where: { actorId: userId }, data: { actorId: null } });
      // Reports filed BY the user die; reports they RESOLVED (as admin) keep
      // the row but lose the resolver link.
      await tx.report.deleteMany({ where: { reporterId: userId } });
      await tx.report.updateMany({ where: { resolverId: userId }, data: { resolverId: null } });
      // Blocks either direction die with the account.
      await tx.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
      // Swipes either direction die.
      await tx.matchLike.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } });
      // Matches end (rows preserved for safety, peer sees them gone).
      await tx.match.updateMany({
        where: { OR: [{ userA: userId }, { userB: userId }], status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: new Date(), endedBy: userId },
      });
      // Authored messages die; memberships die; conversations left empty die.
      await tx.message.deleteMany({ where: { senderId: userId } });
      const memberships = await tx.conversationMember.findMany({ where: { userId }, select: { conversationId: true } });
      await tx.conversationMember.deleteMany({ where: { userId } });
      for (const m of memberships) {
        const remaining = await tx.conversationMember.count({ where: { conversationId: m.conversationId } });
        if (remaining === 0) {
          await tx.conversation.delete({ where: { id: m.conversationId } }).catch(() => {});
        }
      }
      // Authored comments die; authored posts die (their likes/saves/replies
      // cascade from the post row).
      await tx.comment.deleteMany({ where: { authorId: userId } });
      await tx.post.deleteMany({ where: { authorId: userId } });
      await tx.savedPost.deleteMany({ where: { userId } });
      await tx.postLike.deleteMany({ where: { userId } });
      // Photos: clear the avatar pointer first (no SetNull on that relation),
      // then wipe the bytes.
      await tx.user.update({ where: { id: userId }, data: { avatarPhotoId: null } });
      await tx.userPhoto.deleteMany({ where: { userId } });
      // OTP records die entirely.
      await tx.emailOtp.deleteMany({ where: { userId } });
      await tx.userInterest.deleteMany({ where: { userId } });
      await tx.matchPreference.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      const tag = `del_${userId.slice(0, 8)}${Date.now().toString(36).slice(-5)}`;
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `${tag}@deleted.local`,
          username: tag,
          usernameChosen: true,
          displayName: 'Deleted User',
          bio: null,
          avatarUrl: null,
          dateOfBirth: null,
          googleId: null,
          passwordHash: `DELETED_${userId}`,
          course: null,
          year: null,
          gender: 'UNKNOWN',
          relationshipGoals: [],
          isVerified: false,
          verificationStatus: 'UNVERIFIED',
          collegeEmail: null,
          collegeEmailVerified: false,
          collegeEmailVerifiedAt: null,
          isActive: false,
          role: 'user',
          collegeId: null,
          moderatedCollegeId: null,
        },
      });
    }, TX_OPTIONS);

    invalidateUser(userId);
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    include: {
      college: true,
      interests: { include: { interest: true } },
      photos: { select: { id: true, slot: true }, orderBy: { slot: 'asc' } },
      _count: { select: { posts: true } },
    },
    });

    if (!user) throw new Error('User not found');

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      usernameChosen: (user as any).usernameChosen ?? true,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarPhotoId: (user as any).avatarPhotoId ?? null,
      photos: user.photos.map((p) => ({ id: p.id, slot: p.slot })),
      bio: user.bio,
      college: user.college,
      collegeId: user.collegeId,
      course: user.course,
      year: user.year,
      isVerified: user.isVerified,
      verificationStatus: user.verificationStatus,
      collegeEmail: user.collegeEmail,
      collegeEmailVerified: user.collegeEmailVerified,
      collegeEmailVerifiedAt: user.collegeEmailVerifiedAt,
      role: user.role,
      isFounder: (user as any).isFounder || false,
      moderatedCollegeId: (user as any).moderatedCollegeId || null,
      interests: user.interests.map((ui) => ui.interest),
      postCount: user._count.posts,
      isProfileSetup: !!(user.collegeId && user.course && (user as any).usernameChosen),
      // Computed fresh on every read — never stored — so it ticks over on the
      // user's birthday without any data change (profiles show "21 yrs").
      age: user.dateOfBirth
        ? Math.floor((Date.now() - user.dateOfBirth.getTime()) / (365.25 * 24 * 3600 * 1000))
        : null,
      // Identity the OWNER already has (this endpoint is /auth/me only, never
      // a public profile): the setup screen renders these read-only once set
      // instead of demanding a retype the lock would then 403.
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      createdAt: user.createdAt,
      // Auth-method flags: the Settings screen shows "Change password" only
      // when a real password exists, and "Set a password" for Google-only
      // accounts (whose passwordHash is an unguessable placeholder).
      hasGoogle: !!user.googleId,
      hasPassword: isPasswordSet(user.passwordHash),
    };
  }

  async updateProfile(userId: string, data: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    collegeId?: string;
    // NOTE: no collegeEmail — the OTP flow owns it end-to-end (the body
    // rejects it, typed as any below so forged JS payloads still hit the 403).
    // username is changeable (first pick in profile setup, later edits from
    // Edit profile) — every value runs the same shape + reserved + uniqueness
    // gates, so a forged handle never lands on the row.
    username?: string;
    course?: string;
    year?: number;
    gender?: string;
    dateOfBirth?: string;
    relationshipGoals?: string[] | null;
    interestIds?: string[];
  }) {
    // ── Server-side validation (real apps never trust the client) ──
    const update: any = {};

    // An empty-string college means "no college" — normalize it to undefined so
    // it behaves like an explicit null (a no-op) instead of tripping the
    // locked-college guard with a scary 403 for what is really just a blank form
    // field. A REAL id still goes through the lock check below.
    if (data.collegeId === '') data.collegeId = undefined;

    // ── Identity lock (one true source: signup / Google auth) ──
    // Name comes from signup (or the Google profile) at account creation;
    // DOB and gender are set once in profile setup and then fixed. The
    // post-setup edit modal already shows these as "(locked)" — this makes
    // the API agree, so a crafted request can't rewrite an identity that
    // feeds age-segregation (DOB) and matching (gender).
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, dateOfBirth: true, gender: true, username: true, usernameChosen: true },
    });
    if (!current) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }
    if (data.displayName !== undefined && data.displayName.trim() !== current.displayName) {
      // A name that was never captured is filled ONCE here and locked from then
      // on. This matters because Google tokens without a `name` claim no longer
      // get an invented one from the email local part ("viratcore01") — that
      // placeholder used to be permanent, which made it a support ticket.
      // Filling the gap is the user's one and only chance to name themselves.
      const hasName = !!current.displayName && current.displayName.trim().length > 0;
      if (hasName) {
        const e: any = new Error('Your name is locked to what you signed up with'); e.status = 403; throw e;
      }
    }
    if (data.dateOfBirth !== undefined && data.dateOfBirth !== null && data.dateOfBirth !== '') {
      if (current.dateOfBirth) {
        // Same calendar day = a harmless resubmission (e.g. setup form
        // re-required the field for a half-finished profile). Any other
        // value is an attempt to change identity → refused.
        const sameDay = new Date(data.dateOfBirth).toDateString() === current.dateOfBirth.toDateString();
        if (!sameDay) {
          const e: any = new Error('Birth date is locked once set'); e.status = 403; throw e;
        }
      }
    }
    if (data.gender !== undefined && data.gender !== current.gender) {
      if (current.gender && current.gender !== 'UNKNOWN') {
        const e: any = new Error('Gender is locked once set'); e.status = 403; throw e;
      }
    }

    if (data.displayName !== undefined) {
      const name = data.displayName.trim();
      if (name.length < 2 || name.length > 50) throw new Error('Name must be 2-50 characters');
      update.displayName = name;
    }
    // ── Handle changes (profile setup's first pick, Edit profile after) ──
    // The handle stays changeable for the life of the account — only the
    // name, birth date, gender and college lock. EVERY change runs the same
    // gates: shape, reserved words, and app-wide uniqueness excluding self
    // (UNIQUE (LOWER(username)) is the race-proof backstop, mapped to a clean
    // 409 below). Resubmitting the current handle is a harmless no-op; keeping
    // the generated placeholder counts as choosing (flips the lock).
    if (data.username !== undefined) {
      const picked = normalizeUsername(data.username);
      const sameAsCurrent = picked === normalizeUsername(current.username);
      if (!current.usernameChosen && sameAsCurrent) {
        update.usernameChosen = true;
        invalidateUser(userId);
      } else if (!sameAsCurrent) {
        const check = checkUsernameLocally(picked);
        if (!check.available) {
          const e: any = new Error(check.error!);
          e.status = 400;
          e.code = check.reason === 'reserved' ? 'USERNAME_RESERVED' : 'USERNAME_INVALID';
          throw e;
        }
        const clash = await prisma.user.findFirst({
          where: { username: { equals: picked, mode: 'insensitive' }, NOT: { id: userId } },
          select: { id: true },
        });
        if (clash) conflict('Username already taken');
        update.username = picked;
        update.usernameChosen = true;
        invalidateUser(userId);
      }
    }
    if (data.bio !== undefined) {
      const bio = data.bio.trim();
      if (bio.length > 300) throw new Error('Bio must be under 300 characters');
      update.bio = bio;
    }
    if (data.course !== undefined) {
      const course = data.course.trim();
      if (course.length > 50) throw new Error('Course must be under 50 characters');
      update.course = course;
    }
    if (data.year !== undefined) {
      const yr = Number(data.year);
      if (![1, 2, 3, 4, 5].includes(yr)) throw new Error('Invalid year');
      update.year = yr;
    }
    if (data.gender !== undefined) {
      if (!['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'].includes(data.gender)) throw new Error('Invalid gender');
      update.gender = data.gender;
    }
    // MULTI-SELECT "Looking for": dedupe, keep only known goals, empty list =
    // "rather not say" (stored as [] — must never silently filter anyone out).
    if (data.relationshipGoals !== undefined) {
      if (data.relationshipGoals === null || (Array.isArray(data.relationshipGoals) && data.relationshipGoals.length === 0)) {
        update.relationshipGoals = [];
      } else if (Array.isArray(data.relationshipGoals)) {
        const VALID = ['DATING', 'RELATIONSHIP', 'HOOKUP', 'CASUAL', 'NOT_SURE'];
        const goals = [...new Set(data.relationshipGoals.filter((g) => typeof g === 'string' && VALID.includes(g)))];
        update.relationshipGoals = goals;
      } else {
        throw new Error('Invalid relationship goals');
      }
    }
    if (data.dateOfBirth !== undefined && data.dateOfBirth !== null && data.dateOfBirth !== '') {
      // (Lock for already-set DOB is enforced above.)
      const dob = new Date(data.dateOfBirth);
      if (isNaN(dob.getTime())) throw new Error('Invalid date of birth');
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 16) throw new Error('You must be at least 16 to use Skola');
      if (age > 100) throw new Error('Invalid date of birth');
      update.dateOfBirth = dob;
    }
    if (data.avatarUrl !== undefined && data.avatarUrl !== null) {
      const url = data.avatarUrl.trim();
      if (url && !/^https:\/\//.test(url)) throw new Error('Avatar URL must be https');
      update.avatarUrl = url || null;
    }
    // College email is owned END-TO-END by the OTP flow (send overwrites it
    // pre-verification, verify locks it). Profile edits can never touch it —
    // any value here is rejected so a forged request can't stage an address
    // the OTP service didn't issue a code for.
    if ((data as any).collegeEmail !== undefined && (data as any).collegeEmail !== null) {
      const e: any = new Error('College email is managed through verification — use /verify');
      e.status = 403; throw e;
    }
    if (data.collegeId !== undefined && data.collegeId !== null) {
      if (data.collegeId) {
        const college = await prisma.college.findUnique({ where: { id: data.collegeId } });
        if (!college) throw new Error('College not found');
      }

      // PRODUCT RULE: college is the isolation boundary, chosen at signup.
      // It locks the MOMENT THE ACCOUNT EXISTS (not just post-OTP): every
      // future reference — posts, matches, chats, the OTP domain itself —
      // hangs off it, and the wizard's "back" still allows a redo BEFORE
      // submitting (no account yet). After that, support/super-admin only.
      const current = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
      if (current?.collegeId && current.collegeId !== data.collegeId) {
        const e: any = new Error('Your college is locked to your account. Contact support to change it.'); e.status = 403; throw e;
      }
      update.collegeId = data.collegeId || null;
      invalidateUser(userId); // the auth gate resolves collegeId per request
    }

    // If updating interests, replace all (validate they exist)
    let interestConnect: any;
    if (data.interestIds) {
      if (data.interestIds.length > 15) throw new Error('Pick at most 15 interests');
      if (data.interestIds.length) {
        const found = await prisma.interest.findMany({ where: { id: { in: data.interestIds } } });
        if (found.length !== data.interestIds.length) throw new Error('One or more interests not found');
        interestConnect = data.interestIds.map((interestId) => ({ interestId }));
      }
      await prisma.userInterest.deleteMany({ where: { userId } });
    }

    let user: any;
    try {
      user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...update,
          ...(data.interestIds && {
            interests: { create: interestConnect || [] },
          }),
        },
        include: {
          college: true,
          interests: { include: { interest: true } },
          photos: { select: { id: true, slot: true }, orderBy: { slot: 'asc' } },
        },
      });
    } catch (err: any) {
      // Lost a handle race between the check above and this write (two people
      // claiming the same handle in the same second): the DB's UNIQUE
      // (LOWER(username)) is the truth — answer 409, never 500.
      if (err?.code === 'P2002') conflict('Username already taken');
      throw err;
    }

    return {
      id: user.id,
      username: user.username,
      usernameChosen: (user as any).usernameChosen ?? true,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarPhotoId: (user as any).avatarPhotoId ?? null,
      photos: user.photos.map((p: any) => ({ id: p.id, slot: p.slot })),
      bio: user.bio,
      college: user.college,
      course: user.course,
      year: user.year,
      gender: user.gender,
      relationshipGoals: user.relationshipGoals,
      dateOfBirth: user.dateOfBirth,
      age: user.dateOfBirth
        ? Math.floor((Date.now() - user.dateOfBirth.getTime()) / (365.25 * 24 * 3600 * 1000))
        : null,
      interests: user.interests.map((ui: any) => ui.interest),
    };
  }

  /** Which fields a user still needs to fill — powers the completeness meter. */
  async getProfileCompleteness(userId: string) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatarUrl: true,
        photos: { select: { id: true } },
        bio: true,
        course: true,
        year: true,
        gender: true,
        dateOfBirth: true,
        collegeId: true,
        interests: { select: { interestId: true } },
        matchPreference: { select: { id: true } },
      },
    });
    if (!u) throw new Error('User not found');

    const checks = [
      { key: 'college', done: !!u.collegeId, weight: 20, label: 'Add your college' },
      { key: 'bio', done: !!(u.bio && u.bio.length >= 10), weight: 15, label: 'Write a bio (10+ chars)' },
      { key: 'photo', done: !!u.avatarUrl || u.photos.length > 0, weight: 20, label: 'Add a profile photo' },
      { key: 'interests', done: u.interests.length >= 3, weight: 15, label: 'Pick 3+ interests' },
      { key: 'dob', done: !!u.dateOfBirth, weight: 15, label: 'Add your birth date' },
      { key: 'gender', done: !!u.gender && u.gender !== 'UNKNOWN', weight: 10, label: 'Set your gender' },
      { key: 'prefs', done: !!u.matchPreference, weight: 5, label: 'Set discovery preferences' },
    ];
    const score = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
    const missing = checks.filter((c) => !c.done).map((c) => ({ key: c.key, label: c.label, weight: c.weight }));
    return { score, missing };
  }
}
