import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, PartyPopper, Hourglass } from 'lucide-react';
import Logo from '@/components/common/Logo';
import PasswordInput from '@/components/common/PasswordInput';
import { useAuthStore } from '@/store/auth.store';
import { nextStep } from '@/utils/funnel';
import toast from 'react-hot-toast';

/**
 * Funnel step: first password, AFTER college-email verification.
 * The server allows this exactly once (verified + no password yet) and keeps
 * the session — the owner sails straight into profile setup.
 * Google users may skip: they can always sign in with Google.
 */
export default function SetupPasswordPage() {
 const navigate = useNavigate();
 const user = useAuthStore((s) => s.user);
 const setInitialPassword = useAuthStore((s) => s.setInitialPassword);
 const [password, setPassword] = useState('');
 const [confirm, setConfirm] = useState('');
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');

 // Already has one (e.g. set in another tab) → move on.
 if (user && user.hasPassword !== false) {
 const dest = nextStep(user);
 if (dest !== '/setup-password') navigate(dest, { replace: true });
 }
 // Unverified users can't be here — the server would 403 anyway.
 if (user && user.verificationStatus !== 'VERIFIED' && !user.collegeEmailVerified) {
 navigate('/verify', { replace: true });
 }

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
 const msg = err.response?.data?.error || 'Could not set password';
 setError(msg); toast.error(msg);
 } finally {
 setBusy(false);
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
 {user?.hasGoogle && (
 <p className="text-sm mt-4">
 <Link to="/setup-profile" className="opacity-60 hover:opacity-100 hover:underline">
 Skip for now — I&apos;ll keep signing in with Google
 </Link>
 </p>
 )}
 </div>
 </div>
 );
}
