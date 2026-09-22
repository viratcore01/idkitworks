import { useEffect, Suspense, lazy, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import BrandLoader from '@/components/common/BrandLoader';
import Logo from '@/components/common/Logo';
import { useAuthStore } from '@/store/auth.store';
import AuthLayout from '@/layouts/AuthLayout';
import AppLayout from '@/layouts/AppLayout';
// PERF: every page is a separate chunk — first paint ships the shell only,
// not Landing + admin + every screen at once (the old 500kB+ bundle).
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SignupPage = lazy(() => import('@/pages/SignupPage'));
const ProfileSetupPage = lazy(() => import('@/pages/ProfileSetupPage'));
const VerificationPage = lazy(() => import('@/pages/VerificationPage'));
const AdminVerifyPage = lazy(() => import('@/pages/AdminVerifyPage'));
const AdminLayout = lazy(() => import('@/layouts/AdminLayout'));
const AdminOverview = lazy(() => import('@/pages/admin/AdminOverview'));
const AdminIds = lazy(() => import('@/pages/admin/AdminIds'));
const AdminReports = lazy(() => import('@/pages/admin/AdminReports'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const AdminContent = lazy(() => import('@/pages/admin/AdminContent'));
const AdminColleges = lazy(() => import('@/pages/admin/AdminColleges'));
const AdminActivity = lazy(() => import('@/pages/admin/AdminActivity'));
const AdminAnnounce = lazy(() => import('@/pages/admin/AdminAnnounce'));
const HomePage = lazy(() => import('@/pages/HomePage'));
const MatchesPage = lazy(() => import('@/pages/MatchesPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const ChatPage = lazy(() => import('@/pages/ChatPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const PostDetailPage = lazy(() => import('@/pages/PostDetailPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const SavedPage = lazy(() => import('@/pages/SavedPage'));

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
  // Cold-start honesty: the free-tier server sleeps when idle and the wake
  // takes ~30s. After 4s of spinner, say so — a silent spinner feels broken.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
  const t = setTimeout(() => setSlow(true), 4000);
  return () => clearTimeout(t);
  }, []);
  return (
  <div className="min-h-screen nb-canvas-surface flex items-center justify-center p-6">
  <div className="text-center max-w-xs">
  <BrandLoader logoSize={72} label="Loading..." />
  {slow && (
  <p className="mt-2 font-body text-sm text-gray-500">
  Waking up the server — it sleeps when idle, first visit takes ~30 seconds.
  </p>
  )}
  </div>
  </div>
  );
}

/** Boot reached a dead end: stored session, but the server never answered
 * even after retries. Tokens are KEPT — Retry usually succeeds instantly
 * against the now-warm server. Never flash the login form here. */
function BootStuckScreen() {
  const retryBoot = useAuthStore((s) => s.retryBoot);
  const [retrying, setRetrying] = useState(false);
  return (
  <div className="min-h-screen nb-canvas-surface flex items-center justify-center p-6">
  <div className="text-center max-w-xs">
  <Logo size={64} className="mx-auto" />
  <p className="mt-4 font-display font-bold text-lg">Couldn't reach Zoclo</p>
  <p className="mt-2 font-body text-sm text-gray-500">
  The server didn't answer. Your login is safe — just try again.
  </p>
  <button
  onClick={async () => { setRetrying(true); try { await retryBoot(); } finally { setRetrying(false); } }}
  disabled={retrying}
  className="nb-btn-orange mt-5 disabled:opacity-50"
  >
  {retrying ? 'Retrying...' : 'Try again'}
  </button>
  </div>
  </div>
  );
}

export default function App() {
  const { user, fetchMe, isLoading, bootStuck } = useAuthStore();

  useEffect(() => {
  fetchMe();
  }, []);

  // Genuine session expiry navigates client-side (no bundle reload, no
  // wrong-screen flash). The api layer fires this instead of location.href.
  const navigate = useNavigate();
  useEffect(() => {
  const onExpired = () => {
  if (!/^\/(login|signup)$/.test(window.location.pathname)) navigate('/login');
  };
  window.addEventListener('auth:expired', onExpired);
  return () => window.removeEventListener('auth:expired', onExpired);
  }, [navigate]);

  if (isLoading) return <LoadingScreen />;
  if (bootStuck) return <BootStuckScreen />;

  return (
  <Suspense fallback={<LoadingScreen />}>
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
  <Route path="colleges" element={<AdminColleges />} />
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
  </Suspense>
  );
}
