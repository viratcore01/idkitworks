import { NavLink } from 'react-router-dom';
import { Home, Heart, User } from 'lucide-react';

const items = [
  { to: '/home', Icon: Home, label: 'Home' },
  { to: '/matches', Icon: Heart, label: 'Match' },
  { to: '/profile/me', Icon: User, label: 'Profile' },
];

export default function MobileNav() {
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-nb-black z-50 flex items-center justify-around px-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-full border-2 transition-colors ${
              isActive
                ? 'bg-white text-nb-black border-white shadow-[3px_3px_0_0_#C8F169]'
                : 'text-white border-transparent'
            }`
          }
        >
          <item.Icon size={22} strokeWidth={2.5} />
          <span className="text-[10px] font-display font-semibold">{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
