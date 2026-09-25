import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import { nextStep } from '@/utils/funnel';

declare global {
 interface Window {
 google?: any;
 }
}

/**
 * Real Google Sign-In via Google Identity Services (the official button).
 *
 * Why it can never be a dummy:
 * - It only renders when the server advertises GOOGLE_CLIENT_ID
 * (GET /api/health → auth.google). Unconfigured server → nothing changes.
 * - Google's own JS issues the credential (ID token); it is POSTed to
 * /api/auth/google where the server verifies the signature against
 * Google's public keys before creating or linking the account.
 * - The same flow serves login AND signup: existing email → linked (old
  * password keeps working); new email → account inside the normal funnel
  * (no college yet, unverified → the college wall and email gate apply).
  * With a funnel collegeId, a matching-domain Google email auto-verifies
  * instantly (same proof as OTP); mismatches are rejected, never created.
 * - Verify mode (`mode="verify"` + `onCredential`): renders the same official
 * button but hands the fresh ID token to the caller instead of logging in —
 * used by Settings to prove Google-account ownership before setting a first
 * password. No navigation happens in this mode.
 * - Signup-wizard mode: nothing to type first — name and details come straight
 * from the Google account (locked like the email path's). Only a Google
 * account with no name needs the profile-setup fill-in later.
 */
export default function GoogleButton({ mode, onCredential, collegeId, onSuccess }: {
  mode: 'login' | 'signup' | 'verify';
  onCredential?: (idToken: string) => Promise<void>;
  /** Funnel college: server auto-verifies when the Google email's domain matches it. */
  collegeId?: string;
  /** Funnel override: called with (created) instead of the default /home navigation. */
  onSuccess?: (created: boolean) => void;
}) {
  const [enabled, setEnabled] = useState<{ clientId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // True once the /health probe has exhausted its retries without confirming
  // Google support — the button can never render, so callers (verify mode)
  // must show a retry instead of an eternal blank.
  const [probeFailed, setProbeFailed] = useState(false);
  const [probeRound, setProbeRound] = useState(0);
  const btnRef = useRef<HTMLDivElement>(null);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const navigate = useNavigate();
  // Ref-stable callback: the GIS effect must not re-initialize (and stack a
  // second Google button) on every parent re-render while typing.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const collegeIdRef = useRef(collegeId);
  collegeIdRef.current = collegeId;

 // 1. Ask the server whether Google sign-in is configured.
 // Render's free tier sleeps when idle — the first request can take 30-50s
 // to wake it, longer than the default axios timeout. Be patient and retry:
 // a cold server must never permanently hide the button.
  useEffect(() => {
  let cancelled = false;
  const probe = async (attempt: number): Promise<void> => {
  try {
  const { data } = await api.get('/health', { timeout: 45000 });
  if (!cancelled && data?.auth?.google && data?.auth?.googleClientId) {
  setEnabled({ clientId: data.auth.googleClientId });
  setProbeFailed(false);
  }
  } catch {
  if (!cancelled && attempt < 3) {
  await new Promise((r) => setTimeout(r, 1500));
  return probe(attempt + 1);
  }
  if (!cancelled) setProbeFailed(true);
  }
  };
  probe(1);
  return () => {
  cancelled = true;
  };
  }, [probeRound]);

 // 2. Load Google's script, initialize, render the official button.
 useEffect(() => {
 if (!enabled || !btnRef.current) return;
 const clientId = enabled.clientId;
 let cancelled = false;

 const init = () => {
 if (cancelled || !window.google?.accounts?.id || !btnRef.current) return;
  window.google.accounts.id.initialize({
  client_id: clientId,
   callback: async (response: { credential?: string }) => {
   if (!response?.credential || busy) return;
   setBusy(true);
  try {
  // Verify mode: hand the fresh ID token to the caller (e.g. Settings
  // proving Google-account ownership to set a first password) — no
  // login, no navigation.
  if (onCredentialRef.current) {
  await onCredentialRef.current(response.credential);
  return;
  }
   const created = await loginWithGoogle(response.credential, collegeIdRef.current);
  toast.success(created ? 'Account created — welcome to Zoclo!' : 'Welcome back!');
  if (onSuccessRef.current) {
  // Funnel caller owns routing (college → verify → password → profile).
  onSuccessRef.current(created);
  return;
  }
  // Funnel-aware landing: no college → setup, unverified → /verify,
  // passwordless → /setup-password, everyone else → the feed.
  navigate(nextStep(useAuthStore.getState().user), { replace: true });
  } catch (err: any) {
  toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
  } finally {
  setBusy(false);
  }
  },
  });
  window.google.accounts.id.renderButton(btnRef.current, {
  type: 'standard',
  theme: 'outline',
  size: 'large',
  shape: 'rectangular',
  text: mode === 'signup' ? 'signup_with' : mode === 'verify' ? 'continue_with' : 'signin_with',
  width: Math.min(320, Math.floor(window.innerWidth - 64)),
  });
 };

 const SCRIPT_ID = 'google-gsi-client';
 const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
 if (existing) {
 if (window.google?.accounts?.id) init();
 else existing.addEventListener('load', init);
 } else {
 const s = document.createElement('script');
 s.id = SCRIPT_ID;
 s.src = 'https://accounts.google.com/gsi/client';
 s.async = true;
 s.defer = true;
 s.addEventListener('load', init);
 document.head.appendChild(s);
 }
 return () => {
 cancelled = true;
 };
 }, [enabled, mode, busy, loginWithGoogle, navigate]);

  if (!enabled) {
  // Login/signup keep the legacy behavior (render nothing until confirmed).
  // Verify mode must never leave a blank hole: show progress while probing
  // and an explicit retry when the probe gives up — otherwise the caller
  // shows text + a permanently disabled button, i.e. "stuck loading".
  if (mode !== 'verify') return null;
  if (probeFailed) {
  return (
  <button
  onClick={() => {
  setProbeFailed(false);
  setProbeRound((r) => r + 1);
  }}
  className="nb-btn-ghost w-full text-sm"
  >
  Couldn't reach Google verification — tap to try again
  </button>
  );
  }
  return <p className="text-xs text-gray-500 font-body" role="status">Preparing Google verification…</p>;
  }

  return (
  <div
  className="flex justify-center w-full min-w-0 max-w-full overflow-hidden transition-opacity"
  style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}
  >
  <div ref={btnRef} className="max-w-full min-w-0" />
  </div>
  );
}
