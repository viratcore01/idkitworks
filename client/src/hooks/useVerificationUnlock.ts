import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/services/realtime';

/**
 * PRODUCT RULE: the moment college-email OTP verification lands, the session
 * flips to VERIFIED everywhere — instantly, with no reload and no manual step.
 *
 * Verification publishes a notification; this hook listens for it on the
 * realtime socket, refreshes the session (VERIFIED unlocks every gate), and
 * fires the callback once. The callback should navigate the user into the app.
 */
export function useVerificationUnlock(onVerified: () => void) {
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const queryClient = useQueryClient();
  const cbRef = useRef(onVerified);
  cbRef.current = onVerified;

  useEffect(() => {
    if (!user || user.verificationStatus === 'VERIFIED') return;
    const socket = getSocket(); // also establishes the connection on /verify
    if (!socket) return;

    let busy = false;
    const handler = async () => {
      if (busy) return;
      busy = true;
      try {
        await fetchMe().catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['verification-status'] });
        const latest = useAuthStore.getState().user;
        if (latest?.verificationStatus === 'VERIFIED') cbRef.current();
      } finally {
        busy = false;
      }
    };
    socket.on('notification-new', handler);

    // FALLBACK: also poll verification status directly as a safety net
    // in case the socket notification is missed or delayed
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (busy) return;
      try {
        const { data } = await import('@/services/verification').then(m => m.verificationApi.status());
        if (data.collegeEmailVerified || data.verificationStatus === 'VERIFIED') {
          await fetchMe().catch(() => {});
          queryClient.invalidateQueries({ queryKey: ['me'] });
          queryClient.invalidateQueries({ queryKey: ['verification-status'] });
          cbRef.current();
          if (pollTimer) clearInterval(pollTimer);
        }
      } catch {}
    };
    pollTimer = setInterval(poll, 3000);

    return () => {
      socket.off('notification-new', handler);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [user?.id, user?.verificationStatus, fetchMe, queryClient]);
}
