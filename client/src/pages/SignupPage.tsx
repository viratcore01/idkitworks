import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Rocket, PartyPopper, Hourglass, GraduationCap, MailCheck, KeyRound, Mail, ArrowLeft, ShieldCheck, Lock, Check, X, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import CollegeSelect, { CollegeOption } from '@/components/common/CollegeSelect';
import GoogleButton from '@/components/common/GoogleButton';
import { verificationApi } from '@/services/verification';
import { checkUsername } from '@/services/username';
import { nextStep } from '@/utils/funnel';
import { goBack, isVerifiedIdentity, canSignOut, clearWizardDraft, saveWizardDraft, COLLEGE_STORAGE_KEYS, stepIndex, type Phase, type WizardState } from '@/utils/signupFlow';
import { sanitizeUsernameInput, localUsernameStatus, usernameFeedback, blocksSubmit, type UsernameStatus } from '@/utils/username';
import toast from 'react-hot-toast';

/**
 * Signup funnel — ONE page, ONE email typing:
 *   1. College        — anchors everything (domain shown, e.g. @ipec.org.in).
 *   2. Identity       — college email + name + username (checked live), or
 *                       Continue with Google (auto-verifies on domain match).
 *   3. Code           — the 6-digit OTP, sent to the email ABOVE. The address
 *                       is shown read-only: it was typed once, and it is the
 *                       thing being proven. "Edit details" goes back, and a
 *                       changed email always triggers a fresh code.
 *   4. Password       — first password, inline, right after verification.
 *
 * BACK (see utils/signupFlow.ts for the state machine):
 *   password ──▶ step 1, typed identity wiped (a restart)
 *   step 1   ──▶ blank signup entry (the pick cleared)
 *   step 1   ──▶ out of the wizard, back to the entry page
 * One step back is an edit (the code screen reopens the form with the values in
 * it, because you cannot fix an address you can no longer see); the jump from
 * the password screen is a restart, so it asks for the address again instead of
 * silently reusing it.
 *
 * RELOAD vs BACK: a reload (or a deploy landing under them) KEEPS the current
 * step and the typed values — a code may already be in the inbox and needs a
 * screen to land on. Only a deliberate back erases.
 *
 * And a redo costs no second email: coming back with the SAME college + SAME
 * proven address resumes on the password step, because that identity is still
 * verified — the server says so too (409 ALREADY_VERIFIED, never a session).
 */
const RESEND_COOLDOWN_SEC = 60;

/** Back means back: nothing typed in this wizard is remembered afterwards. */
function clearWizardStorage() {
  clearWizardDraft(sessionStorage);
}

const COLLEGE_KEYS = COLLEGE_STORAGE_KEYS;

