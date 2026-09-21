import { io, Socket } from 'socket.io-client';

/**
 * Realtime layer: one Socket.IO connection per app, authenticated with the
 * access token at handshake. If the socket is down, existing polling keeps
 * everything working — this is pure upside.
 */
let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (socket) return socket;
  const token = localStorage.getItem('accessToken');
  if (!token) return null;

  const url = import.meta.env.VITE_API_URL
    ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, '')
    : undefined; // undefined = same origin (Vite proxies /socket.io in dev)

  socket = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  // The access token rotates (default 60m TTL); a reconnect after expiry must
  // NOT replay the dead handshake token. Every attempt reads the CURRENT
  // token from storage (it rotates on refresh), and a failed auth forces a
  // retry with the fresh one. connect_error also tears the socket down so a
  // later getSocket() call builds a clean connection — no zombie session.
  socket.on('connect', () => {
    socket!.io.on('reconnect_attempt', () => {
      socket!.auth = { token: localStorage.getItem('accessToken') };
    });
  });
  socket.on('connect_error', () => {
    /* silent — polling covers us */
  });

  return socket;
}

/** Live-connection tracking for socket-aware polling (see useSocketLive).
 * Subscribers are notified on connect/disconnect so pages can drop their
 * REST fallback polls to near-zero while the socket is healthy — at launch
 * scale every avoided poll is thousands of spared DB hits per minute. */
let socketLive = false;
const statusListeners = new Set<(live: boolean) => void>();

function setSocketLive(live: boolean) {
  if (socketLive === live) return;
  socketLive = live;
  for (const cb of statusListeners) {
    try { cb(live); } catch { /* never break the socket on a listener */ }
  }
}

export function isSocketLive(): boolean {
  return socketLive && !!socket?.connected;
}

export function onSocketStatus(cb: (live: boolean) => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}

/** Wire liveness tracking into the shared socket. Idempotent — safe to call
 * from every page that cares about connection state. */
export function trackSocketLiveness(): void {
  const s = getSocket();
  if (!s || (s as any).__livenessTracked) return;
  (s as any).__livenessTracked = true;
  setSocketLive(s.connected);
  s.on('connect', () => setSocketLive(true));
  s.on('disconnect', () => setSocketLive(false));
}

/**
 * Debounced socket-event fan-in: collapses a burst of server pushes into one
 * callback per window (plus jitter), so one viral post doesn't stampede N
 * connected clients into N simultaneous full refetches.
 */
export function onDebouncedEvent(
  socket: Socket,
  event: string,
  fn: () => void,
  baseMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handler = () => {
    if (timer) return; // a refetch is already scheduled — coalesce
    // Full jitter: spread the herd across [baseMs, 2*baseMs).
    const delay = baseMs + Math.random() * baseMs;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  socket.on(event, handler);
  return () => {
    socket.off(event, handler);
    if (timer) { clearTimeout(timer); timer = null; }
  };
}

/** Join a conversation room (membership is verified server-side). */
export function joinConversation(conversationId: string) {
  getSocket()?.emit('join-conversation', conversationId);
}

/** Tear the connection down (logout, account switch, deactivation) so the
 * next session never inherits the previous user's rooms or handshake token. */
export function disconnectSocket() {
  try { socket?.disconnect(); } catch {}
  socket = null;
  setSocketLive(false);
}
