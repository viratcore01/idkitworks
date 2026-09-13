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

  // If auth fails (expired token), the next successful refresh reconnects us.
  socket.on('connect_error', () => {
    /* silent — polling covers us */
  });

  return socket;
}

/** Join a conversation room (membership is verified server-side). */
export function joinConversation(conversationId: string) {
  getSocket()?.emit('join-conversation', conversationId);
}
