import test from 'node:test';
import assert from 'node:assert/strict';
import {
  goBack,
  blankWizard,
  stepIndex,
  isVerifiedIdentity,
  canSignOut,
  clearWizardDraft,
  saveWizardDraft,
  COLLEGE_STORAGE_KEYS,
  WIZARD_STORAGE_KEYS,
  type WizardState,
} from '../src/utils/signupFlow';

/**
 * The wizard's back behaviour is the part of the funnel users feel and the
 * part that is easiest to get subtly wrong — a rewrite that drops the college,
 * a back that strands a passwordless account. It is a pure reducer precisely so
 * every press can be asserted here.
 */

const atPassword: WizardState = {
  phase: 'password',
  collegeId: 'c1',
  email: 'student@ipec.org.in',
  username: 'student',
  displayName: 'Student',
};

const stateOf = (result: ReturnType<typeof goBack>): WizardState => {
  assert.equal(result.kind, 'state', 'expected a step, not an exit');
  return (result as { kind: 'state'; state: WizardState }).state;
};

// ─────────────────────────── one press, one layer ───────────────────────────

test('back from the password screen jumps to step 1 and wipes the typed identity', () => {
  const next = stateOf(goBack(atPassword));
  assert.equal(next.phase, 'college');
  assert.equal(next.collegeId, 'c1', 'the pick stays visible so it can be reviewed');
  // A restart asks for the address again instead of silently reusing it.
  assert.equal(next.email, '');
  assert.equal(next.username, '');
  assert.equal(next.displayName, '');
});

test('back from the code screen reopens the SAME form, values and all', () => {
  // You cannot fix a typo in an address you can no longer see, so this press is
  // an edit — not a restart.
  const next = stateOf(goBack({ ...atPassword, phase: 'otp' }));
  assert.equal(next.phase, 'identity');
  assert.equal(next.email, 'student@ipec.org.in');
  assert.equal(next.username, 'student');
  assert.equal(next.displayName, 'Student');
  assert.equal(next.collegeId, 'c1');
});

test('back from identity returns to the college pick without losing it', () => {
  const next = stateOf(goBack({ ...atPassword, phase: 'identity' }));
  assert.equal(next.phase, 'college');
  assert.equal(next.collegeId, 'c1');
  assert.equal(next.email, 'student@ipec.org.in', 'identity values survive a step back');
});

test('back on a picked college clears the pick; back on an empty step 1 leaves the wizard', () => {
  const cleared = stateOf(goBack({ ...atPassword, phase: 'college' }));
  assert.equal(cleared.phase, 'college');
  assert.equal(cleared.collegeId, null);
  assert.equal(cleared.email, '', 'the identity is not resurrected by clearing the college');

  assert.deepEqual(goBack(cleared), { kind: 'exit' });
});

test('the whole chain from the password screen is exactly: college → blank → out', () => {
  const first = goBack(atPassword);
  const atCollege = stateOf(first);
  const second = goBack(atCollege);
  const blank = stateOf(second);
  assert.equal(blank.phase, 'college');
  assert.equal(blank.collegeId, null);
  assert.deepEqual(goBack(blank), { kind: 'exit' });
});

test('back never returns a phase that is not in the funnel', () => {
  const phases: WizardState['phase'][] = ['college', 'identity', 'otp', 'password'];
  for (const phase of phases) {
    const result = goBack({ ...atPassword, phase });
    if (result.kind === 'state') {
      assert.ok(['college', 'identity', 'otp', 'password'].includes(result.state.phase));
    }
  }
});

// ───────────────────────────────── geometry ─────────────────────────────────

test('stepIndex orders the funnel college → identity → otp → password', () => {
  assert.deepEqual(
    ['college', 'identity', 'otp', 'password'].map((p) => stepIndex(p as WizardState['phase'])),
    [0, 1, 2, 3],
  );
});

test('blankWizard is a pristine step 1', () => {
  assert.deepEqual(blankWizard(), { phase: 'college', collegeId: null, email: '', username: '', displayName: '' });
});

// ─────────────────── re-submitting an identity that is already proven ────────

const verified = { collegeId: 'c1', collegeEmail: 'student@ipec.org.in', collegeEmailVerified: true };

test('isVerifiedIdentity: same college + same proven address resumes without a second code', () => {
  assert.equal(isVerifiedIdentity({ collegeId: 'c1', email: 'student@ipec.org.in' }, verified), true);
  assert.equal(isVerifiedIdentity({ collegeId: 'c1', email: '  STUDENT@IPEC.ORG.IN  ' }, verified), true);
});

