import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-nb-beige flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-block">
            <h1 className="text-5xl font-display font-bold text-nb-black tracking-tight">
              FREE<span className="text-nb-orange">BUFF</span>
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1 flex-1 bg-nb-orange rounded-full" />
              <span className="text-xs font-display font-semibold text-nb-black">⚡</span>
              <div className="h-1 flex-1 bg-nb-orange rounded-full" />
            </div>
          </div>
          <p className="mt-3 font-body text-sm text-gray-600">
            The social network for students. 🎓
          </p>
        </div>

        {/* Form container */}
        <div className="nb-card p-6">
          <Outlet />
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs font-body text-gray-400">
            Made with ⚡ for students, by students
          </p>
        </div>
      </div>
    </div>
  );
}
