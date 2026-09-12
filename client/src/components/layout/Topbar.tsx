import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Glasses, Bell } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';

export default function Topbar() {
  const { user, isIncognito, toggleIncognito } = useAuthStore();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: unreadData } = useQuery({
    queryKey: ['unread-notifications'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
    refetchInterval: 30000,
  });

  const unreadCount = unreadData?.count || 0;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 h-16 bg-nb-black z-[60] flex items-center gap-2 px-3 sm:px-4"
      style={{ paddingLeft: 'max(0.75rem, env(safe-area-inset-left))' }}
    >
      {/* Desktop: reserve exactly the sidebar's width so content never hides under it */}
      <div className="hidden lg:block w-64 shrink-0" aria-hidden="true">
        <h1 className="text-2xl font-display font-bold text-white leading-none">
          FREE<span className="text-nb-lime">BUFF</span>
        </h1>
      </div>
      <Link to="/home" className="lg:hidden shrink-0">
        <h1 className="text-xl font-display font-bold text-white">
          FREE<span className="text-nb-lime">BUFF</span>
        </h1>
      </Link>

      <form onSubmit={handleSearch} className="flex-1 min-w-0 max-w-md">
        <div className="relative">
          <input
            type="text"
            placeholder="Search people, posts, colleges..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="nb-input py-2 text-sm pl-10"
          />
          <Search size={16} strokeWidth={2.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
      </form>

      <div className="flex items-center gap-2 shrink-0" style={{ marginRight: 'env(safe-area-inset-right)' }}>
        <button
          onClick={toggleIncognito}
          className={`nb-btn text-sm px-3 py-1.5 ${
            isIncognito ? 'bg-nb-lime text-nb-black' : 'bg-white text-nb-black'
          }`}
          title={isIncognito ? 'Incognito ON — all posts & comments are anonymous' : 'Turn on Incognito'}
        >
          <Glasses size={16} strokeWidth={2.5} className="inline" />
          <span className="hidden sm:inline ml-1">{isIncognito ? 'ON' : 'Off'}</span>
        </button>

        <Link to="/notifications" className="nb-btn bg-nb-yellow text-nb-black text-sm px-3 py-1.5 relative">
          <Bell size={16} strokeWidth={2.5} />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-nb-red text-white text-xs font-bold rounded-full border-2 border-nb-black flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>

        <Link to={`/profile/${user?.username}`}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-9 h-9 nb-avatar !border-white" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-nb-orange border-nb-2 border-white flex items-center justify-center text-white text-sm font-bold">
              {user?.displayName?.[0]?.toUpperCase() || '?'}
            </div>
          )}
        </Link>
      </div>
    </div>
  );
}