test('isVerifiedIdentity: a different college, a different address or an unproven one re-verifies', () => {
  assert.equal(isVerifiedIdentity({ collegeId: 'c2', email: 'student@ipec.org.in' }, verified), false, 'different campus');
  assert.equal(isVerifiedIdentity({ collegeId: 'c1', email: 'other@ipec.org.in' }, verified), false, 'different inbox');
  assert.equal(isVerifiedIdentity({ collegeId: 'c1', email: 'student@ipec.org.in' }, { ...verified, collegeEmailVerified: false }), false);
  assert.equal(isVerifiedIdentity({ collegeId: 'c1', email: 'student@ipec.org.in' }, null), false);
  assert.equal(isVerifiedIdentity({ collegeId: null, email: 'student@ipec.org.in' }, verified), false);
  assert.equal(isVerifiedIdentity({ collegeId: 'c1', email: '' }, verified), false);
  // A missing collegeEmail must never match an empty submission ('' === '').
  assert.equal(isVerifiedIdentity({ collegeId: 'c1', email: '' }, { collegeId: 'c1', collegeEmail: null, collegeEmailVerified: true }), false);
});

// ─────────────────────────── signing out safely ─────────────────────────────

test('canSignOut: an account with neither a password nor Google is never signed out mid-funnel', () => {
  assert.equal(canSignOut({ hasPassword: true, hasGoogle: false }), true);
  assert.equal(canSignOut({ hasPassword: false, hasGoogle: true }), true);
  assert.equal(canSignOut({ hasPassword: false, hasGoogle: false }), false, 'would be stranded forever');
  assert.equal(canSignOut({ hasPassword: false }), false);
  assert.equal(canSignOut({}), false);
  assert.equal(canSignOut(null), false);
  assert.equal(canSignOut(undefined), false);
});

// ─────────────────────── forgetting the remembered draft ────────────────────

test('clearWizardDraft forgets every key the wizard wrote, and nothing else', () => {
  const store = new Map<string, string>([['unrelated:key', 'keep me']]);
  for (const key of WIZARD_STORAGE_KEYS) store.set(key, 'written-during-signup');

  clearWizardDraft({ removeItem: (key: string) => { store.delete(key); } } as Pick<Storage, 'removeItem'>);

  assert.equal(store.get('unrelated:key'), 'keep me');
  for (const key of WIZARD_STORAGE_KEYS) {
    assert.equal(store.has(key), false, `${key} must be forgotten`);
  }
});

test('saveWizardDraft writes the surviving state back after an explicit clear', () => {
  // The bug this exists for: a deliberate back clears storage, and the wizard's
  // persistence effects only fire on CHANGE — so the address that survives the
  // press (stepping back from the code screen to fix it) was erased from
  // storage and then vanished on the next reload while still on screen.
  const store = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const pick = { id: 'c1', name: 'College One', shortName: 'C1', emailDomain: 'ipec.org.in' };

  saveWizardDraft({ phase: 'identity', collegeId: 'c1', email: 'student@ipec.org.in', username: 'student', displayName: 'Student' }, pick, storage);

  assert.equal(store.get('signup:phase'), 'identity');
  assert.equal(store.get('signup:email'), 'student@ipec.org.in', 'the value that survived must survive a reload too');
  assert.equal(store.get('signup:username'), 'student');
  assert.equal(store.get('signup:displayName'), 'Student');
  assert.equal(store.get('signup:collegeId'), 'c1');
  assert.equal(store.get('signup:collegeDomain'), 'ipec.org.in');
});

test('saveWizardDraft with no college clears the college keys', () => {
  const store = new Map<string, string>([
    ['signup:collegeId', 'c1'], ['signup:collegeName', 'College One'],
    ['signup:collegeShort', 'C1'], ['signup:collegeDomain', 'ipec.org.in'],
  ]);
  const storage = {
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  saveWizardDraft(blankWizard(), null, storage);

  for (const key of COLLEGE_STORAGE_KEYS) assert.equal(store.has(key), false, `${key} must be cleared`);
  assert.equal(store.get('signup:phase'), 'college');
  assert.equal(store.get('signup:email'), '');
});

test('the key list covers every field the wizard persists', () => {
  // Guards against a new persisted field being added without being cleared.
  for (const key of ['signup:phase', 'signup:email', 'signup:username', 'signup:displayName', 'signup:collegeId', 'signup:cooldownUntil']) {
    assert.ok((WIZARD_STORAGE_KEYS as readonly string[]).includes(key), `${key} missing from WIZARD_STORAGE_KEYS`);
  }
});
