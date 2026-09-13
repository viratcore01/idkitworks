import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import AuthLayout from '@/layouts/AuthLayout';
import AppLayout from '@/layouts/AppLayout';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import ProfileSetupPage from '@/pages/ProfileSetupPage';
import VerificationPage from '@/pages/VerificationPage';
import AdminVerifyPage from '@/pages/AdminVerifyPage';
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

/**
 * PRODUCT RULE: the app is college-only AND student-verified.
 *  - No college → profile setup (pick your college first)
 *  - UNVERIFIED / REJECTED → the ID verification flow, before anything else
 *  - PENDING → may browse (a moderator is checking) but cannot match or chat
 */
function CollegeRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!user?.college) return <Navigate to="/setup-profile" replace />;
  if (user.verificationStatus === 'UNVERIFIED' || user.verificationStatus === 'REJECTED') {
    return <Navigate to="/verify" replace />;
  }
  return <>{children}</>;
}

/**
 * PRODUCT RULE: main app requires student verification. PENDING users get a
 * limited-access pass (browse the feed) — they simply can't match or chat.
 */
function VerifiedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (user && user.verificationStatus !== 'VERIFIED') return <Navigate to="/verify" replace />;
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
  const { user, fetchMe, isLoading } = useAuthStore();

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

      {/* Main app: protected AND college-gated */}
      <Route element={<CollegeRoute><AppLayout /></CollegeRoute>}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/post/:postId" element={<PostDetailPage />} />
        <Route path="/matches" element={<VerifiedRoute><MatchesPage /></VerifiedRoute>} />
        <Route path="/profile/:username" element={<ProfilePage />} />
        <Route path="/messages/:conversationId" element={<VerifiedRoute><ChatPage /></VerifiedRoute>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/search" element={<SearchPage />} />
      </Route>

      {/* Profile setup: authenticated users only (works with or without college) */}
      <Route path="/setup-profile" element={
        <ProtectedRoute><ProfileSetupPage /></ProtectedRoute>
      } />

      {/* Student ID verification: full-screen flow outside the app chrome */}
      <Route path="/verify" element={
        <ProtectedRoute>
          {user?.verificationStatus === 'VERIFIED' ? <Navigate to="/home" replace /> : <VerificationPage />}
        </ProtectedRoute>
      } />

      {/* Admin verification review queue (college-scoped) */}
      <Route path="/admin/verify" element={
        <ProtectedRoute><AdminVerifyPage /></ProtectedRoute>
      } />

      {/* Removed pages redirect to their closest replacement */}
      <Route path="/confessions" element={<Navigate to="/matches" replace />} />
      <Route path="/messages" element={<Navigate to="/matches" replace />} />

      <Route path="*" element={<Navigate to="/home" />} />
    </Routes>
  );
}