export default function SignupPage() {
  const [phase, setPhase] = useState<Phase>(() => {
    const saved = sessionStorage.getItem('signup:phase');
    return saved === 'identity' || saved === 'otp' || saved === 'password' ? (saved as Phase) : 'college';
  });
  const [formData, setFormData] = useState({
    email: sessionStorage.getItem('signup:email') || '',
    username: sessionStorage.getItem('signup:username') || '',
    displayName: sessionStorage.getItem('signup:displayName') || '',
  });
  const [college, setCollege] = useState<CollegeOption | null>(() => {
    const id = sessionStorage.getItem('signup:collegeId');
    if (!id) return null;
    return {
      id,
      name: sessionStorage.getItem('signup:collegeName') || '',
      shortName: sessionStorage.getItem('signup:collegeShort') || null,
      emailDomain: sessionStorage.getItem('signup:collegeDomain') || null,
    };
  });
  const [isLoading, setIsLoading] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>(() => localUsernameStatus(sessionStorage.getItem('signup:username') || ''));
  const [cooldown, setCooldown] = useState(() => {
    const until = Number(sessionStorage.getItem('signup:cooldownUntil') || 0);
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  });
  const submittingRef = useRef(false); // ref guard: double-taps beat React re-render
  const usernameSeqRef = useRef(0); // stale-answer guard for the live check
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const signup = useAuthStore((s) => s.signup);
  const setInitialPassword = useAuthStore((s) => s.setInitialPassword);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Persist the flow so a reload mid-signup (deploy, refresh, misclick) never
  // throws the user back to square one with a code already in their inbox.
  // Deliberate backs bypass this by clearing storage (see handleBack).
  useEffect(() => { sessionStorage.setItem('signup:phase', phase); }, [phase]);
  useEffect(() => { sessionStorage.setItem('signup:email', formData.email); }, [formData.email]);
  useEffect(() => { sessionStorage.setItem('signup:username', formData.username); }, [formData.username]);
  useEffect(() => { sessionStorage.setItem('signup:displayName', formData.displayName); }, [formData.displayName]);
  useEffect(() => {
    if (college) {
      sessionStorage.setItem('signup:collegeId', college.id);
      sessionStorage.setItem('signup:collegeName', college.name);
      college.shortName ? sessionStorage.setItem('signup:collegeShort', college.shortName) : sessionStorage.removeItem('signup:collegeShort');
      college.emailDomain ? sessionStorage.setItem('signup:collegeDomain', college.emailDomain) : sessionStorage.removeItem('signup:collegeDomain');
    } else {
      for (const key of COLLEGE_KEYS) sessionStorage.removeItem(key);
    }
  }, [college]);
  useEffect(() => () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); }, []);

  /**
   * Live handle availability.
   *
   * Shape and reserved words are answered locally (instant, no request); only
   * "is it claimed?" needs the server, so it is debounced and any answer that
   * arrives for a value the user has since changed is dropped (the sequence
   * guard) — otherwise a slow response could label a good handle "taken".
   */
  useEffect(() => {
    const username = formData.username.trim().toLowerCase();
    const local = localUsernameStatus(username);
    if (local !== 'ok') {
      setUsernameStatus(local === 'empty' ? 'idle' : local);
      return;
    }
    setUsernameStatus('checking');
    const seq = ++usernameSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsername(username);
        if (seq !== usernameSeqRef.current) return;
        if (result.available) setUsernameStatus('available');
        else setUsernameStatus(result.reason === 'reserved' ? 'reserved' : 'taken');
      } catch {
        if (seq !== usernameSeqRef.current) return;
        // A failed CHECK is not a verdict: keep the button usable and let the
        // submit (whose unique index is the truth) decide.
        setUsernameStatus('unavailable');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [formData.username]);

  const update = (field: string, value: any) => setFormData((d) => ({ ...d, [field]: value }));

  const startCooldown = () => {
    const until = Date.now() + RESEND_COOLDOWN_SEC * 1000;
    sessionStorage.setItem('signup:cooldownUntil', String(until));
    setCooldown(RESEND_COOLDOWN_SEC);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  /** "gmial@…" → "Did you mean gmail@…?" — client-side, before we even hit the API. */
  const suggestEmailFix = (value: string): string | null => {
    const at = value.lastIndexOf('@');
    if (at < 1) return null;
    const domain = value.slice(at + 1).toLowerCase();
    const common = ['gmail.com', 'yahoo.com', 'yahoo.in', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'rediffmail.com', 'live.com'];
    const lev = (a: string, b: string) => {
      const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      return dp[a.length][b.length];
    };
    for (const k of common) {
      if (domain !== k && lev(domain, k) <= (k.length > 8 ? 2 : 1)) return value.slice(0, at + 1) + k;
    }
    return null;
  };

  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const handleEmailChange = (v: string) => {
    update('email', v);
    setEmailSuggestion(suggestEmailFix(v));
  };

  const fail = (msg: string) => {
    setStepError(msg);
    toast.error(msg);
  };

  const goApp = () => {
    navigate(nextStep(useAuthStore.getState().user), { replace: true });
  };

  // ── Back: one press, one layer, nothing remembered (see signupFlow.ts) ──
  const handleBack = async () => {
    if (isLoading) return;
    setStepError(null);
    setEmailSuggestion(null);
    const result = goBack({
      phase,
      collegeId: college?.id ?? null,
      email: formData.email,
      username: formData.username,
      displayName: formData.displayName,
    });
    if (result.kind === 'exit') {
      await leaveWizard();
      return;
    }
    const next: WizardState = result.state;
    const picked: CollegeOption | null = next.collegeId
      ? { id: next.collegeId, name: college?.name || '', shortName: college?.shortName || null, emailDomain: college?.emailDomain || null }
      : null;
    // Deliberate back = erased, then the SURVIVING state written back: what the
    // user still sees on screen must also survive a reload.
    clearWizardStorage();
    saveWizardDraft(next, picked, sessionStorage);
    setFormData({ email: next.email, username: next.username, displayName: next.displayName });
    setCollege(picked);
    setOtp('');
    setPassword('');
    setConfirm('');
    setCooldown(0);
    setPhase(next.phase);
  };

  /**
   * Out of the wizard, back to the entry page.
   *
   * With no account yet there is nothing to lose. With one, signing out is only
   * safe when something else can sign it back IN — a password, or Google. A
   * verified account that has neither (typed signup, password skipped) would be
   * stranded forever by a sign-out, so it goes to the one screen that creates a
   * way back instead.
   */
  const leaveWizard = async () => {
    clearWizardStorage();
    const me = useAuthStore.getState().user;
    if (!me) {
      navigate('/login', { replace: true });
      return;
    }
    if (!canSignOut(me)) {
      toast.error("Set a password first — it's the only way back into your account", { duration: 6000 });
      navigate('/setup-password', { replace: true });
      return;
    }
    await logout();
    navigate('/login', { replace: true });
  };

  // ── Step 1 → 2 ─────────────────────────────────────────────
  const goIdentity = () => {
    setStepError(null);
    if (!college) return fail('Pick your college to continue');
    if (!college.emailDomain) return fail('This campus is not onboarded for verification yet');
    setPhase('identity');
  };

  // ── Step 2: create account, then OTP — the email's one and only send ──
  const handleSubmit = async () => {
    if (submittingRef.current) return; // double-tap guard
    submittingRef.current = true;
    setIsLoading(true);
    setStepError(null);
    try {
      const email = formData.email.trim().toLowerCase();
      const collegeId = college!.id;
      const me = useAuthStore.getState().user;

      // SAME IDENTITY, ALREADY PROVEN → nothing to create and nothing to mail:
      // the verification still stands, so land back on the password step. This
      // is the "go back to step 1 and start again" round trip that must NOT
      // cost a second email or a second code.
      if (isVerifiedIdentity({ collegeId, email }, me)) {
        setPhase('password');
        toast.success('Your email is still verified — just set a password');
        return;
      }

      await signup({
        collegeId,
        email,
        username: formData.username.trim().toLowerCase(),
        displayName: formData.displayName.trim(),
      });

      const { data } = await verificationApi.sendCollegeEmail(email);
      startCooldown();
      setOtp('');
      setPhase('otp');
      // A live code for this address was reused (no new mail) — say so, or the
      // user waits for an email that is already sitting in their inbox.
      if (data?.reused) toast.success('Your earlier code is still valid — check your inbox');
      else toast.success(`Code sent to ${email}`);
    } catch (err: any) {
      const body = err.response?.data;
      // The server's authoritative version of the fast path above: this account
      // already proved this inbox (stale local state, or another tab). Continue
      // it rather than dying on a 409 that reads like a dead end.
      if (err.response?.status === 409 && body?.code === 'ALREADY_VERIFIED') {
        const me = useAuthStore.getState().user;
        const email = formData.email.trim().toLowerCase();
        if (me && String(me.collegeEmail || '').toLowerCase() === email) {
          setPhase('password');
          toast.success('Your email is still verified — just set a password');
          return;
        }
        fail(body?.error || 'This email is already verified — sign in to continue');
        return;
      }
      fail(body?.error || 'Signup failed');
    } finally {
      setIsLoading(false);
      submittingRef.current = false;
    }
  };

  // ── Step 3: verify → inline password (the ONLY door to step 4) ──
  const handleVerify = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsLoading(true);
    setStepError(null);
    try {
      await verificationApi.verifyCollegeEmail(otp.trim());
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['verification-status'] });
      await useAuthStore.getState().fetchMe();
      const user = useAuthStore.getState().user;
      if (user && user.hasPassword === false) {
        setPhase('password');
        toast.success("You're verified! 🎓");
      } else {
        goApp();
      }
    } catch (err: any) {
      fail(err.response?.data?.error || 'Invalid code — try again');
    } finally {
      setIsLoading(false);
      submittingRef.current = false;
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || isLoading) return;
    setIsLoading(true);
    setStepError(null);
    try {
      const { data } = await verificationApi.resend();
      startCooldown();
      toast.success(data?.reused ? 'Your earlier code is still valid' : 'Code resent');
    } catch (err: any) {
      fail(err.response?.data?.error || 'Could not resend — try again');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 4: first password, then into the app ──────────────
  const handleSetPassword = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsLoading(true);
    setStepError(null);
    try {
      if (password.length < 8) throw new Error('Password must be 8+ characters');
      if (password !== confirm) throw new Error("Passwords don't match");
      await setInitialPassword(password);
      clearWizardStorage();
      toast.success('Password set — welcome in!');
      goApp();
    } catch (err: any) {
      fail(err.response?.data?.error || err.message || 'Could not set password');
    } finally {
      setIsLoading(false);
      submittingRef.current = false;
    }
  };

  const domain = college?.emailDomain?.toLowerCase() || null;
  const emailOk = (() => {
    const v = formData.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return false;
    if (domain && !v.endsWith(`@${domain}`)) return false;
    return true;
  })();
  const usernameOk = localUsernameStatus(formData.username) === 'ok' && !blocksSubmit(usernameStatus);
  const identityOk =
    emailOk &&
    usernameOk &&
    formData.displayName.trim().length >= 2 &&
    !emailSuggestion;
  const activeStep = stepIndex(phase);
  const handle = usernameFeedback(usernameStatus, formData.username);

  return (
    <div>
      <h2 className="font-display font-bold text-2xl text-ink mb-1">
        <span className="inline-flex items-center gap-2">
          <Rocket size={22} strokeWidth={2.5} className="text-nb-violet" /> Create Account
        </span>
      </h2>
      <p className="font-body text-sm text-gray-500 mb-4">
        College, details, code, password — all right here
      </p>

      {/* Progress */}
      <div className="flex gap-1 mb-2" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={activeStep + 1} aria-label={`Step ${activeStep + 1} of 4`}>
        {[0, 1, 2, 3].map((s) => (
          <div
            key={s}
            aria-hidden="true"
            className={`h-1.5 flex-1 border-nb-2 border-ink ${s <= activeStep ? 'bg-nb-violet' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      {/* Back — every step has one, and it always erases (see signupFlow.ts) */}
      <div className="mb-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={isLoading}
          className="text-sm opacity-60 hover:opacity-100 inline-flex items-center gap-1 disabled:opacity-30"
        >
          <ArrowLeft size={14} />
          {phase === 'password' && 'Start over'}
          {phase === 'otp' && 'Wrong email or details? Edit them'}
          {phase === 'identity' && <>{college?.name || 'College'} <span className="opacity-60">— change?</span></>}
          {phase === 'college' && (college ? 'Clear this college' : 'Back to sign in')}
        </button>
      </div>

      {stepError && (
        <p role="alert" className="text-sm font-body text-nb-pink font-semibold mb-4">
          {stepError}
        </p>
      )}

      {/* ── 1. College ─────────────────────────────────────────── */}
      {phase === 'college' && (
        <div className="space-y-4 animate-slide-up">
          <div>
            <label htmlFor="signup-college" className="block font-display text-sm font-semibold mb-1.5">
              <span className="inline-flex items-center gap-1.5"><GraduationCap size={15} strokeWidth={2.5} className="text-nb-violet" /> Your college *</span>
            </label>
            <CollegeSelect
              value={college}
              onChange={(c) => { setCollege(c); setStepError(null); }}
              placeholder="Search e.g. IIT Delhi, VIT, SRM…"
            />
            <p className="text-xs text-gray-500 mt-1">Your college is your world here — everything you see stays inside it. Double-check the pick: it locks once your college email is verified.</p>
            {college && (
              domain ? (
                <p className="text-xs mt-2 flex items-center gap-1.5 font-semibold text-nb-violet">
                  <MailCheck size={14} /> You&apos;ll verify with your <span className="font-bold">@{domain}</span> email
                </p>
              ) : (
                <p role="alert" className="text-xs mt-2 font-semibold text-nb-pink">
                  {college.name} isn&apos;t onboarded for verification yet — pick another campus or contact support.
                </p>
              )
            )}
          </div>
          <button
            type="button"
            onClick={goIdentity}
            disabled={!college || !domain}
            aria-disabled={!college || !domain}
            title={!college ? 'Search and pick your college first' : !domain ? 'Campus not onboarded yet' : undefined}
            className="nb-btn-primary w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
          {!college && (
            <p className="text-xs font-body text-gray-500">Search above and pick your college — Next unlocks once selected.</p>
          )}
        </div>
      )}

      {/* ── 2. Identity — college email + name, or Google ──────── */}
      {phase === 'identity' && (
        <div className="space-y-4 animate-slide-up">
          <div>
            <label htmlFor="signup-email" className="block font-display text-sm font-semibold mb-1.5">College email *</label>
            <input
              id="signup-email"
              type="email"
              className="nb-input"
              placeholder={domain ? `you@${domain}` : 'you@college.edu'}
              value={formData.email}
              onChange={(e) => handleEmailChange(e.target.value)}
              required
              autoComplete="email"
            />
            {domain && (
              <p className="text-xs text-gray-500 mt-1">Must end in <span className="font-semibold">@{domain}</span> — we&apos;ll send a 6-digit code there.</p>
            )}
            {emailSuggestion && emailSuggestion !== formData.email && (
              <button
                type="button"
                onClick={() => { update('email', emailSuggestion); setEmailSuggestion(null); }}
                className="text-xs text-nb-violet mt-1.5 hover:underline"
              >
                Did you mean <span className="font-semibold">{emailSuggestion}</span>?
              </button>
            )}
          </div>

          <div>
            <label htmlFor="signup-displayname" className="block font-display text-sm font-semibold mb-1.5">Display Name *</label>
            <input
              id="signup-displayname"
              type="text"
              className="nb-input"
              placeholder="Your name"
              value={formData.displayName}
              onChange={(e) => update('displayName', e.target.value)}
              required
              autoComplete="name"
              maxLength={50}
            />
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <Lock size={11} /> Your name is fixed for the life of the account.
            </p>
          </div>

          <div>
            <label htmlFor="signup-username" className="block font-display text-sm font-semibold mb-1.5">Username *</label>
            <div className="relative">
              <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-display">@</span>
              <input
                id="signup-username"
                type="text"
                className="nb-input pl-8 pr-9"
                placeholder="coolstudent"
                value={formData.username}
                onChange={(e) => update('username', sanitizeUsernameInput(e.target.value))}
                required
                autoComplete="username"
                aria-invalid={blocksSubmit(usernameStatus) || undefined}
                aria-describedby="signup-username-status"
              />
              {usernameStatus === 'checking' && (
                <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" aria-hidden="true" />
              )}
              {usernameStatus === 'available' && (
                <Check size={15} strokeWidth={3} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600" aria-hidden="true" />
              )}
              {blocksSubmit(usernameStatus) && (
                <X size={15} strokeWidth={3} className="absolute right-3 top-1/2 -translate-y-1/2 text-nb-pink" aria-hidden="true" />
              )}
            </div>
            <p
              id="signup-username-status"
              role="status"
              aria-live="polite"
              className={`text-xs mt-1 ${
                handle?.tone === 'bad' ? 'text-nb-pink font-semibold'
                  : handle?.tone === 'ok' ? 'text-green-700 font-semibold'
                    : 'text-gray-500'
              }`}
            >
              {handle?.text ?? <>Your handle — also fixed for life. We check it as you type.</>}
            </p>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || !identityOk}
            aria-busy={isLoading}
            className="nb-btn-primary w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Creating...</>
            ) : (
              <><PartyPopper size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Send my code</>
            )}
          </button>

          {/* Google alternative: same college, instant verify on domain match */}
          <div className="flex items-center gap-2 my-1" aria-hidden="true">
            <div className="h-px flex-1 bg-gray-300" />
            <span className="text-xs font-body text-gray-500">or</span>
            <div className="h-px flex-1 bg-gray-300" />
          </div>
          <GoogleButton mode="signup" collegeId={college!.id} onSuccess={goApp} />
          <p className="text-xs font-body text-gray-500 text-center">
            Use your <span className="font-semibold">@{domain}</span> Google account and skip the code entirely.
          </p>
        </div>
      )}

      {/* ── 3. OTP — the email shown is the one being proven ───── */}
      {phase === 'otp' && (
        <div className="space-y-4 animate-slide-up text-center">
          <div className="mx-auto w-16 h-16 bg-nb-violet/15 flex items-center justify-center">
            <KeyRound size={32} className="text-nb-violet" />
          </div>
          <div>
            <h3 className="font-display text-xl font-bold">Check your inbox</h3>
            <p className="text-sm text-gray-500 mt-1">
              We sent a 6-digit code to
            </p>
            <p className="font-display font-semibold text-ink mt-0.5 inline-flex items-center gap-1.5">
              <Mail size={15} className="text-nb-violet" /> {formData.email}
            </p>
            <p className="text-xs text-gray-400 mt-1">It expires in 10 minutes.</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }}>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              aria-label="6-digit verification code"
              className="w-full text-center text-3xl font-bold tracking-[0.5em] py-3 border-2 border-nb-lilac/40 focus:border-nb-violet outline-none"
            />
            <button type="submit" disabled={isLoading || otp.trim().length !== 6} className="nb-btn-primary w-full mt-4 disabled:opacity-50">
              {isLoading ? 'Verifying…' : 'Verify my email'}
            </button>
          </form>
          <button onClick={handleResend} disabled={isLoading || cooldown > 0} className="nb-btn-ghost w-full text-sm disabled:opacity-50">
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
          <p className="text-xs text-gray-400 flex items-center justify-center gap-1.5">
            <Lock size={12} /> This email locks to your account forever once verified.
          </p>
        </div>
      )}

      {/* ── 4. First password — reachable only after verification ─ */}
      {phase === 'password' && (
        <div className="space-y-4 animate-slide-up text-center">
          <div className="mx-auto w-16 h-16 bg-nb-violet/15 flex items-center justify-center">
            <ShieldCheck size={32} className="text-nb-violet" />
          </div>
          <div>
            <h3 className="font-display text-xl font-bold">You&apos;re verified! 🎓</h3>
            <p className="text-sm text-gray-500 mt-1">Last step — pick a password for <span className="font-semibold">{formData.email}</span></p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleSetPassword(); }} className="text-left space-y-3">
            <div>
              <label htmlFor="signup-pass" className="block font-display text-sm font-semibold mb-1.5">Password *</label>
              <input
                id="signup-pass"
                type="password"
                className="nb-input"
                placeholder="8+ characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="signup-pass2" className="block font-display text-sm font-semibold mb-1.5">Confirm *</label>
              <input
                id="signup-pass2"
                type="password"
                className="nb-input"
                placeholder="Same password again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>
            <button type="submit" disabled={isLoading || password.length < 8 || password !== confirm} className="nb-btn-primary w-full text-center disabled:opacity-50">
              {isLoading ? <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Setting…</> : 'Finish signup →'}
            </button>
          </form>
          <button onClick={goApp} className="text-sm opacity-60 hover:opacity-100">
            Skip for now — set it later in Settings
          </button>
          <p className="text-xs text-gray-400">
            Skipping is fine — but a password is what lets you sign in from any device.
          </p>
        </div>
      )}

      <div className="mt-6 text-center">
        <p className="font-body text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-display font-semibold text-nb-violet hover:underline">
            Sign In →
          </Link>
        </p>
      </div>
    </div>
  );
}
