import { create } from 'zustand';
import api from '@/services/api';
import { User } from '@/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isIncognito: boolean;
  setUser: (user: User | null) => void;
  toggleIncognito: () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: any) => Promise<void>;
  logout: () => Promise<void>;
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
