import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Mail, KeyRound, ShieldCheck, AlertTriangle, Check, Lock } from 'lucide-react';
import Logo from '@/components/common/Logo';
import { useAuthStore } from '@/store/auth.store';
import { useVerificationUnlock } from '@/hooks/useVerificationUnlock';
import { verificationApi, CollegeEmailStatus } from '@/services/verification';
import { nextStep } from '@/utils/funnel';

type Phase = 'intro' | 'email' | 'otp' | 'done';

const RESEND_COOLDOWN_SEC = 60;

/**
 * "Prove you're a student" step. The user enters their college email
 * (must match their college's official domain, e.g. @ipec.org.in), we send
 * a 6-digit OTP, and entering it verifies them instantly. The college email
 * is then locked permanently; everything else stays editable.
 */
export default function VerificationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchMe = useAuthStore((s) => s.fetchMe);

  const { data: status, refetch } = useQuery<CollegeEmailStatus>({
    queryKey: ['verification-status'],
    queryFn: async () => (await verificationApi.status()).data,
  });

  const domain = status?.collegeEmailDomain || null;

  // Funnel includes password + profile AFTER verification — never /home blind.
  const goNext = () => {
    navigate(nextStep(useAuthStore.getState().user), { replace: true });
  };

  // Already verified (e.g. verified in another tab) → onward in the funnel.
  useEffect(() => {
    if (status && (status.collegeEmailVerified || status.verificationStatus === 'VERIFIED')) {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      fetchMe().catch(() => {});
      goNext();
    }
  }, [status, queryClient, fetchMe, navigate]);

  // DONE: refresh the auth store so the route gates see the fresh status —
  // otherwise "Continue" bounces straight back to /verify.
  useEffect(() => {
    if (phase === 'done') fetchMe().catch(() => {});
  }, [phase, fetchMe]);

  // The moment verification lands (socket or poll), move on — no reload, no button.
  useVerificationUnlock(() => {
    setPhase('done');
    goNext();
  });

  useEffect(() => () => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  }, []);

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

  const sendOtp = async (targetEmail: string) => {
    setError('');
    setBusy(true);
    try {
      await verificationApi.sendCollegeEmail(targetEmail.trim().toLowerCase());
      setEmail(targetEmail.trim().toLowerCase());
      setCode('');
      setPhase('otp');
      startCooldown();
      refetch();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not send OTP — try again');
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setError('Enter a valid email address');
      return;
    }
    if (domain && !value.endsWith(`@${domain.toLowerCase()}`)) {
      setError(`Use your college email ending in @${domain}`);
      return;
    }
    sendOtp(value);
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await verificationApi.verifyCollegeEmail(value);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['verification-status'] });
      await fetchMe().catch(() => {});
      setPhase('done');
      goNext();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Invalid code — try again');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setError('');
    setBusy(true);
    try {
      await verificationApi.resend();
      startCooldown();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not resend — try again');
    } finally {
      setBusy(false);
    }
  };

  // ── OTP ───────────────────────────────────────────────────
  if (phase === 'otp') {
    return (
      <Shell>
        <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
          <div className="mx-auto w-20 h-20 bg-nb-violet/15 flex items-center justify-center">
            <KeyRound size={40} className="text-nb-violet" />
          </div>
          <h1 className="font-display text-2xl font-bold mt-5">Check your inbox</h1>
          <p className="text-sm opacity-70 mt-2">
            We sent a 6-digit code to <span className="font-semibold">{email}</span>. It expires in 10 minutes.
          </p>
          <form onSubmit={submitCode} className="mt-6">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              aria-label="6-digit verification code"
              className="w-full text-center text-3xl font-bold tracking-[0.5em] py-3 border-2 border-nb-lilac/40 focus:border-nb-violet outline-none"
            />
            {error && (
              <p role="alert" className="text-sm text-nb-pink font-semibold mt-4 flex items-center justify-center gap-1">
                <AlertTriangle size={14} /> {error}
              </p>
            )}
            <button type="submit" disabled={busy || code.trim().length !== 6} className="nb-btn-primary w-full mt-6 disabled:opacity-50">
              {busy ? 'Verifying…' : 'Verify my email'}
            </button>
          </form>
          <button onClick={resend} disabled={busy || cooldown > 0} className="nb-btn-ghost w-full mt-2 text-sm disabled:opacity-50">
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
          <button onClick={() => { setPhase('email'); setError(''); }} className="text-sm opacity-60 hover:opacity-100 mt-3">
            ← Use a different email
          </button>
        </div>
      </Shell>
    );
  }

  // ── DONE ──────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Shell>
        <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
          <div className="mx-auto w-20 h-20 flex items-center justify-center bg-nb-violet/15">
            <ShieldCheck size={40} className="text-nb-violet" />
          </div>
          <h1 className="font-display text-2xl font-bold mt-5">You&apos;re verified! 🎓</h1>
          <p className="text-sm opacity-70 mt-2">Welcome to Zoclo. One more step — lock your account.</p>
          <button onClick={goNext} className="nb-btn-primary w-full mt-6">
            Continue
          </button>
        </div>
      </Shell>
    );
  }

  // ── EMAIL ─────────────────────────────────────────────────
  if (phase === 'email') {
    return (
      <Shell>
        <div className="nb-card max-w-md w-full mx-auto p-8">
          <button onClick={() => setPhase('intro')} className="text-sm opacity-60 hover:opacity-100 mb-4">← Back</button>
          <h1 className="font-display text-2xl font-bold text-center">Enter your college email</h1>
          <p className="text-sm opacity-70 text-center mt-2">
            {domain
              ? <>It must end in <span className="font-semibold">@{domain}</span> — that&apos;s how we know you study at {status?.collegeName || 'your college'}.</>
              : 'Use the email address your college gave you.'}
          </p>
          <form onSubmit={submitEmail} className="mt-6">
            <div className="flex items-center gap-2 border-2 border-nb-lilac/40 focus-within:border-nb-violet px-3">
              <Mail size={18} className="text-nb-violet shrink-0" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={domain ? `you@${domain}` : 'you@college.edu'}
                autoComplete="email"
                aria-label="College email"
                className="w-full py-3 outline-none bg-transparent"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-nb-pink font-semibold mt-4 text-center flex items-center justify-center gap-1">
                <AlertTriangle size={14} /> {error}
              </p>
            )}
            <button type="submit" disabled={busy || !email.trim()} className="nb-btn-primary w-full mt-6 disabled:opacity-50">
              {busy ? 'Sending…' : 'Send verification code'}
            </button>
          </form>
          <p className="text-xs opacity-50 mt-4 flex items-center justify-center gap-1.5 text-center">
            <Lock size={13} /> This email gets locked to your account forever — everything else stays editable.
          </p>
        </div>
      </Shell>
    );
  }

  // ── INTRO ─────────────────────────────────────────────────
  return (
    <Shell>
      <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
        <div className="mx-auto w-20 h-20 bg-nb-violet/15 flex items-center justify-center">
          <GraduationCap size={40} className="text-nb-violet" />
        </div>
        <h1 className="font-display text-2xl font-bold mt-5">Verify you&apos;re a student</h1>
        <p className="text-sm opacity-70 mt-2">
          Zoclo is college-only. Enter your college email{domain ? <> (ending in <span className="font-semibold">@{domain}</span>)</> : null} — we&apos;ll send a 6-digit code and you&apos;re in instantly. No paperwork, no waiting.
        </p>
        <ul className="text-left text-sm mt-6 space-y-3">
          <Li><Check size={16} className="text-nb-violet mt-0.5 shrink-0" /> Only your college&apos;s email domain works</Li>
          <Li><Check size={16} className="text-nb-violet mt-0.5 shrink-0" /> Instant — the code verifies you on the spot</Li>
          <Li><Check size={16} className="text-nb-violet mt-0.5 shrink-0" /> Locked forever once verified; the rest stays editable</Li>
        </ul>
        <button onClick={() => setPhase('email')} className="nb-btn-primary w-full mt-8">
          <Mail size={18} className="inline mr-2" /> Verify with college email
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 nb-canvas-surface">
      <div className="mb-8"><Logo size={40} /></div>
      {children}
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2">{children}</li>;
}
