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
}

export const useAuthStore = create<AuthState>((set) => ({
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
  },

  signup: async (payload) => {
    const { data } = await api.post('/auth/signup', payload);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    set({ user: data.user, isAuthenticated: true });
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
      // Auto-login as test user
      try {
        const { data } = await api.post('/auth/login', {
          email: 'virat@freebuff.app',
          password: 'password123',
        });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        set({ user: data.user, isAuthenticated: true, isLoading: false });
        // Fetch full profile
        const { data: profile } = await api.get('/auth/me');
        set({ user: profile, isAuthenticated: true, isLoading: false });
      } catch {
        set({ isLoading: false });
      }
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
}));
