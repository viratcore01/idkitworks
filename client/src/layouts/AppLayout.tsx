import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth.store';
import { getSocket, onDebouncedEvent } from '@/services/realtime';
import { useVerificationUnlock } from '@/hooks/useVerificationUnlock';
import { useKeepAlive } from '@/hooks/useKeepAlive';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import MobileNav from '@/components/layout/MobileNav';

export default function AppLayout() {
 const { user } = useAuthStore();
 const location = useLocation();
 const navigate = useNavigate();
 const queryClient = useQueryClient();

 // Render free tier sleeps after ~15 min idle → the 30-50 s "app froze" wake.
 // Ping health while the tab is open so the server never dozes mid-session.
 useKeepAlive(!!user);

  // Global realtime badges: incoming messages/matches/notifications refresh the
  // relevant queries. Invalidations are debounced+jittered — a match burst
  // (match + 2 notifications + message) collapses into one refetch per burst
  // instead of stampeding every open client at once.
  useEffect(() => {
  if (!user) return;
  const socket = getSocket();
  if (!socket) return;
  const onNotify = () => {
  queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
  queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const onMsg = () => {
  queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };
  const onMatch = () => {
  queryClient.invalidateQueries({ queryKey: ['matches'] });
  queryClient.invalidateQueries({ queryKey: ['match-stats'] });
  // A new match changes the deck too (matched cards leave it, waiting counts
  // drop) — keep the deck and waiting list in sync without a manual refetch.
  queryClient.invalidateQueries({ queryKey: ['match-discover'] });
  queryClient.invalidateQueries({ queryKey: ['likes-you'] });
  };
  const offNotify = onDebouncedEvent(socket, 'notification-new', onNotify, 2000);
  const offMsg = onDebouncedEvent(socket, 'message-notify', onMsg, 2000);
  const offMatch = onDebouncedEvent(socket, 'match-new', onMatch, 2000);
  return () => {
  offNotify();
  offMsg();
  offMatch();
  };
  }, [user, queryClient]);

  // Verified the instant the email code lands — no reload, no manual step.
 // If the user is inside the wizard the OTP screen navigates itself; this
 // callback only covers app pages (e.g. verified in another tab).
 useVerificationUnlock(() => {
 toast.success("You're verified — welcome to Zoclo!", { icon: '🎓', duration: 5000 });
 if (location.pathname !== '/signup') navigate('/home', { replace: true });
 });

 const isSetupNeeded = user && !user.college && !user.course && location.pathname !== '/setup-profile';

 if (isSetupNeeded) {
 return (
 <div className="min-h-screen nb-canvas-surface">
 <Outlet />
 </div>
 );
 }

 return (
 <div className="min-h-dvh nb-canvas-surface">
 <Topbar />
 <div className="flex">
  {/* Desktop sidebar */}
  <div className="hidden lg:block w-64 fixed top-0 left-0 h-dvh pt-16 z-40 overflow-y-auto overscroll-contain">
  <Sidebar />
  </div>

  {/* Main content — bottom padding clears the mobile nav + iPhone home indicator.
      Single source of bottom clearance (inner div only) to avoid double 192px gap. */}
  <main className="flex-1 w-full min-w-0 lg:ml-64 pt-16 pb-0 lg:pb-6">
  <div className="max-w-2xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8 overflow-x-clip">
 <Outlet />
 </div>
 </main>
 </div>

 {/* Mobile bottom nav */}
 <MobileNav />
 </div>
 );
}
