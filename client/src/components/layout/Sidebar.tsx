import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import Logo from '@/components/common/Logo';
import { bestAvatarSrc } from '@/utils/photo';
import { Home, Heart, Bell, Settings } from 'lucide-react';

const navItems = [
  { to: '/home', Icon: Home, label: 'Home' },
  { to: '/matches', Icon: Heart, label: 'Find Match' },
  { to: '/notifications', Icon: Bell, label: 'Notifications' },
];

export default function Sidebar() {
  const { user } = useAuthStore();

  return (
    <div className="h-full bg-nb-black p-4 flex flex-col">
      {/* Logo */}
      <div className="mb-6 px-2">
        <Logo size={28} />
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `nb-sidebar-link ${isActive ? 'active' : 'text-white/90 hover:text-nb-black'}`
            }
          >
            <item.Icon size={20} strokeWidth={2.5} />
            <span className="font-display text-sm">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Profile link */}
      <div className="mt-auto pt-4 border-t-nb border-nb-black">
        <NavLink
          to={`/profile/${user?.username}`}
          className={({ isActive }) =>
            `nb-sidebar-link ${isActive ? 'active' : 'text-white/90 hover:text-nb-black'}`
          }
        >
          {bestAvatarSrc(user) ? (
            <img
              src={bestAvatarSrc(user)!}
              alt=""
              className="w-8 h-8 nb-avatar"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-nb-orange border-nb-2 border-white flex items-center justify-center text-white text-sm font-bold">
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
            `nb-sidebar-link mt-1 ${isActive ? 'active' : 'text-white/90 hover:text-nb-black'}`
          }
        >
          <Settings size={20} strokeWidth={2.5} />
          <span className="font-display text-sm">Settings</span>
        </NavLink>
      </div>
    </div>
  );
}
