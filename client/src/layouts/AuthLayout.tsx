import { Outlet } from 'react-router-dom';
import { Heart } from 'lucide-react';
import Logo from '@/components/common/Logo';

export default function AuthLayout() {
 return (
 <div className="min-h-screen nb-canvas-surface flex items-center justify-center p-4">
 <div className="w-full max-w-md">
 {/* Brand — S mark + extruded wordmark, tagline straight from the logo sheet */}
 <div className="text-center mb-8">
 <div className="inline-block">
 <Logo size={72} />
  <div className="flex items-center gap-2 mt-2" aria-hidden="true">
  <div className="h-1 flex-1 bg-nb-yellow " />
  <span className="w-2.5 h-2.5 rotate-45 bg-nb-violet border-2 border-ink shrink-0" />
  <span className="w-2.5 h-2.5 rotate-45 bg-nb-pink border-2 border-ink shrink-0" />
  <span className="w-2.5 h-2.5 rotate-45 bg-nb-yellow border-2 border-ink shrink-0" />
  <div className="h-1 flex-1 bg-nb-yellow " />
  </div>
 </div>
 <p className="mt-3 font-display font-semibold text-sm tracking-widest text-ink uppercase">
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
  Made with <Heart size={11} strokeWidth={2.5} className="inline mx-0.5 -mt-0.5 text-nb-violet" fill="currentColor" /> for students, by students
 </p>
 </div>
 </div>
 </div>
 );
}
