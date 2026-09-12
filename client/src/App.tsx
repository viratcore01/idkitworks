import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import AuthLayout from '@/layouts/AuthLayout';
import AppLayout from '@/layouts/AppLayout';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import ProfileSetupPage from '@/pages/ProfileSetupPage';
import HomePage from '@/pages/HomePage';
import MatchesPage from '@/pages/MatchesPage';
import ProfilePage from '@/pages/ProfilePage';
import ChatPage from '@/pages/ChatPage';
import NotificationsPage from '@/pages/NotificationsPage';
import PostDetailPage from '@/pages/PostDetailPage';
import SettingsPage from '@/pages/SettingsPage';
import SearchPage from '@/pages/SearchPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/home" />;
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen nb-canvas-surface flex items-center justify-center">
      <div className="text-center">
        <Zap size={56} strokeWidth={2.5} className="text-nb-black animate-bounce" fill="currentColor" />
        <p className="mt-4 font-display font-semibold text-lg">Loading...</p>
      </div>
    </div>
  );
}

export default function App() {
  const { fetchMe, isLoading } = useAuthStore();

  useEffect(() => {
    fetchMe();
  }, []);

  if (isLoading) return <LoadingScreen />;

  return (
    <Routes>
      {/* Public routes */}
      <Route element={<PublicRoute><AuthLayout /></PublicRoute>}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      {/* Protected routes */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/post/:postId" element={<PostDetailPage />} />
        <Route path="/matches" element={<MatchesPage />} />
        <Route path="/profile/:username" element={<ProfilePage />} />
        <Route path="/messages/:conversationId" element={<ChatPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/search" element={<SearchPage />} />
      </Route>

      {/* Profile setup */}
      <Route path="/setup-profile" element={
        <ProtectedRoute><ProfileSetupPage /></ProtectedRoute>
      } />

      {/* Removed pages redirect to their closest replacement */}
      <Route path="/confessions" element={<Navigate to="/matches" replace />} />
      <Route path="/messages" element={<Navigate to="/matches" replace />} />

      <Route path="*" element={<Navigate to="/home" />} />
    </Routes>
  );
}
