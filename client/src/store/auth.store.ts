import { create } from 'zustand';
import { User } from '@/types';

const MOCK_USER: User = {
  id: 'mock-001',
  email: 'demo@freebuff.app',
  username: 'demostudent',
  displayName: 'Demo Student',
  avatarUrl: null,
  bio: 'Just exploring Freebuff! 🚀',
  college: { id: 'c1', name: 'Institute of Professional Education and Communication', shortName: 'IPEC', city: 'Ghaziabad', state: 'Uttar Pradesh', logoUrl: null },
  course: 'CSE',
  year: 2,
  isVerified: false,
  interests: [
    { id: 'i1', name: 'Coding', category: 'Tech' },
    { id: 'i2', name: 'Music', category: 'Creative' },
    { id: 'i3', name: 'Gaming', category: 'Entertainment' },
    { id: 'i4', name: 'Cricket', category: 'Sports' },
  ],
  postCount: 0,
};

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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: MOCK_USER,
  isLoading: false,
  isAuthenticated: true,
  isIncognito: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  toggleIncognito: () => set((s) => ({ isIncognito: !s.isIncognito })),

  login: async (_email, _password) => {
    set({ user: MOCK_USER, isAuthenticated: true });
  },

  signup: async (_payload) => {
    set({ user: MOCK_USER, isAuthenticated: true });
  },

  logout: async () => {
    set({ user: null, isAuthenticated: false, isIncognito: false });
  },

  fetchMe: async () => {
    set({ user: MOCK_USER, isAuthenticated: true, isLoading: false });
  },

  updateProfile: async (profileData) => {
    set((s) => ({ user: s.user ? { ...s.user, ...profileData } : null }));
  },
}));
