/**
 * Tiny in-process event bus: services publish domain events, server.ts
 * subscribes and fans them out over Socket.IO. Keeps services socket-free
 * while still giving REST endpoints realtime push.
 */
type Handler = (payload: any) => void;

const listeners = new Map<string, Set<Handler>>();

export function publish(event: string, payload: any) {
  listeners.get(event)?.forEach((h) => {
    try { h(payload); } catch { /* a bad listener never breaks the request */ }
  });
}

export function subscribe(event: string, handler: Handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}
