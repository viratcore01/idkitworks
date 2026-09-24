import { create } from 'zustand';
import api from '@/services/api';
import { ensurePhotoToken } from '@/utils/photo';
import { disconnectSocket } from '@/services/realtime';
import { queryClient } from '@/services/queryClient';
import { User } from '@/types';interface AuthState {
  user: User | null;
  isLoading: boolean;
  /** A live session is being refreshed in the background. Unlike isLoading
   *  (boot only), this must NOT gate the route guards — flipping it would
   *  unmount the page the user is standing on (the /verify OTP flow lost
   *  its state exactly this way). */
  isRefreshingSession: boolean;
  /** True when boot had stored tokens but the server never answered (cold
   *  start timeout / offline) after retries. Tokens are KEPT — this is not a
   *  logout, and the UI offers Retry instead of flashing the login page. */
  bootStuck: boolean;
  isAuthenticated: boolean;
  isIncognito: boolean;
  setUser: (user: User | null) => void;
  toggleIncognito: () => void;
  login: (identifier: string, password: string) => Promise<void>;
  /** Funnel college is optional: with it, Google auto-verifies on domain match. */
  loginWithGoogle: (idToken: string, collegeId?: string) => Promise<boolean>;
  /** Funnel start: college + identity, no password (set post-verification). */
  signup: (data: { collegeId: string; email: string; username: string; displayName: string }) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setPasswordViaGoogle: (idToken: string, newPassword: string) => Promise<void>;
  /** Funnel step: first password (verified + none set). Stays logged in. */
  setInitialPassword: (newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  fetchMe: () => Promise<void>;
  retryBoot: () => Promise<void>;
  updateProfile: (data: any) => Promise<void>;
  refreshUser: () => Promise<void>;
  applyCollegeChange: (college: User['college']) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  isRefreshingSession: false,
  bootStuck: false,
  isAuthenticated: false,
  isIncognito: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  toggleIncognito: () => set((s) => ({ isIncognito: !s.isIncognito })),

  login: async (identifier, password) => {
    const { data } = await api.post('/auth/login', { identifier, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    set({ user: data.user, isAuthenticated: true });
    // Login response carries only collegeId — fetch the full profile (with the
    // college object) so the college gate evaluates correctly immediately.
    try { await get().fetchMe(); } catch {}
    // Long-lived token for <img> photo URLs (photos break without it).
    ensurePhotoToken().catch(() => {});
  },

  /** Google Sign-In: server verifies the ID token, links/creates the account.
   *  Returns true when a NEW account was created (for the welcome toast).
   *  With a funnel collegeId, a matching-domain Google email auto-verifies. */
  loginWithGoogle: async (idToken, collegeId) => {
    const { data } = await api.post('/auth/google', { credential: idToken, ...(collegeId ? { collegeId } : {}) });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    set({ user: data.user, isAuthenticated: true });
    try { await get().fetchMe(); } catch {}
    ensurePhotoToken().catch(() => {});
    return !!data.created;
  },

  signup: async (payload) => {
    const { data } = await api.post('/auth/signup', payload);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    set({ user: data.user, isAuthenticated: true });
    try { await get().fetchMe(); } catch {}
    // Same as login: photo <img> URLs need the long-lived token immediately —
    // without this the new user's deck photos 401 until the next reload.
    ensurePhotoToken().catch(() => {});
  },

  logout: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try { await api.post('/auth/logout', { refreshToken }); } catch {}
    disconnectSocket();
    queryClient.clear();
    localStorage.clear();
    set({ user: null, isAuthenticated: false, isIncognito: false });
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    await api.patch('/auth/password', { currentPassword, newPassword });
    // Server kills ALL sessions — behave like a logout everywhere.
    disconnectSocket();
    queryClient.clear();
    localStorage.clear();
    set({ user: null, isAuthenticated: false, isIncognito: false });
  },

  /** Funnel first password: server gates on verified + none-set. Unlike the
   *  Google-token and change flows this keeps the session — the placeholder
   *  it replaces was unguessable, so there is nothing to revoke. */
  setInitialPassword: async (newPassword: string) => {
    await api.post('/auth/password/set-initial', { newPassword });
    try { await get().fetchMe(); } catch {}
  },

  /** Google-only accounts have no current password: a FRESH Google ID token
   *  authorizes minting their first password (backup login method). */
  setPasswordViaGoogle: async (idToken: string, newPassword: string) => {
    await api.post('/auth/password/set-via-google', { credential: idToken, newPassword });
    // Server kills ALL sessions — behave like a logout everywhere.
    disconnectSocket();
    queryClient.clear();
    localStorage.clear();
    set({ user: null, isAuthenticated: false, isIncognito: false });
  },

  deleteAccount: async () => {
    await api.delete('/auth/account');
    disconnectSocket();
    queryClient.clear();
    localStorage.clear();
    set({ user: null, isAuthenticated: false, isIncognito: false });
  },

  fetchMe: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      // No backdoor: unauthenticated visitors go to login like a real app.
      set({ isLoading: false, bootStuck: false });
      return;
    }
    // Boot (no user yet) blocks the UI through the guards. Refreshing a LIVE
    // session must not: guards render <LoadingScreen/> on isLoading, which
    // would unmount whatever page the user is on mid-interaction.
    const isBoot = !get().user;
    set(
      isBoot
        ? { isLoading: true, bootStuck: false }
        : { isRefreshingSession: true, bootStuck: false },
    );
    // Transient failures (cold-start timeouts, dropped connections) must NEVER
    // wipe a valid session — that was the "flashes login, then works" bug:
    // boot timed out at 45s, storage got cleared, user re-logged in manually
    // against a now-warm server. Retry first; only a definitive server
    // rejection (401/403/404 after refresh already failed) logs out.
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data } = await api.get('/auth/me');
        set({ user: data, isAuthenticated: true, isLoading: false, bootStuck: false, isRefreshingSession: false });
        ensurePhotoToken().catch(() => {}); // photo <img> URLs need it
        return;
      } catch (e: any) {
        lastError = e;
        if (e?.response) break; // server answered: rejection is definitive
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000)); // else: retry
      }
    }
    if (lastError?.response) {
      localStorage.clear();
      set({ user: null, isAuthenticated: false, isLoading: false, bootStuck: false, isRefreshingSession: false });
    } else {
      // Server never answered. Keep the tokens — the session is probably
      // fine — and let the UI offer Retry instead of a wrong login screen.
      set({ user: null, isAuthenticated: false, isLoading: false, bootStuck: true, isRefreshingSession: false });
    }
  },

  retryBoot: async () => {
    set({ bootStuck: false });
    await get().fetchMe();
  },

  updateProfile: async (profileData) => {
    const { data } = await api.patch('/auth/me', profileData);
    set((s) => ({ user: s.user ? { ...s.user, ...data } : null }));
  },

  /** Re-pull /auth/me — called after avatar/photo changes so the new profile
   *  picture shows EVERYWHERE at once (Topbar, Sidebar, MobileNav, profile
   *  header) without waiting for the next refetch or a page reload. */
  refreshUser: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data, isAuthenticated: true });
    } catch { /* non-fatal: next refetch will catch up */ }
  },

  /**
   * PRODUCT RULE: college-only app. The main-app gate keys off user.college,
   * so the store keeps it in sync whenever a college change comes back.
   */
  applyCollegeChange: (college) => set((s) => (s.user ? { user: { ...s.user, college } } : {})),
}));
