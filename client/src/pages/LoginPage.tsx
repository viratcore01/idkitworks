import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, Hourglass } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import PasswordInput from '@/components/common/PasswordInput';
import GoogleButton from '@/components/common/GoogleButton';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const submittingRef = useRef(false); // ref guard: double-taps beat React re-render
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  // Cold-server honesty on the button itself: after 8s of signing in, say
  // the server may be waking up instead of looking frozen.
  useEffect(() => {
  if (!isLoading) { setSlow(false); return; }
  const t = setTimeout(() => setSlow(true), 8000);
  return () => clearTimeout(t);
  }, [isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (submittingRef.current) return;
  submittingRef.current = true;
  setIsLoading(true);
  setFormError(null);
  try {
  await login(identifier, password);
  toast.success('Welcome back!');
  navigate('/home');
  } catch (err: any) {
  const msg = err.response?.data?.error || 'Login failed';
  setFormError(msg);
  toast.error(msg);
  } finally {
  setIsLoading(false);
  submittingRef.current = false;
  }
  };

 return (
 <div>
 <h2 className="font-display font-bold text-2xl text-ink mb-1">
 Welcome back
 </h2>
 <p className="font-body text-sm text-gray-500 mb-6">
 Sign in to see what's happening at your college
 </p>

  <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
  <div>
  <label htmlFor="login-identifier" className="block font-display text-sm font-semibold mb-1.5">Email or username</label>
  <input
  id="login-identifier"
  type="text"
  className="nb-input"
  placeholder="your@email.com or username"
  value={identifier}
  onChange={(e) => setIdentifier(e.target.value)}
  required
  autoComplete="username"
  aria-invalid={formError ? true : undefined}
  aria-describedby={formError ? 'login-error' : undefined}
  />
  </div>

  <div>
  <label htmlFor="login-password" className="block font-display text-sm font-semibold mb-1.5">Password</label>
  <PasswordInput id="login-password" value={password} onChange={setPassword} required autoComplete="current-password" />
  </div>

  {formError && (
  <p id="login-error" role="alert" className="text-sm font-body text-nb-pink font-semibold">
  {formError}
  </p>
  )}

  <button
  type="submit"
  disabled={isLoading}
  aria-busy={isLoading}
  className="nb-btn-primary w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
  >
  {isLoading ? (
  <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Signing in...</>
  ) : (
  <><LogIn size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Sign In</>
  )}
  </button>
  {isLoading && slow && (
  <p className="font-body text-xs text-gray-500 text-center">
  Still working — the server sleeps when idle and takes ~30s to wake the first time today.
  </p>
  )}
  </form>

 <div className="mt-5">
 <GoogleButton mode="login" />
 </div>

 <div className="mt-6 text-center">
 <p className="font-body text-sm text-gray-500">
 Don't have an account?{' '}
 <Link to="/signup" className="font-display font-semibold text-nb-violet hover:underline">
 Sign Up →
 </Link>
 </p>
 </div>
 </div>
 );
}
