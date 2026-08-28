import { NavLink } from 'react-router-dom';

const items = [
  { to: '/home', icon: '🏠', label: 'Home' },
  { to: '/matches', icon: '❤️', label: 'Match' },
  { to: '/confessions', icon: '👻', label: 'Confess' },
  { to: '/messages', icon: '💬', label: 'Chat' },
  { to: '/profile/me', icon: '👤', label: 'Profile' },
];

export default function MobileNav() {
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-nb-beige border-t-nb border-nb-black z-50 flex items-center justify-around px-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-2 py-1 rounded-nb transition-colors ${
              isActive ? 'bg-nb-orange text-white' : 'text-nb-black'
            }`
          }
        >
          <span className="text-xl">{item.icon}</span>
          <span className="text-[10px] font-display font-semibold">{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
