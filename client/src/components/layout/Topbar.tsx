import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';

export default function Topbar() {
  const { user, isIncognito, toggleIncognito } = useAuthStore();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 h-16 bg-nb-beige border-b-nb border-nb-black z-50 flex items-center px-4 lg:pl-68">
      {/* Logo (mobile) */}
      <Link to="/home" className="lg:hidden mr-4">
        <h1 className="text-xl font-display font-bold text-nb-black">
          FREE<span className="text-nb-orange">BUFF</span>
        </h1>
      </Link>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex-1 max-w-md">
        <div className="relative">
          <input
            type="text"
            placeholder="Search people, posts, colleges..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="nb-input py-2 text-sm pl-10"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        </div>
      </form>

      <div className="flex items-center gap-2 ml-4">
        {/* Incognito toggle */}
        <button
          onClick={toggleIncognito}
          className={`nb-btn text-sm px-3 py-1.5 ${
            isIncognito
              ? 'bg-nb-purple text-white'
              : 'bg-white text-nb-black'
          }`}
          title={isIncognito ? 'Incognito ON' : 'Turn on Incognito'}
        >
          🕶️
          <span className="hidden sm:inline ml-1">
            {isIncognito ? 'ON' : 'Off'}
          </span>
        </button>

        {/* Notifications */}
        <Link
          to="/notifications"
          className="nb-btn bg-white text-nb-black text-sm px-3 py-1.5 relative"
        >
          🔔
          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-nb-red text-white text-xs font-bold rounded-full border-2 border-nb-black flex items-center justify-center">
            2
          </span>
        </Link>

        {/* Avatar */}
        <Link to={`/profile/${user?.username}`}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-9 h-9 nb-avatar" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-nb-orange border-nb-2 border-nb-black flex items-center justify-center text-white text-sm font-bold">
              {user?.displayName?.[0]?.toUpperCase() || '?'}
            </div>
          )}
        </Link>
      </div>
    </div>
  );
}
