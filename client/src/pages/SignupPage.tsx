import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Rocket, PartyPopper, Hourglass, GraduationCap, MailCheck } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import CollegeSelect, { CollegeOption } from '@/components/common/CollegeSelect';
import GoogleButton from '@/components/common/GoogleButton';
import { nextStep } from '@/utils/funnel';
import toast from 'react-hot-toast';

type Step = 1 | 2;

/**
 * Signup funnel, college-first:
 *   1. College — anchors everything (domain shown, e.g. @ipec.org.in).
 *   2. Identity — college-email + username + name, OR Continue with Google
 *      (auto-verifies when the Google email matches the college domain).
 *
 * The account is created WITHOUT a password. Next: /verify (OTP) — Google
 * users with a matching domain skip straight past it — then /setup-password,
 * then /setup-profile (prefilled from Google when available).
 */
export default function SignupPage() {
 const [step, setStep] = useState<Step>(1);
 const [formData, setFormData] = useState({
 email: '',
 username: '',
 displayName: '',
 });
 const [college, setCollege] = useState<CollegeOption | null>(null);
 const [isLoading, setIsLoading] = useState(false);
 const [stepError, setStepError] = useState<string | null>(null);
 const submittingRef = useRef(false); // ref guard: double-taps beat React re-render
 const signup = useAuthStore((s) => s.signup);
 const navigate = useNavigate();

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

 const goNext = () => {
 const user = useAuthStore.getState().user;
 navigate(nextStep(user), { replace: true });
 };

 const handleSubmit = async () => {
 if (submittingRef.current) return; // double-tap guard
 submittingRef.current = true;
 setIsLoading(true);
 setStepError(null);
 try {
 await signup({
 collegeId: college!.id,
 email: formData.email.trim().toLowerCase(),
 username: formData.username.trim().toLowerCase(),
 displayName: formData.displayName.trim(),
 });
 toast.success('Check your inbox for the code!');
 navigate('/verify');
 } catch (err: any) {
 fail(err.response?.data?.error || 'Signup failed');
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
 const identityOk =
 emailOk &&
 /^[a-z0-9_]{3,20}$/.test(formData.username.trim().toLowerCase()) &&
 formData.displayName.trim().length >= 2 &&
 !emailSuggestion;

 return (
 <div>
 <h2 className="font-display font-bold text-2xl text-ink mb-1">
 <span className="inline-flex items-center gap-2">
 <Rocket size={22} strokeWidth={2.5} className="text-nb-violet" /> Create Account
 </span>
 </h2>
 <p className="font-body text-sm text-gray-500 mb-4">
 Step {step} of 2 — college first, then who you are
 </p>

 {/* Progress bar */}
 <div className="flex gap-1 mb-2" role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step} aria-label={`Step ${step} of 2`}>
 {[1, 2].map((s) => (
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

 {/* Step 1: College */}
 {step === 1 && (
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
 <p className="text-xs text-gray-500 mt-1">Your college is your world here — everything you see stays inside it.</p>
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
 onClick={() => {
 setStepError(null);
 if (!college) return fail('Pick your college to continue');
 if (!domain) return fail('This campus is not onboarded for verification yet');
 setStep(2);
 }}
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

 {/* Step 2: Identity — college email + name, or Google */}
 {step === 2 && (
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
 </div>
 <div>
 <label htmlFor="signup-username" className="block font-display text-sm font-semibold mb-1.5">Username *</label>
 <div className="relative">
 <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-display">@</span>
 <input
 id="signup-username"
 type="text"
 className="nb-input pl-8"
 placeholder="coolstudent"
 value={formData.username}
 onChange={(e) => update('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
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
 type="button"
 onClick={handleSubmit}
 disabled={isLoading || !identityOk}
 aria-busy={isLoading}
 className="nb-btn-primary flex-1 text-center disabled:opacity-50 disabled:cursor-not-allowed"
 >
 {isLoading ? (
 <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Creating...</>
 ) : (
 <><PartyPopper size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Send my code</>
 )}
 </button>
 </div>

 {/* Google alternative: same college, instant verify on domain match */}
 <div className="flex items-center gap-2 my-1" aria-hidden="true">
 <div className="h-px flex-1 bg-gray-300" />
 <span className="text-xs font-body text-gray-500">or</span>
 <div className="h-px flex-1 bg-gray-300" />
 </div>
 <GoogleButton mode="signup" collegeId={college!.id} onSuccess={() => goNext()} />
 <p className="text-xs font-body text-gray-500 text-center">
 Use your <span className="font-semibold">@{domain}</span> Google account and skip the code entirely.
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
