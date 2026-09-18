import { useEffect, useRef } from 'react';
import api from '@/services/api';

/**
 * Keep-alive: Render's free tier sleeps an idle server after ~15 min, and a
 * waking request takes 30-50 s — that IS the "app froze, then started
 * working" experience. While a user has the app open, this pings /api/health
 * every 4 minutes (well under the idle cutoff) so the server never dozes
 * mid-session. It stops when the tab is hidden so we never burn free-tier
 * hours for a backgrounded tab, and only runs in production builds
 * (localhost has nothing to keep awake).
 */
const PING_INTERVAL_MS = 4 * 60 * 1000;

export function useKeepAlive(enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !import.meta.env.PROD) return;

    let visible = document.visibilityState === 'visible';

    const start = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(() => {
        if (document.visibilityState !== 'visible') return; // hidden tab: skip
        api.get('/health', { timeout: 10_000 }).catch(() => {});
      }, PING_INTERVAL_MS);
    };

    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const onVisibility = () => {
      const nowVisible = document.visibilityState === 'visible';
      if (nowVisible && !visible) start();
      else if (!nowVisible) stop();
      visible = nowVisible;
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (visible) start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
