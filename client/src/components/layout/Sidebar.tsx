import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';

const navItems = [
  { to: '/home', icon: '🏠', label: 'Home' },
  { to: '/confessions', icon: '👻', label: 'Confessions' },
  { to: '/matches', icon: '❤️', label: 'Find Match' },
  { to: '/messages', icon: '💬', label: 'Messages' },
  { to: '/notifications', icon: '🔔', label: 'Notifications' },
];

export default function Sidebar() {
  const { user } = useAuthStore();

  return (
    <div className="h-full bg-nb-beige border-r-nb border-nb-black p-4 flex flex-col">
      {/* Logo */}
      <div className="mb-6 px-2">
        <h1 className="text-2xl font-display font-bold text-nb-black">
          FREE<span className="text-nb-orange">BUFF</span>
        </h1>
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `nb-sidebar-link ${isActive ? 'active' : 'text-nb-black'}`
            }
          >
            <span className="text-xl">{item.icon}</span>
            <span className="font-display text-sm">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Profile link */}
      <div className="mt-auto pt-4 border-t-nb border-nb-black">
        <NavLink
          to={`/profile/${user?.username}`}
          className={({ isActive }) =>
            `nb-sidebar-link ${isActive ? 'active' : 'text-nb-black'}`
          }
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="w-8 h-8 nb-avatar"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-nb-orange border-nb-2 border-nb-black flex items-center justify-center text-white text-sm font-bold">
              {user?.displayName?.[0]?.toUpperCase() || '?'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-display text-sm font-semibold truncate">
              {user?.displayName}
            </p>
            <p className="text-xs text-gray-500 truncate">
              @{user?.username}
            </p>
          </div>
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `nb-sidebar-link mt-1 ${isActive ? 'active' : 'text-nb-black'}`
          }
        >
          <span className="text-xl">⚙️</span>
          <span className="font-display text-sm">Settings</span>
        </NavLink>
      </div>
    </div>
  );
}
