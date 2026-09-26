import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, PartyPopper, Hourglass } from 'lucide-react';
import Logo from '@/components/common/Logo';
import PasswordInput from '@/components/common/PasswordInput';
import { useAuthStore } from '@/store/auth.store';
import { nextStep, isFunnelVerified } from '@/utils/funnel';
import toast from 'react-hot-toast';

/**
 * Funnel step: first password, AFTER college-email verification.
 * The server allows this exactly once (verified + no password yet) and keeps
 * the session — the owner sails straight into profile setup.
 * COMPULSORY for everyone, Google sign-in included — no skipping.
 */
export default function SetupPasswordPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setInitialPassword = useAuthStore((s) => s.setInitialPassword);
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  // Redirects belong in an effect, not the render body: calling navigate()
  // during render is a React anti-pattern that warns, re-renders, and can loop.
  // A stray remount used to be able to bounce the user between screens forever.
  const hasNothingToDoHere = !!user && user.hasPassword === true;
  // Same single source as the funnel router, the guards, and the server gate.
  const isUnverified = !!user && !isFunnelVerified(user);

 useEffect(() => {
   if (!user) return;
   if (isUnverified) {
     // The wizard owns the OTP step now (no standalone verify page).
     navigate('/signup', { replace: true });
     return;
   }
   if (hasNothingToDoHere) {
     const dest = nextStep(user);
     if (dest !== '/setup-password') navigate(dest, { replace: true });
   }
 }, [user, isUnverified, hasNothingToDoHere, navigate]);

 // Render nothing while the redirect is in flight — avoids a flash of the
 // password form for someone who already has one (or isn't verified yet).
 if (isUnverified || hasNothingToDoHere) return null;

 const submit = async (e: React.FormEvent) => {
 e.preventDefault();
 setError('');
 if (password.length < 8) {
 const msg = 'Password must be 8+ characters';
 setError(msg); toast.error(msg); return;
 }
 if (password !== confirm) {
 const msg = "Passwords don't match";
 setError(msg); toast.error(msg); return;
 }
 setBusy(true);
 try {
 await setInitialPassword(password);
 toast.success('Password set!');
 navigate(nextStep(useAuthStore.getState().user), { replace: true });
  } catch (err: any) {
  const code = err.response?.data?.code;
  const msg = err.response?.data?.error || 'Could not set password';
  // The server is the truth about verification: if it says the inbox still
  // needs proof, send the user to the OTP step (a way FORWARD) instead of
  // dead-ending on this screen with an error and no exit.
  if (err.response?.status === 403 && code === 'VERIFICATION_REQUIRED') {
  toast.error(msg);
  navigate('/signup', { replace: true });
  return;
  }
  setError(msg); toast.error(msg);
  } finally {
  setBusy(false);
  }
  };

  /** Escape hatch: no funnel screen may ever be a cage. A wrong/stale session
   *  (or an account someone else started) can always sign out to login. */
  const signOut = async () => {
  if (signingOut) return;
  setSigningOut(true);
  try {
  await logout();
  } finally {
  navigate('/login', { replace: true });
  }
  };

 return (
 <div className="min-h-screen flex flex-col items-center justify-center p-4 nb-canvas-surface">
 <div className="mb-8"><Logo size={40} /></div>
 <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
 <div className="mx-auto w-20 h-20 bg-nb-violet/15 flex items-center justify-center">
 <KeyRound size={40} className="text-nb-violet" />
 </div>
 <h1 className="font-display text-2xl font-bold mt-5">Lock your account</h1>
 <p className="text-sm opacity-70 mt-2">
 Email verified — now set a password so you can sign in anywhere.
 </p>
 <form onSubmit={submit} className="mt-6 space-y-4 text-left">
 <div>
 <label htmlFor="setup-password" className="block font-display text-sm font-semibold mb-1.5">Password</label>
 <PasswordInput id="setup-password" value={password} onChange={setPassword} placeholder="Min 8 characters" autoComplete="new-password" required minLength={8} />
 </div>
 <div>
 <label htmlFor="setup-confirm" className="block font-display text-sm font-semibold mb-1.5">Confirm password</label>
 <PasswordInput id="setup-confirm" value={confirm} onChange={setConfirm} placeholder="Repeat password" autoComplete="new-password" required minLength={8} />
 </div>
 {error && <p role="alert" className="text-sm text-nb-pink font-semibold text-center">{error}</p>}
  <button type="submit" disabled={busy || password.length < 8 || confirm.length < 8} className="nb-btn-primary w-full text-center disabled:opacity-50">
  {busy ? (
  <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Setting...</>
  ) : (
  <><PartyPopper size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Set password & continue</>
  )}
  </button>
  </form>
  <button
  type="button"
  onClick={signOut}
  disabled={signingOut || busy}
  className="mt-4 text-sm font-body text-gray-500 hover:text-ink underline underline-offset-2 disabled:opacity-50"
  >
  {signingOut ? 'Signing out…' : 'Wrong account? Sign out'}
  </button>
  </div>
  </div>
  );
}
