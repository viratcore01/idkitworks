import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, LayoutDashboard, IdCard, Flag, Users, Newspaper,
  Activity, Megaphone, ArrowLeft, LogOut, Search, Command, Building2, Home,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth.store';

const NAV = [
  { to: '/admin', label: 'Overview', icon: <LayoutDashboard size={17} />, end: true },
  { to: '/admin/ids', label: 'ID reviews', icon: <IdCard size={17} /> },
  { to: '/admin/reports', label: 'Reports', icon: <Flag size={17} /> },
  { to: '/admin/users', label: 'Users', icon: <Users size={17} /> },
  { to: '/admin/content', label: 'Content', icon: <Newspaper size={17} /> },
  { to: '/admin/colleges', label: 'Colleges', icon: <Building2 size={17} /> },
  { to: '/admin/activity', label: 'Activity', icon: <Activity size={17} /> },
  { to: '/admin/announce', label: 'Announce', icon: <Megaphone size={17} /> },
];

/**
 * The ops shell: deliberately NOT the student app. Dark command-center
 * chrome, sidebar nav, college scope, and a Ctrl+K palette — moderators
 * live here, students never see it.
 */
export default function AdminLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [palette, setPalette] = useState(false);
  const isStaff = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!isStaff) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
        <div className="bg-white border-2 border-white/20 p-8 text-center max-w-sm">
          <ShieldCheck size={36} className="mx-auto mb-3 text-[#F43F5E]" />
          <h1 className="font-display font-bold text-xl mb-2">Moderators only</h1>
          <p className="text-sm opacity-70">This console is for college moderators and admins.</p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 hidden md:flex flex-col border-r border-white/10 bg-[#0B1120]">
        <div className="px-5 pt-6 pb-5 border-b border-white/10">
          <p className="font-display font-black text-lg tracking-tight">
            ZOCLO <span className="text-[#FBBF24]">OPS</span>
          </p>
          <p className="text-[11px] uppercase tracking-widest text-slate-400 mt-1">
            {user?.role === 'super_admin' ? 'Super admin' : 'Moderator'} · {user?.college?.shortName || user?.college?.name || 'HQ'}
          </p>
        </div>
        <nav className="flex-1 p-3 space-y-1" aria-label="Moderator sections">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold transition-colors ${
                  isActive ? 'bg-[#FBBF24] text-[#0F172A]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {n.icon} {n.label}
              <NavBadge to={n.to} />
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10 space-y-1">
          <button
            onClick={() => setPalette(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <Command size={17} /> Command…
            <kbd className="ml-auto text-[10px] border border-white/20 px-1.5 py-0.5">Ctrl K</kbd>
          </button>
          <button onClick={() => navigate('/home')} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-white">
            <ArrowLeft size={17} /> View app
          </button>
          <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-white">
            <LogOut size={17} /> Logout
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile bar — sticky so ops tabs stay reachable on long queues.
            Home (back to the student app) + Logout live HERE because the
            sidebar is hidden below md — without this row there was no way
            back to the main screen on a phone. */}
        <div className="md:hidden sticky top-0 z-30 border-b border-white/10 bg-[#0B1120]">
          <div className="flex items-center justify-between gap-2 px-2 pt-2">
            <button
              onClick={() => navigate('/home')}
              aria-label="Back to home screen"
              className="flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] text-xs font-bold shrink-0 bg-[#FBBF24] text-[#0F172A]"
            >
              <Home size={15} strokeWidth={2.5} /> Home
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPalette(true)}
                aria-label="Open command palette"
                className="flex items-center justify-center w-11 h-11 text-slate-300 hover:text-white"
              >
                <Command size={17} />
              </button>
              <button
                onClick={handleLogout}
                aria-label="Logout"
                className="flex items-center justify-center w-11 h-11 text-slate-300 hover:text-white"
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto overscroll-x-contain p-2">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] text-xs font-bold shrink-0 ${isActive ? 'bg-[#FBBF24] text-[#0F172A]' : 'text-slate-300'}`
                }
              >
                {n.icon} {n.label}
              </NavLink>
            ))}
          </div>
        </div>
        <main className="flex-1 min-w-0 p-3 sm:p-6 max-w-6xl w-full mx-auto overflow-x-clip">
          <div className="min-w-0 [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full [&_table]:whitespace-nowrap sm:[&_table]:table sm:[&_table]:whitespace-normal">
          <Outlet />
          </div>
        </main>
      </div>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}

/** Pending-count dot on ID / Reports nav items. */
function NavBadge({ to }: { to: string }) {
  const { data } = useQuery({
    queryKey: ['ops-nav-counts'],
    queryFn: () => api.get('/admin/overview').then((r) => r.data),
    staleTime: 30_000,
  });
  const n = to === '/admin/ids' ? data?.totals?.pendingVerifications : to === '/admin/reports' ? data?.totals?.pendingReports : 0;
  if (!n) return null;
  return <span className="ml-auto min-w-[20px] h-5 px-1 text-[11px] font-bold bg-[#F43F5E] text-white inline-flex items-center justify-center">{n}</span>;
}

/**
 * Ctrl+K palette: jump to any section, or find a user by name/@/email and
 * open their inspect file. The fastest way to act on a report that names
 * someone.
 */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data } = useQuery({
    queryKey: ['ops-palette-users', debounced],
    queryFn: () => api.get(`/admin/users?q=${encodeURIComponent(debounced)}&limit=6`).then((r) => r.data),
    enabled: debounced.trim().length >= 2,
  });

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const sections = NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()));
  const users: any[] = data?.users || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 pt-[12vh]" onClick={onClose} role="dialog" aria-label="Command palette">
      <div className="w-full max-w-lg bg-[#0B1120] border-2 border-[#FBBF24] text-slate-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Search size={16} className="text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a section, or find a user…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-500"
            aria-label="Command palette search"
          />
          <kbd className="text-[10px] border border-white/20 px-1.5 py-0.5 text-slate-400">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {sections.map((n) => (
            <button key={n.to} onClick={() => go(n.to)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-white/10 text-left">
              <span className="text-[#FBBF24]">{n.icon}</span> Go to {n.label}
            </button>
          ))}
          {users.map((u: any) => (
            <button key={u.id} onClick={() => go(`/admin/users?inspect=${u.id}`)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-white/10 text-left">
              <span className="w-7 h-7 bg-[#6D28D9] text-white text-xs font-bold inline-flex items-center justify-center shrink-0">
                {(u.displayName || u.username || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold truncate">{u.displayName} <span className="font-normal opacity-50">@{u.username}</span></span>
                <span className="block text-xs text-slate-400 truncate">{u.college?.shortName || ''} · {u.isActive ? u.verificationStatus : 'BANNED'}</span>
              </span>
            </button>
          ))}
          {q.trim().length >= 2 && sections.length === 0 && users.length === 0 && (
            <p className="px-3 py-4 text-sm text-slate-400">No sections or users match “{q}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}
