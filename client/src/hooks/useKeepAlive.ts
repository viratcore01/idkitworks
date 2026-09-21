import { useEffect, useRef } from 'react';
import api from '@/services/api';

/**
 * Keep-alive: Render's free tier sleeps an idle server after ~15 min, and a
 * waking request takes 30-50 s — that IS the "app froze, then started
 * working" experience. While a user has the app open, this pings /api/health
 * so the server never dozes mid-session. It stops when the tab is hidden so
 * we never burn free-tier hours for a backgrounded tab, and only runs in
 * production builds (localhost has nothing to keep awake).
 *
 * Launch-scale rules (100k users × fixed 4-min pings = 400+ rps of pure
 * ping traffic + synchronized thundering herds):
 * - 9-minute base interval (still well under the 15-min sleep cutoff).
 * - ±2 min full jitter per client so pings spread evenly instead of firing
 *   in lockstep every time a deploy restarts everyone's timers.
 * - One immediate ping on start/foreground so a just-opened app wakes a
 *   sleeping server right away instead of waiting out the first interval.
 */
const PING_BASE_MS = 9 * 60 * 1000;
const PING_JITTER_MS = 2 * 60 * 1000;

const pingOnce = () => {
  api.get('/health', { timeout: 10_000 }).catch(() => {});
};

export function useKeepAlive(enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !import.meta.env.PROD) return;

    let visible = document.visibilityState === 'visible';

    const start = () => {
      if (timerRef.current) return;
      // Wake a sleeping server immediately on open/foreground — don't make
      // the first paint wait out the interval.
      pingOnce();
      const schedule = () => {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (document.visibilityState !== 'visible') return; // hidden tab: skip
          pingOnce();
          schedule();
        }, PING_BASE_MS + Math.random() * PING_JITTER_MS);
      };
      schedule();
    };

    const stop = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
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
