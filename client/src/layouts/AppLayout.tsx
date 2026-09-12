import { Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import MobileNav from '@/components/layout/MobileNav';

export default function AppLayout() {
  const { user } = useAuthStore();
  const location = useLocation();

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
