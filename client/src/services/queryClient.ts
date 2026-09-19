import { QueryClient } from '@tanstack/react-query';

/** Singleton server-state cache. Exported so auth transitions (logout,
 * account switch, deactivation) can wipe it — the next user on a shared
 * device must never see the previous user's DMs, matches or review queue. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
