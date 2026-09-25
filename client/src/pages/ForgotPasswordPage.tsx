import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Mail, Hourglass, ArrowLeft, ShieldCheck, AlertTriangle, Lock } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import PasswordInput from '@/components/common/PasswordInput';
import toast from 'react-hot-toast';

/**
 * Forgotten password — two steps on one page:
 *   1. Request  — email or username → the server mails a 6-digit code.
 *   2. Reset    — enter the code and pick a new password.
 *
 * The wording in step 1 is deliberately hedged ("if an account exists"): the
 * server answers identically for unknown accounts, and this screen must not
 * undo that by claiming a code was definitely sent.
 *
 * A reset signs you out everywhere (the server revokes every session), so the
 * page ends by sending the user to the login screen.
 */

const RESEND_COOLDOWN_SEC = 60;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const [phase, setPhase] = useState<'request' | 'reset' | 'done'>('request');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); }, []);

  const startCooldown = () => {
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

  const fail = (msg: string) => {
    setError(msg);
    toast.error(msg);
  };

  const sendCode = async () => {
    if (submittingRef.current || !identifier.trim()) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(identifier.trim());
      setPhase('reset');
      setCode('');
      startCooldown();
      toast.success('If that account exists, a reset code is on its way.');
    } catch (e: any) {
      fail(e.response?.data?.error || 'Could not send the code — try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setError(null);
    try {
      await requestPasswordReset(identifier.trim());
      startCooldown();
      toast.success('Code re-sent');
    } catch (e: any) {
      fail(e.response?.data?.error || 'Could not re-send the code');
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (password.length < 8) return fail('Password must be 8+ characters');
    if (password !== confirm) return fail("Passwords don't match");
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(identifier.trim(), code.trim(), password);
      setPhase('done');
      toast.success('Password updated');
    } catch (err: any) {
      fail(err.response?.data?.error || 'That code is invalid or has expired');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const backToSignIn = (
    <div className="mt-6 text-center">
      <Link to="/login" className="font-display font-semibold text-nb-violet hover:underline">
        ← Back to sign in
      </Link>
    </div>
  );

  // ── Step 1: ask for the code ──────────────────────────────
  if (phase === 'request') {
    return (
      <div>
        <h2 className="font-display font-bold text-2xl text-ink mb-1">
          <span className="inline-flex items-center gap-2">
            <KeyRound size={22} strokeWidth={2.5} className="text-nb-violet" /> Forgot password?
          </span>
        </h2>
        <p className="font-body text-sm text-gray-500 mb-6">
          Tell us your email or username and we&apos;ll send a 6-digit code to the address on your account.
        </p>

        <form onSubmit={(e) => { e.preventDefault(); sendCode(); }} className="space-y-4">
          <div>
            <label htmlFor="forgot-identifier" className="block font-display text-sm font-semibold mb-1.5">
              Email or username
            </label>
            <input
              id="forgot-identifier"
              type="text"
              className="nb-input"
              placeholder="your@email.com or username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              autoFocus
            />
          </div>

          {error && (
            <p role="alert" className="text-sm font-body text-nb-pink font-semibold flex items-center gap-1">
              <AlertTriangle size={14} /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !identifier.trim()}
            aria-busy={busy}
            className="nb-btn-primary w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? (
              <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Sending...</>
            ) : (
              <><Mail size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Send reset code</>
            )}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-3 flex items-start gap-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" />
          For your privacy we answer the same way whether or not that account exists — so you may not hear back if it
          doesn&apos;t. Signed in with Google and never set a password? Use the Google button on the sign-in page instead.
        </p>

        {backToSignIn}
      </div>
    );
  }

  // ── Step 3: done ─────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-nb-violet/15 flex items-center justify-center">
          <ShieldCheck size={32} className="text-nb-violet" />
        </div>
        <h2 className="font-display font-bold text-2xl text-ink mt-4">Password updated</h2>
        <p className="font-body text-sm text-gray-500 mt-2">
          For safety we signed you out everywhere. Sign in again with your new password.
        </p>
        <button onClick={() => navigate('/login', { replace: true })} className="nb-btn-primary w-full mt-6">
          Go to sign in
        </button>
      </div>
    );
  }

  // ── Step 2: code + new password ───────────────────────────
  return (
    <div>
      <h2 className="font-display font-bold text-2xl text-ink mb-1">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck size={22} strokeWidth={2.5} className="text-nb-violet" /> Set a new password
        </span>
      </h2>
      <p className="font-body text-sm text-gray-500 mb-6">
        Enter the 6-digit code we sent to <span className="font-semibold">{identifier}</span> (it expires in 10 minutes).
      </p>

      <form onSubmit={submitReset} className="space-y-4">
        <div>
          <label htmlFor="forgot-code" className="block font-display text-sm font-semibold mb-1.5">
            6-digit code
          </label>
          <input
            id="forgot-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            aria-label="6-digit reset code"
            className="nb-input text-center text-2xl font-bold tracking-[0.4em]"
            required
          />
        </div>

        <div>
          <label htmlFor="forgot-password" className="block font-display text-sm font-semibold mb-1.5">
            New password
          </label>
          <PasswordInput
            id="forgot-password"
            value={password}
            onChange={setPassword}
            placeholder="Min 8 characters"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>

        <div>
          <label htmlFor="forgot-confirm" className="block font-display text-sm font-semibold mb-1.5">
            Confirm new password
          </label>
          <PasswordInput
            id="forgot-confirm"
            value={confirm}
            onChange={setConfirm}
            placeholder="Same password again"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm font-body text-nb-pink font-semibold flex items-center gap-1">
            <AlertTriangle size={14} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || code.trim().length !== 6 || password.length < 8 || password !== confirm}
          aria-busy={busy}
          className="nb-btn-primary w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? (
            <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Updating...</>
          ) : (
            'Set new password'
          )}
        </button>
      </form>

      <button onClick={resend} disabled={busy || cooldown > 0} className="nb-btn-ghost w-full mt-3 text-sm disabled:opacity-50">
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </button>

      <button
        onClick={() => { setPhase('request'); setError(null); }}
        className="text-sm opacity-60 hover:opacity-100 mt-3 w-full"
      >
        <ArrowLeft size={13} className="inline mr-1" /> Use a different email or username
      </button>

      {backToSignIn}
    </div>
  );
}
