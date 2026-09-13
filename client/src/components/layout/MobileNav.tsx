import { NavLink, useLocation } from 'react-router-dom';
import { Home, Heart, User, Bookmark } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

export default function MobileNav() {
  const { user } = useAuthStore();
  const location = useLocation();

  const items = [
    { to: '/home', Icon: Home, label: 'Home' },
    { to: '/matches', Icon: Heart, label: 'Match' },
    { to: '/saved', Icon: Bookmark, label: 'Saved' },
    // Real username route — /profile/me was a 404
    { to: `/profile/${user?.username || ''}`, Icon: User, label: 'Profile' },
  ];

  return (
    <div
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-nb-black z-[70] flex items-center justify-around px-2"
      style={{
        height: 'calc(4rem + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => {
            // /profile/:username should highlight Profile for any own-profile depth route
            const active = isActive || (item.label === 'Profile' && location.pathname.startsWith('/profile/') && location.pathname.split('/')[2] === user?.username);
            return `flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-full border-2 transition-colors ${
              active
                ? 'bg-white text-nb-black border-white shadow-[3px_3px_0_0_#C8F169]'
                : 'text-white border-transparent'
            }`;
          }}
        >
          <item.Icon size={22} strokeWidth={2.5} />
          <span className="text-[10px] font-display font-semibold">{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
