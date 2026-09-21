import { useEffect, useState } from 'react';
import { getSocket, isSocketLive, onSocketStatus, trackSocketLiveness } from '@/services/realtime';

/**
 * useSocketLive: true while the realtime socket is connected.
 *
 * Launch-scale contract: every polling fallback in the app keys off this.
 * Socket healthy → polls drop to near-zero (push covers everything).
 * Socket down → polls take over so nothing ever looks frozen.
 * Without this split, N concurrent users × fixed polls = a self-inflicted
 * DDoS on the DB pool.
 */
export function useSocketLive(): boolean {
  const [live, setLive] = useState<boolean>(() => isSocketLive());

  useEffect(() => {
    // Ensure the shared socket exists + is tracked even on pages that never
    // subscribed to an event before (e.g. Saved, Search).
    if (getSocket()) trackSocketLiveness();
    setLive(isSocketLive());
    return onSocketStatus(setLive);
  }, []);

  return live;
}
