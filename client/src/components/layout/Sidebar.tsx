import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import Logo from '@/components/common/Logo';
import Avatar from '@/components/common/Avatar';
import { Home, Heart, Bell, Settings, Bookmark } from 'lucide-react';

const navItems = [
 { to: '/home', Icon: Home, label: 'Home' },
 { to: '/saved', Icon: Bookmark, label: 'Saved' },
 { to: '/matches', Icon: Heart, label: 'Find Match' },
 { to: '/notifications', Icon: Bell, label: 'Notifications' },
];

export default function Sidebar() {
 const { user } = useAuthStore();

 // Same query key as the Topbar bell → React Query dedupes to ONE request per
 // poll, and the socket-driven invalidation keeps both in sync. The sidebar
 // previously showed no unread state at all, so on desktop the only signal was
 // the small badge in the top-right corner.
 const { data: unreadData } = useQuery({
 queryKey: ['unread-notifications'],
 queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
 refetchInterval: 60_000,
 });
 const unreadCount = unreadData?.count || 0;

  return (
  <div className="min-h-full bg-ink p-4 flex flex-col">
  {/* Logo */}
  <div className="mb-6 px-2">
  <Logo size={28} />
  </div>

  {/* Nav links */}
  <nav className="flex-1 space-y-1 min-h-0 overflow-y-auto overscroll-contain">
 {navItems.map((item) => (
 <NavLink
 key={item.to}
 to={item.to}
 aria-label={
 item.label === 'Notifications' && unreadCount > 0
 ? `Notifications, ${unreadCount} unread`
 : item.label
 }
 className={({ isActive }) =>
 `nb-sidebar-link ${isActive ? 'active' : 'text-white/90 hover:text-ink'}`
 }
 >
 <item.Icon size={20} strokeWidth={2.5} aria-hidden="true" />
 <span className="font-display text-sm">{item.label}</span>
 {item.label === 'Notifications' && unreadCount > 0 && (
 <span className="ml-auto bg-nb-pink text-white text-[10px] font-display font-bold border-nb-2 border-white px-1.5 py-0.5 min-w-[22px] text-center">
 {unreadCount > 99 ? '99+' : unreadCount}
 </span>
 )}
 </NavLink>
 ))}
 </nav>

 {/* Profile link */}
 <div className="mt-auto pt-4 border-t-nb border-ink">
 <NavLink
 to={`/profile/${user?.username}`}
 className={({ isActive }) =>
 `nb-sidebar-link ${isActive ? 'active' : 'text-white/90 hover:text-ink'}`
 }
 >
 {/* Avatar handles photoId-first resolution + token self-heal */}
 <Avatar
 photoId={user?.avatarPhotoId}
 src={user?.avatarUrl}
 color={user?.avatarColor}
 name={user?.displayName || '?'}
 size="sm"
 className="!border-white"
 />
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
 `nb-sidebar-link mt-1 ${isActive ? 'active' : 'text-white/90 hover:text-ink'}`
 }
 >
 <Settings size={20} strokeWidth={2.5} />
 <span className="font-display text-sm">Settings</span>
 </NavLink>
 </div>
 </div>
 );
}
