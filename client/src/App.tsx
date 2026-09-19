import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import AuthLayout from '@/layouts/AuthLayout';
import AppLayout from '@/layouts/AppLayout';
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import ProfileSetupPage from '@/pages/ProfileSetupPage';
import VerificationPage from '@/pages/VerificationPage';
import AdminVerifyPage from '@/pages/AdminVerifyPage';
import AdminLayout from '@/layouts/AdminLayout';
import AdminOverview from '@/pages/admin/AdminOverview';
import AdminIds from '@/pages/admin/AdminIds';
import AdminReports from '@/pages/admin/AdminReports';
import AdminUsers from '@/pages/admin/AdminUsers';
import AdminContent from '@/pages/admin/AdminContent';
import AdminActivity from '@/pages/admin/AdminActivity';
import AdminAnnounce from '@/pages/admin/AdminAnnounce';
import HomePage from '@/pages/HomePage';
import MatchesPage from '@/pages/MatchesPage';
import ProfilePage from '@/pages/ProfilePage';
import ChatPage from '@/pages/ChatPage';
import NotificationsPage from '@/pages/NotificationsPage';
import PostDetailPage from '@/pages/PostDetailPage';
import SettingsPage from '@/pages/SettingsPage';
import SearchPage from '@/pages/SearchPage';
import SavedPage from '@/pages/SavedPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
 const { isAuthenticated, isLoading } = useAuthStore();
 if (isLoading) return <LoadingScreen />;
 if (!isAuthenticated) return <Navigate to="/login" />;
 return <>{children}</>;
}

/**
 * PRODUCT RULE (dead simple): nobody enters the app until a moderator has
 * approved their student ID. No college → profile setup. Not VERIFIED → the
 * verification flow, full stop. (The server enforces the same wall.)
 * Admins are staff — they bypass the wall so they can run the review queue.
 */
function CollegeRoute({ children }: { children: React.ReactNode }) {
 const { user, isAuthenticated, isLoading } = useAuthStore();
 if (isLoading) return <LoadingScreen />;
 if (!isAuthenticated) return <Navigate to="/login" />;
 if (!user?.college) return <Navigate to="/setup-profile" replace />;
 const isStaff = user.role === 'admin' || user.role === 'super_admin';
 if (!isStaff && user.verificationStatus !== 'VERIFIED') {
 return <Navigate to="/verify" replace />;
 }
 return <>{children}</>;
}

/**
 * PRODUCT RULE: main app requires student verification (staff exempt).
 */
function VerifiedRoute({ children }: { children: React.ReactNode }) {
 const { user, isLoading } = useAuthStore();
 if (isLoading) return <LoadingScreen />;
 const isStaff = user?.role === 'admin' || user?.role === 'super_admin';
 if (user && !isStaff && user.verificationStatus !== 'VERIFIED') return <Navigate to="/verify" replace />;
 return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/home" />;
  return <>{children}</>;
}

/** Staff-only pages (moderator console): non-staff bounce to home. */
function StaffRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (user?.role !== 'admin' && user?.role !== 'super_admin') return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function LoadingScreen() {
 return (
 <div className="min-h-screen nb-canvas-surface flex items-center justify-center">
 <div className="text-center">
 <Zap size={56} strokeWidth={2.5} className="text-ink animate-bounce" fill="currentColor" />
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
 {/* Marketing landing page — public to everyone (auth CTAs open the live
 app's login in a NEW TAB, so no redirect gymnastics needed here) */}
 <Route path="/" element={<LandingPage />} />

 {/* Public routes */}
 <Route element={<PublicRoute><AuthLayout /></PublicRoute>}>
 <Route path="/login" element={<LoginPage />} />
 <Route path="/signup" element={<SignupPage />} />
 </Route>

 {/* Main app: protected AND college-gated */}
 <Route element={<CollegeRoute><AppLayout /></CollegeRoute>}>
 <Route path="/home" element={<HomePage />} />
 <Route path="/saved" element={<SavedPage />} />
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

 {/* Student ID verification: full-screen flow outside the app chrome.
 VERIFIED users and staff don't need it. */}
 <Route path="/verify" element={
 <ProtectedRoute>
 {user && (user.verificationStatus === 'VERIFIED' || user.role === 'admin' || user.role === 'super_admin')
 ? <Navigate to="/home" replace />
 : <VerificationPage />}
 </ProtectedRoute>
 } />

  {/* Ops command center: its own dark shell, not the student app */}
  <Route path="/admin" element={
  <StaffRoute><AdminLayout /></StaffRoute>
  }>
  <Route index element={<AdminOverview />} />
  <Route path="ids" element={<AdminIds />} />
  <Route path="reports" element={<AdminReports />} />
  <Route path="users" element={<AdminUsers />} />
  <Route path="content" element={<AdminContent />} />
  <Route path="activity" element={<AdminActivity />} />
  <Route path="announce" element={<AdminAnnounce />} />
  {/* Legacy console entry: forwards into the new shell */}
  <Route path="console" element={<Navigate to="/admin" replace />} />
  </Route>

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
