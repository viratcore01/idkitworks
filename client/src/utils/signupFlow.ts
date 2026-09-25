/**
 * The signup wizard as a pure state machine.
 *
 * Why this is a separate module: the "back" behaviour is the part of the funnel
 * users actually feel, and the part that is easiest to get subtly wrong (a
 * rewrite that drops the college, a back that strands a passwordless account).
 * Here it is data in / data out, so every press is unit-tested instead of being
 * reasoned about in JSX.
 *
 * ORDER: college → identity → otp → password.
 */

export type Phase = 'college' | 'identity' | 'otp' | 'password';

export const PHASES: readonly Phase[] = ['college', 'identity', 'otp', 'password'] as const;

export interface WizardState {
  phase: Phase;
  /** The college picked in step 1, or null when nothing is picked. */
  collegeId: string | null;
  email: string;
  username: string;
  displayName: string;
}

export type BackResult = { kind: 'state'; state: WizardState } | { kind: 'exit' };

/** 0-based position of a phase inside the wizard. */
export function stepIndex(phase: Phase): number {
  const i = PHASES.indexOf(phase);
  return i < 0 ? 0 : i;
}

/**
 * Where one press of "back" lands.
 *
 * The two rules that make this useful rather than merely symmetric:
 *
 *  1. ONE STEP BACK IS AN EDIT. From the code screen, back reopens the identity
 *     form WITH the typed values still in it — you cannot fix a typo in an
 *     address you can no longer see. The email is the thing being proven, so it
 *     stays on screen to be corrected (and correcting it re-verifies, because a
 *     changed address is a different claim).
 *
 *  2. A JUMP BACK TO STEP 1 IS A RESTART. From the password screen — the point
 *     at which the identity is fully proven and the only thing left is a secret
 *     — back goes straight to step 1 and wipes what was typed above it. A redo
 *     asks for the address again instead of silently reusing the old one; the
 *     proven account itself is NOT thrown away server-side (see leaveWizard in
 *     SignupPage), it is simply left unfinished.
 *
 * Leaving the wizard is only reachable from an empty step 1: pick → clear pick
 * → exit. Three presses from the password screen, exactly like stepping out of
 * a stack of screens.
 */
export function goBack(state: WizardState): BackResult {
  switch (state.phase) {
    case 'password':
      return {
        kind: 'state',
        state: {
          ...state,
          phase: 'college',
          // The layers above step 1 are gone: restart, not resume.
          email: '',
          username: '',
          displayName: '',
        },
      };
    case 'otp':
      // Keep every field: this is the "wrong address? fix it" path.
      return { kind: 'state', state: { ...state, phase: 'identity' } };
    case 'identity':
      // Keep the college visible so the pick can be reviewed, not re-typed.
      return { kind: 'state', state: { ...state, phase: 'college' } };
    case 'college':
    default:
      if (state.collegeId) {
        // One more layer: the blank signup entry. The identity goes with the
        // college — a cleared pick means "from the top", and carrying an old
        // address into a different campus's domain check only produces a
        // confusing mismatch.
        return {
          kind: 'state',
          state: { ...state, phase: 'college', collegeId: null, email: '', username: '', displayName: '' },
        };
      }
      return { kind: 'exit' };
  }
}

/**
 * The wizard's sessionStorage keys.
 *
 * Written so a RELOAD keeps the current step (a code may already be in the
 * inbox and needs a screen to land on) and cleared the moment the user leaves
 * the wizard on purpose — by back, or by walking out of onboarding altogether.
 */
/** The keys describing the picked college (name/domain are kept so a reload
 *  can redraw the pick without a network round trip). */
export const COLLEGE_STORAGE_KEYS = [
  'signup:collegeId', 'signup:collegeName', 'signup:collegeShort', 'signup:collegeDomain',
] as const;

export const WIZARD_STORAGE_KEYS = [
  'signup:phase', 'signup:email', 'signup:username', 'signup:displayName',
  ...COLLEGE_STORAGE_KEYS,
  'signup:cooldownUntil',
] as const;

/**
 * Forget everything the wizard remembered. Takes the storage in as an argument
 * so this stays testable outside a browser.
 */
export function clearWizardDraft(storage: Pick<Storage, 'removeItem'>): void {
  for (const key of WIZARD_STORAGE_KEYS) storage.removeItem(key);
}

/** The college shape storage needs (a subset of the picker's option). */
export interface WizardCollege {
  id: string;
  name?: string | null;
  shortName?: string | null;
  emailDomain?: string | null;
}

/**
 * Write a wizard state (plus the college pick) to storage.
 *
 * Needed after an EXPLICIT clear: the wizard's persistence effects only fire
 * when a value CHANGES, so a value that SURVIVES a back press — the address,
 * when stepping back from the code screen to correct it — would be erased from
 * storage and then vanish on the next reload while still on screen. Found by
 * walking the live flow: the erased key never came back.
 */
export function saveWizardDraft(
  state: WizardState,
  picked: WizardCollege | null,
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
  storage.setItem('signup:phase', state.phase);
  storage.setItem('signup:email', state.email);
  storage.setItem('signup:username', state.username);
  storage.setItem('signup:displayName', state.displayName);
  if (picked) {
    storage.setItem('signup:collegeId', picked.id);
    storage.setItem('signup:collegeName', picked.name ?? '');
    picked.shortName
      ? storage.setItem('signup:collegeShort', picked.shortName)
      : storage.removeItem('signup:collegeShort');
    picked.emailDomain
      ? storage.setItem('signup:collegeDomain', picked.emailDomain)
      : storage.removeItem('signup:collegeDomain');
  } else {
    for (const key of COLLEGE_STORAGE_KEYS) storage.removeItem(key);
  }
}

/** A pristine wizard — what a fresh arrival (or a full reset) looks like. */
export function blankWizard(): WizardState {
  return { phase: 'college', collegeId: null, email: '', username: '', displayName: '' };
}

/**
 * Is the wizard re-submitting the SAME identity the account already proved?
 *
 * If so the verification still stands (same college, same proven address), so
 * the user goes straight to the password step: no second code, no second email,
 * no "already in use" dead end. Any difference — a different campus, a different
 * address — is a different claim that must be verified from scratch.
 */
export function isVerifiedIdentity(
  submitted: { collegeId: string | null; email: string },
  user: { collegeId?: string | null; collegeEmail?: string | null; collegeEmailVerified?: boolean } | null | undefined,
): boolean {
  if (!user?.collegeEmailVerified) return false;
  const email = submitted.email.trim().toLowerCase();
  const provenEmail = String(user.collegeEmail ?? '').trim().toLowerCase();
  if (!email || !provenEmail || email !== provenEmail) return false;
  return !!submitted.collegeId && submitted.collegeId === user.collegeId;
}

/**
 * Can this account be signed out without being locked out of itself?
 *
 * A verified account with no password and no Google link has NO way back in —
 * signing out would strand it permanently (nothing can authenticate it, and the
 * reset flow deliberately refuses to mint a first password from an email code).
 * Such an account is sent to the password step instead of the exit.
 */
export function canSignOut(user: { hasPassword?: boolean | null; hasGoogle?: boolean | null } | null | undefined): boolean {
  return !!user && (user.hasPassword === true || user.hasGoogle === true);
}
