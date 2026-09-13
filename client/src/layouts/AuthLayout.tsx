import { Outlet } from 'react-router-dom';
import { Zap } from 'lucide-react';
import Logo from '@/components/common/Logo';

export default function AuthLayout() {
  return (
    <div className="min-h-screen nb-canvas-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand — S mark + extruded wordmark, tagline straight from the logo sheet */}
        <div className="text-center mb-8">
          <div className="inline-block">
            <Logo size={72} />
            <div className="flex items-center gap-2 mt-2">
              <div className="h-1 flex-1 bg-nb-lime rounded-full" />
              <Zap size={14} strokeWidth={2.5} className="text-nb-lime" fill="currentColor" />
              <div className="h-1 flex-1 bg-nb-lime rounded-full" />
            </div>
          </div>
          <p className="mt-3 font-display font-semibold text-sm tracking-widest text-nb-black uppercase">
            Hyperlocal Dating &amp; College Community Chat
          </p>
        </div>

        {/* Form container */}
        <div className="nb-card p-6">
          <Outlet />
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs font-body text-gray-400">
            Made with <Zap size={11} strokeWidth={2.5} className="inline mx-0.5 -mt-0.5 text-nb-orange" fill="currentColor" /> for students, by students
          </p>
        </div>
      </div>
    </div>
  );
}
