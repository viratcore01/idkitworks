import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Rocket, PartyPopper, Hourglass } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import CollegeSelect, { CollegeOption } from '@/components/common/CollegeSelect';
import GoogleButton from '@/components/common/GoogleButton';
import PasswordInput from '@/components/common/PasswordInput';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api from '@/services/api';
import toast from 'react-hot-toast';

type Step = 1 | 2 | 3 | 4;

export default function SignupPage() {
 const [step, setStep] = useState<Step>(1);
 const [formData, setFormData] = useState({
 email: '',
 password: '',
 confirmPassword: '',
 username: '',
 displayName: '',
 collegeId: '',
 course: '',
 year: 1,
 bio: '',
 interestIds: [] as string[],
 });
  const [college, setCollege] = useState<CollegeOption | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
 const submittingRef = useRef(false); // ref guard: double-taps beat React re-render
 const signup = useAuthStore((s) => s.signup);
 const navigate = useNavigate();

 // Interests are loaded at the last step, AFTER the account exists —
 // calling them pre-auth here would 401 and bounce the user to /login.
 const { data: interests } = useQuery({
 queryKey: ['interests', step === 4],
 enabled: step === 4,
 queryFn: () => api.get('/users/interests').then((r) => r.data),
 });

 const update = (field: string, value: any) => setFormData((d) => ({ ...d, [field]: value }));

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

  const handleFinalSubmit = async () => {
  if (submittingRef.current) return; // double-tap guard
  submittingRef.current = true;
  setIsLoading(true);
  setStepError(null);
  try {
  await signup(formData);
  toast.success('Welcome to Zoclo!');
  // Onboarding: signup → verify college email → feed (App gate handles routing)
  navigate('/verify');
  } catch (err: any) {
  fail(err.response?.data?.error || 'Signup failed');
  } finally {
  setIsLoading(false);
  submittingRef.current = false;
  }
  };

 const toggleInterest = (id: string) => {
 update(
 'interestIds',
 formData.interestIds.includes(id)
 ? formData.interestIds.filter((i) => i !== id)
 : [...formData.interestIds, id]
 );
 };

 return (
 <div>
 <h2 className="font-display font-bold text-2xl text-ink mb-1">
 <span className="inline-flex items-center gap-2">
 <Rocket size={22} strokeWidth={2.5} className="text-nb-violet" /> Create Account
 </span>
 </h2>
 <p className="font-body text-sm text-gray-500 mb-4">
 Step {step} of 4
 </p>

  {/* Progress bar */}
  <div className="flex gap-1 mb-2" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label={`Step ${step} of 4`}>
  {[1, 2, 3, 4].map((s) => (
  <div
  key={s}
  aria-hidden="true"
  className={`h-1.5 flex-1 border-nb-2 border-ink ${
  s <= step ? 'bg-nb-violet' : 'bg-gray-200'
  }`}
  />
  ))}
  </div>
  {stepError && (
  <p role="alert" className="text-sm font-body text-nb-pink font-semibold mb-4">
  {stepError}
  </p>
  )}

  {/* Step 1: Email & Password */}
  {step === 1 && (
  <form className="space-y-4 animate-slide-up" noValidate={false} onSubmit={(e) => {
  e.preventDefault();
  setStepError(null);
  if (!formData.email || !formData.password) return fail('Fill all fields');
  if (formData.password !== formData.confirmPassword) return fail("Passwords don't match");
  if (formData.password.length < 8) return fail('Password must be 8+ chars');
  if (emailSuggestion) return fail('Pick the suggested email or fix the typo first');
  setStep(2);
  }}>
  <div>
  <label htmlFor="signup-email" className="block font-display text-sm font-semibold mb-1.5">Email</label>
  <input
  id="signup-email"
  type="email"
  className="nb-input"
  placeholder="your@email.com"
  value={formData.email}
  onChange={(e) => handleEmailChange(e.target.value)}
  required
  autoComplete="email"
  />
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
  <label htmlFor="signup-password" className="block font-display text-sm font-semibold mb-1.5">Password</label>
  <PasswordInput id="signup-password" value={formData.password} onChange={(v) => update('password', v)} placeholder="Min 8 characters" autoComplete="new-password" required minLength={8} />
  </div>
  <div>
  <label htmlFor="signup-confirm" className="block font-display text-sm font-semibold mb-1.5">Confirm Password</label>
  <PasswordInput id="signup-confirm" value={formData.confirmPassword} onChange={(v) => update('confirmPassword', v)} placeholder="Repeat password" autoComplete="new-password" required minLength={8} />
  </div>
  <button
  type="submit"
  className="nb-btn-primary w-full text-center"
  >
  Next →
  </button>
  </form>
  )}

  {/* Step 2: Name & Username */}
  {step === 2 && (
  <form className="space-y-4 animate-slide-up" onSubmit={(e) => {
  e.preventDefault();
  setStepError(null);
  if (!formData.displayName || !formData.username) return fail('Fill all fields');
  setStep(3);
  }}>
  <div>
  <label htmlFor="signup-displayname" className="block font-display text-sm font-semibold mb-1.5">Display Name</label>
  <input
  id="signup-displayname"
  type="text"
  className="nb-input"
  placeholder="Your name"
  value={formData.displayName}
  onChange={(e) => update('displayName', e.target.value)}
  required
  autoComplete="name"
  />
  </div>
  <div>
  <label htmlFor="signup-username" className="block font-display text-sm font-semibold mb-1.5">Username</label>
  <div className="relative">
  <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-display">@</span>
  <input
  id="signup-username"
  type="text"
  className="nb-input pl-8"
  placeholder="coolstudent"
  value={formData.username}
  onChange={(e) => update('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
  required
  autoComplete="username"
  />
  </div>
  </div>
  <div className="flex gap-2">
  <button type="button" onClick={() => setStep(1)} className="nb-btn-ghost flex-1 text-center">
  ← Back
  </button>
  <button
  type="submit"
  className="nb-btn-primary flex-1 text-center"
  >
  Next →
  </button>
  </div>
  </form>
  )}

  {/* Step 3: College, Course, Year */}
  {step === 3 && (
  <div className="space-y-4 animate-slide-up">
  <div>
  <label htmlFor="signup-college" className="block font-display text-sm font-semibold mb-1.5">College *</label>
  <CollegeSelect
  value={college}
  onChange={(c) => {
  setCollege(c);
  update('collegeId', c?.id || '');
  }}
  placeholder="Search e.g. IIT Delhi, VIT, SRM…"
  />
  <p className="text-xs text-gray-500 mt-1">Your college is your world here — everything you see stays inside it.</p>
  </div>
  <div>
  <label htmlFor="signup-course" className="block font-display text-sm font-semibold mb-1.5">Course / Branch</label>
  <input
  id="signup-course"
  type="text"
  className="nb-input"
  placeholder="e.g. CSE, ECE, MBA"
  value={formData.course}
  onChange={(e) => update('course', e.target.value)}
  />
  </div>
  <fieldset>
  <legend className="block font-display text-sm font-semibold mb-1.5">Year</legend>
  <div className="flex gap-2" role="radiogroup" aria-label="Year">
  {[1, 2, 3, 4].map((y) => (
  <button
  key={y}
  type="button"
  role="radio"
  aria-checked={formData.year === y}
  onClick={() => update('year', y)}
  className={`nb-btn flex-1 text-center text-sm ${
  formData.year === y ? 'bg-nb-violet text-white' : ''
  }`}
  >
  {y === 1 ? '1st' : y === 2 ? '2nd' : y === 3 ? '3rd' : '4th'}
  </button>
  ))}
  </div>
  </fieldset>
  <div className="flex gap-2">
  <button type="button" onClick={() => setStep(2)} className="nb-btn-ghost flex-1 text-center">
  ← Back
  </button>
  <button
  type="button"
  onClick={() => {
  setStepError(null);
  if (!formData.collegeId) return fail('Pick your college to continue');
  setStep(4);
  }}
  disabled={!formData.collegeId}
  aria-disabled={!formData.collegeId}
  title={!formData.collegeId ? 'Search and pick your college first' : undefined}
  className="nb-btn-primary flex-1 text-center disabled:opacity-50 disabled:cursor-not-allowed"
  >
  Next →
  </button>
  </div>
  {!formData.collegeId && (
  <p className="text-xs font-body text-gray-500">Search above and pick your college — Next unlocks once selected.</p>
  )}
  </div>
  )}

  {/* Step 4: Bio & Interests */}
  {step === 4 && (
  <div className="space-y-4 animate-slide-up">
  <div>
  <label htmlFor="signup-bio" className="block font-display text-sm font-semibold mb-1.5">Bio</label>
  <textarea
  id="signup-bio"
  className="nb-input min-h-[80px] resize-none"
  placeholder="Tell people about yourself..."
  value={formData.bio}
  onChange={(e) => update('bio', e.target.value)}
  />
  </div>
  <fieldset>
  <legend className="block font-display text-sm font-semibold mb-2">
  Interests <span className="font-normal text-gray-400">(pick a few!)</span>
  </legend>
  {!interests ? (
  <LoadingSpinner size="sm" />
  ) : interests.length === 0 ? (
  <p className="text-sm font-body text-gray-500">No interests to show right now — you can add them later from your profile.</p>
  ) : (
  <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
  {interests?.map((i: any) => (
  <button
  key={i.id}
  type="button"
  aria-pressed={formData.interestIds.includes(i.id)}
  onClick={() => toggleInterest(i.id)}
  className={`nb-tag cursor-pointer transition-all ${
  formData.interestIds.includes(i.id)
  ? 'bg-nb-violet text-white'
  : 'bg-white hover:bg-gray-50'
  }`}
  >
  {i.name}
  </button>
  ))}
  </div>
  )}
  </fieldset>
  <div className="flex gap-2">
  <button type="button" onClick={() => setStep(3)} className="nb-btn-ghost flex-1 text-center">
  ← Back
  </button>
  <button
  type="button"
  onClick={handleFinalSubmit}
  disabled={isLoading}
  aria-busy={isLoading}
  className="nb-btn-primary flex-1 text-center disabled:opacity-50 disabled:cursor-not-allowed"
  >
  {isLoading ? (
  <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Creating...</>
  ) : (
  <><PartyPopper size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Join Zoclo</>
  )}
  </button>
  </div>
  </div>
  )}

 {/* Google option shows on step 1 only — it replaces the whole wizard for
 Google users (they pick college next via profile setup, same as the
 password funnel lands them, so nothing about the gates changes). */}
 {step === 1 && (
 <div className="mt-5">
 <GoogleButton mode="signup" />
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
