import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Rocket, PartyPopper, Hourglass } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import CollegeSelect, { CollegeOption } from '@/components/common/CollegeSelect';
import PasswordInput from '@/components/common/PasswordInput';
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

  const handleFinalSubmit = async () => {
    if (submittingRef.current) return; // double-tap guard
    submittingRef.current = true;
    setIsLoading(true);
    try {
      await signup(formData);
      toast.success('Welcome to Skola!');
      // Onboarding: signup → verify student ID → feed (App gate handles routing)
      navigate('/verify');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Signup failed');
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
      <h2 className="font-display font-bold text-2xl text-nb-black mb-1">
        <span className="inline-flex items-center gap-2">
          <Rocket size={22} strokeWidth={2.5} className="text-nb-orange" /> Create Account
        </span>
      </h2>
      <p className="font-body text-sm text-gray-500 mb-4">
        Step {step} of 4
      </p>

      {/* Progress bar */}
      <div className="flex gap-1 mb-6">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full border border-nb-black ${
              s <= step ? 'bg-nb-orange' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Step 1: Email & Password */}
      {step === 1 && (
        <div className="space-y-4 animate-slide-up">
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Email</label>
            <input
              type="email"
              className="nb-input"
              placeholder="your@email.com"
              value={formData.email}
              onChange={(e) => handleEmailChange(e.target.value)}
            />
            {emailSuggestion && emailSuggestion !== formData.email && (
              <button
                type="button"
                onClick={() => { update('email', emailSuggestion); setEmailSuggestion(null); }}
                className="text-xs text-nb-orange mt-1.5 hover:underline"
              >
                Did you mean <span className="font-semibold">{emailSuggestion}</span>?
              </button>
            )}
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Password</label>
            <PasswordInput value={formData.password} onChange={(v) => update('password', v)} placeholder="Min 8 characters" autoComplete="new-password" />
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Confirm Password</label>
            <PasswordInput value={formData.confirmPassword} onChange={(v) => update('confirmPassword', v)} placeholder="Repeat password" autoComplete="new-password" />
          </div>
          <button
            onClick={() => {
              if (!formData.email || !formData.password) return toast.error('Fill all fields');
              if (formData.password !== formData.confirmPassword) return toast.error("Passwords don't match");
              if (formData.password.length < 8) return toast.error('Password must be 8+ chars');
              if (emailSuggestion) return toast.error('Pick the suggested email or fix the typo first');
              setStep(2);
            }}
            className="nb-btn-orange w-full text-center"
          >
            Next →
          </button>
        </div>
      )}

      {/* Step 2: Name & Username */}
      {step === 2 && (
        <div className="space-y-4 animate-slide-up">
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Display Name</label>
            <input
              type="text"
              className="nb-input"
              placeholder="Your name"
              value={formData.displayName}
              onChange={(e) => update('displayName', e.target.value)}
            />
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Username</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-display">@</span>
              <input
                type="text"
                className="nb-input pl-8"
                placeholder="coolstudent"
                value={formData.username}
                onChange={(e) => update('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="nb-btn-ghost flex-1 text-center">
              ← Back
            </button>
            <button
              onClick={() => {
                if (!formData.displayName || !formData.username) return toast.error('Fill all fields');
                setStep(3);
              }}
              className="nb-btn-orange flex-1 text-center"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: College, Course, Year */}
      {step === 3 && (
        <div className="space-y-4 animate-slide-up">
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">College *</label>
            <CollegeSelect
              value={college}
              onChange={(c) => {
                setCollege(c);
                update('collegeId', c?.id || '');
              }}
              placeholder="Search e.g. IIT Delhi, VIT, SRM…"
            />
            <p className="text-[11px] text-gray-500 mt-1">Your college is your world here — everything you see stays inside it.</p>
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Course / Branch</label>
            <input
              type="text"
              className="nb-input"
              placeholder="e.g. CSE, ECE, MBA"
              value={formData.course}
              onChange={(e) => update('course', e.target.value)}
            />
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Year</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((y) => (
                <button
                  key={y}
                  onClick={() => update('year', y)}
                  className={`nb-btn flex-1 text-center text-sm ${
                    formData.year === y ? 'bg-nb-orange text-white' : ''
                  }`}
                >
                  {y === 1 ? '1st' : y === 2 ? '2nd' : y === 3 ? '3rd' : '4th'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="nb-btn-ghost flex-1 text-center">
              ← Back
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={!formData.collegeId}
              className="nb-btn-orange flex-1 text-center disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Bio & Interests */}
      {step === 4 && (
        <div className="space-y-4 animate-slide-up">
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Bio</label>
            <textarea
              className="nb-input min-h-[80px] resize-none"
              placeholder="Tell people about yourself..."
              value={formData.bio}
              onChange={(e) => update('bio', e.target.value)}
            />
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-2">
              Interests <span className="font-normal text-gray-400">(pick a few!)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {interests?.map((i: any) => (
                <button
                  key={i.id}
                  onClick={() => toggleInterest(i.id)}
                  className={`nb-tag cursor-pointer transition-all ${
                    formData.interestIds.includes(i.id)
                      ? 'bg-nb-orange text-white'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {i.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="nb-btn-ghost flex-1 text-center">
              ← Back
            </button>
            <button
              onClick={handleFinalSubmit}
              disabled={isLoading}
              className="nb-btn-cyan flex-1 text-center disabled:opacity-50"
            >
              {isLoading ? (
                <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Creating...</>
              ) : (
                <><PartyPopper size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Join Skola</>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 text-center">
        <p className="font-body text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-display font-semibold text-nb-orange hover:underline">
            Sign In →
          </Link>
        </p>
      </div>
    </div>
  );
}
