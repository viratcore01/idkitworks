import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/services/realtime';
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
  // relevant queries instantly — no polling required for live counts.
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
    };
    socket.on('notification-new', onNotify);
    socket.on('message-notify', onMsg);
    socket.on('match-new', onMatch);
    return () => {
      socket.off('notification-new', onNotify);
      socket.off('message-notify', onMsg);
      socket.off('match-new', onMatch);
    };
  }, [user, queryClient]);

  // Verified the instant a moderator approves — no reload, no manual step.
  useVerificationUnlock(() => {
    toast.success("You're verified — welcome to Skola!", { icon: '🎓', duration: 5000 });
    navigate('/home', { replace: true });
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
        <div className="hidden lg:block w-64 fixed top-0 left-0 h-dvh pt-16">
          <Sidebar />
        </div>

        {/* Main content — bottom padding clears the mobile nav + iPhone home indicator */}
        <main className="flex-1 w-full min-w-0 lg:ml-64 pt-16 pb-24 lg:pb-6" style={{ paddingBottom: undefined }}>
          <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
