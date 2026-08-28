import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
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
  const [isLoading, setIsLoading] = useState(false);
  const signup = useAuthStore((s) => s.signup);
  const navigate = useNavigate();

  const { data: colleges } = useQuery({
    queryKey: ['colleges'],
    queryFn: () => api.get('/users/colleges').then((r) => r.data),
  });

  const { data: interests } = useQuery({
    queryKey: ['interests'],
    queryFn: () => api.get('/users/interests').then((r) => r.data),
  });

  const update = (field: string, value: any) => setFormData((d) => ({ ...d, [field]: value }));

  const handleFinalSubmit = async () => {
    setIsLoading(true);
    try {
      await signup(formData);
      toast.success('Welcome to Freebuff! 🎉');
      navigate('/home');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Signup failed');
    } finally {
      setIsLoading(false);
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
        Create Account 🚀
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
              placeholder="you@college.edu"
              value={formData.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Password</label>
            <input
              type="password"
              className="nb-input"
              placeholder="Min 8 characters"
              value={formData.password}
              onChange={(e) => update('password', e.target.value)}
            />
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Confirm Password</label>
            <input
              type="password"
              className="nb-input"
              placeholder="Repeat password"
              value={formData.confirmPassword}
              onChange={(e) => update('confirmPassword', e.target.value)}
            />
          </div>
          <button
            onClick={() => {
              if (!formData.email || !formData.password) return toast.error('Fill all fields');
              if (formData.password !== formData.confirmPassword) return toast.error("Passwords don't match");
              if (formData.password.length < 8) return toast.error('Password must be 8+ chars');
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
            <label className="block font-display text-sm font-semibold mb-1.5">College</label>
            <select
              className="nb-input"
              value={formData.collegeId}
              onChange={(e) => update('collegeId', e.target.value)}
            >
              <option value="">Select your college</option>
              {colleges?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.shortName ? `${c.shortName} — ${c.name}` : c.name}
                </option>
              ))}
            </select>
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
              className="nb-btn-orange flex-1 text-center"
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
                      : 'bg-nb-yellow hover:bg-nb-yellow/80'
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
              {isLoading ? '⏳ Creating...' : '🎉 Join Freebuff'}
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
