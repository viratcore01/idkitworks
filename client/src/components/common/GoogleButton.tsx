import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth.store';

declare global {
  interface Window {
    google?: any;
  }
}

/**
 * Real Google Sign-In via Google Identity Services (the official button).
 *
 * Why it can never be a dummy:
 *  - It only renders when the server advertises GOOGLE_CLIENT_ID
 *    (GET /api/health → auth.google). Unconfigured server → nothing changes.
 *  - Google's own JS issues the credential (ID token); it is POSTed to
 *    /api/auth/google where the server verifies the signature against
 *    Google's public keys before creating or linking the account.
 *  - The same flow serves login AND signup: existing email → linked (old
 *    password keeps working); new email → account inside the normal funnel
 *    (no college yet, unverified → the college wall and ID gate apply).
 */
export default function GoogleButton({ mode }: { mode: 'login' | 'signup' }) {
  const [enabled, setEnabled] = useState<{ clientId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const navigate = useNavigate();

  // 1. Ask the server whether Google sign-in is configured.
  useEffect(() => {
    let cancelled = false;
    api
      .get('/health')
      .then(({ data }) => {
        if (!cancelled && data?.auth?.google && data?.auth?.googleClientId) {
          setEnabled({ clientId: data.auth.googleClientId });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
            const created = await loginWithGoogle(response.credential);
            toast.success(created ? 'Account created — welcome to Skola!' : 'Welcome back!');
            // The App gate routes correctly from here: no college → setup,
            // unverified → /verify, everyone else → the feed.
            navigate('/home');
          } catch (err: any) {
            toast.error(err.response?.data?.error || 'Google sign-in failed');
          } finally {
            setBusy(false);
          }
        },
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: mode === 'signup' ? 'signup_with' : 'signin_with',
        width: 320,
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

  if (!enabled) return null;

  return (
    <div
      className="flex justify-center transition-opacity"
      style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}
    >
      <div ref={btnRef} />
    </div>
  );
}
