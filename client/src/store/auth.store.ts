import { create } from 'zustand';
import api from '@/services/api';
import { ensurePhotoToken } from '@/utils/photo';
import { disconnectSocket } from '@/services/realtime';
import { queryClient } from '@/services/queryClient';
import { User } from '@/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isIncognito: boolean;
  setUser: (user: User | null) => void;
  toggleIncognito: () => void;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<boolean>;
  signup: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  fetchMe: () => Promise<void>;
  updateProfile: (data: any) => Promise<void>;
  applyCollegeChange: (college: User['college']) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  isIncognito: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  toggleIncognito: () => set((s) => ({ isIncognito: !s.isIncognito })),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
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
   *  Returns true when a NEW account was created (for the welcome toast). */
  loginWithGoogle: async (idToken) => {
    const { data } = await api.post('/auth/google', { credential: idToken });
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
      set({ isLoading: false });
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data, isAuthenticated: true, isLoading: false });
      ensurePhotoToken().catch(() => {}); // photo <img> URLs need it
    } catch {
      localStorage.clear();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  updateProfile: async (profileData) => {
    const { data } = await api.patch('/auth/me', profileData);
    set((s) => ({ user: s.user ? { ...s.user, ...data } : null }));
  },

  /**
   * PRODUCT RULE: college-only app. The main-app gate keys off user.college,
   * so the store keeps it in sync whenever a college change comes back.
   */
  applyCollegeChange: (college) => set((s) => (s.user ? { user: { ...s.user, college } } : {})),
}));
