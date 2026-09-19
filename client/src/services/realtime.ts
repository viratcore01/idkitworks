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

  // The access token lives ~15 minutes; a reconnect 16 minutes later must
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

/** Join a conversation room (membership is verified server-side). */
export function joinConversation(conversationId: string) {
  getSocket()?.emit('join-conversation', conversationId);
}

/** Tear the connection down (logout, account switch, deactivation) so the
 * next session never inherits the previous user's rooms or handshake token. */
export function disconnectSocket() {
  try { socket?.disconnect(); } catch {}
  socket = null;
}
