import { useEffect, Suspense, lazy, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { recordNavigation, cycleTripped } from '@/utils/redirectGuard';
import BrandLoader from '@/components/common/BrandLoader';
import Logo from '@/components/common/Logo';
import { useAuthStore } from '@/store/auth.store';
import { funnelDone } from '@/utils/funnel';
import AuthLayout from '@/layouts/AuthLayout';
import AppLayout from '@/layouts/AppLayout';
// PERF: every page is a separate chunk — first paint ships the shell only,
// not Landing + admin + every screen at once (the old 500kB+ bundle).
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SignupPage = lazy(() => import('@/pages/SignupPage'));
const ProfileSetupPage = lazy(() => import('@/pages/ProfileSetupPage'));
const SetupPasswordPage = lazy(() => import('@/pages/SetupPasswordPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
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
 if (cycleTripped()) return <CycleDeadEnd />;
 if (!isAuthenticated) return <Navigate to="/login" />;
 return <>{children}</>;
}

/**
 * PRODUCT RULE (dead simple): nobody enters the app until their college
 * email is OTP-verified. No college → profile setup. Not VERIFIED → the
 * verification flow, full stop. (The server enforces the same wall.)
 * Admins are staff — they bypass the wall.
 */
function CollegeRoute({ children }: { children: React.ReactNode }) {
 const { user, isAuthenticated, isLoading } = useAuthStore();
 if (isLoading) return <LoadingScreen />;
 if (cycleTripped()) return <CycleDeadEnd />;
 if (!isAuthenticated) return <Navigate to="/login" />;
 if (cycleTripped()) return <CycleDeadEnd />;
 if (!user?.college) return <Navigate to="/setup-profile" replace />;
 const isStaff = user.role === 'admin' || user.role === 'super_admin';
 if (!isStaff && user.verificationStatus !== 'VERIFIED') {
 if (cycleTripped()) return <CycleDeadEnd />;
 return <Navigate to="/signup" replace />;
 }
 return <>{children}</>;
}

/**
 * PRODUCT RULE: main app requires college-email verification (staff exempt).
 * The OTP flow lives INSIDE the signup wizard (/signup resumes it); there is
 * no standalone verification page anymore — unverified users belong in the
 * wizard, at the code step, with the address they typed still on screen.
 */
function VerifiedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  const location = useLocation();
  if (isLoading) return <LoadingScreen />;
  const isStaff = user?.role === 'admin' || user?.role === 'super_admin';
  if (user && !isStaff && user.verificationStatus !== 'VERIFIED' && location.pathname !== '/signup') {
    if (cycleTripped()) return <CycleDeadEnd />;
    return <Navigate to="/signup" replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) {
    // A finished account never sees auth pages.
    if (cycleTripped()) return <CycleDeadEnd />;
    if (funnelDone(user)) return <Navigate to="/home" />;
    // A MID-FUNNEL account stays on /signup: the wizard owns its next screens
    // (OTP → password → profile), and evicting it the instant "Send my code"
    // creates the row bounces /home → CollegeRoute → the old /verify page —
    // screen demands the same email the wizard already has. That redirect war
    // was the "why is it asking for my email again" bug. (A Google sign-in
    // from the login page also lands here mid-funnel; the same rule keeps the
    // wizard's college step reachable instead of looping /home → /setup-profile.)
    if (location.pathname === '/signup') return <>{children}</>;
    // Mid-funnel on /login etc: let the app's gates place them (the wizard,
    // /setup-password, /setup-profile) instead of showing a sign-in form to
    // someone who is already signed in.
    if (cycleTripped()) return <CycleDeadEnd />;
    return <Navigate to="/home" />;
  }
  return <>{children}</>;
}

/** Staff-only pages (moderator console): non-staff bounce to home. */
function StaffRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (cycleTripped()) return <CycleDeadEnd />;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (cycleTripped()) return <CycleDeadEnd />;
  if (user?.role !== 'admin' && user?.role !== 'super_admin') return <Navigate to="/home" replace />;
  return <>{children}</>;
}

/**
 * Feeds the redirect-cycle breaker: every rendered route counts as one
 * navigation. If guards ever start ping-ponging, cycleTripped() goes true
 * and every gate below renders a dead-end screen instead of another
 * <Navigate> — the loop is cut before Chrome's navigation throttling hangs
 * the tab white (the "Throttling navigation" console error).
 */
function RouteCycleWatcher() {
  const location = useLocation();
  useEffect(() => { recordNavigation(); }, [location.pathname]);
  return null;
}

function CycleDeadEnd() {
  return (
    <div className="min-h-screen nb-canvas-surface flex items-center justify-center p-6">
      <div className="text-center max-w-xs">
        <Logo size={64} className="mx-auto" />
        <p className="mt-4 font-display font-bold text-lg">The app got stuck redirecting</p>
        <p className="mt-2 font-body text-sm text-gray-500">
          A routing loop was just stopped. Reload the page — it will come back clean.
        </p>
        <button onClick={() => window.location.reload()} className="nb-btn-orange mt-5">Reload</button>
      </div>
    </div>
  );
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
  <RouteCycleWatcher />
  <Routes>
 {/* Marketing landing page — public to everyone (auth CTAs open the live
 app's login in a NEW TAB, so no redirect gymnastics needed here) */}
 <Route path="/" element={<LandingPage />} />

 {/* Public routes */}
 <Route element={<PublicRoute><AuthLayout /></PublicRoute>}>
 <Route path="/login" element={<LoginPage />} />
 <Route path="/signup" element={<SignupPage />} />
 <Route path="/forgot-password" element={<ForgotPasswordPage />} />
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

 {/* Funnel: first password, after verification (skippable for Google users) */}
 <Route path="/setup-password" element={
 <ProtectedRoute><SetupPasswordPage /></ProtectedRoute>
 } />

  {/* College-email OTP verification lives INSIDE the signup wizard now;
      /verify is retired and lands in the wizard at the right step. */}
 <Route path="/verify" element={<Navigate to="/signup" replace />} />

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

  {/* Old console URL kept for bookmarks */}
 <Route path="/admin/verify" element={<Navigate to="/admin/ids" replace />} />

 {/* Removed pages redirect to their closest replacement */}
 <Route path="/confessions" element={<Navigate to="/matches" replace />} />
 <Route path="/messages" element={<Navigate to="/matches" replace />} />

  <Route path="*" element={<Navigate to="/home" />} />
  </Routes>
  </Suspense>
  );
}
