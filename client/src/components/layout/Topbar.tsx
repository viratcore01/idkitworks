import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Glasses, Bell, X, Users, FileText } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import { getSocket } from '@/services/realtime';
import Avatar from '@/components/common/Avatar';
import Logo from '@/components/common/Logo';
import { bestAvatarSrc, photoSrc } from '@/utils/photo';

export default function Topbar() {
 const { user, isIncognito, toggleIncognito } = useAuthStore();
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [debounced, setDebounced] = useState('');
 const [dropOpen, setDropOpen] = useState(false);
 const searchBoxRef = useRef<HTMLDivElement>(null);

 // Live search: debounce keystrokes, then hit the smart search endpoint
 useEffect(() => {
 const t = setTimeout(() => setDebounced(searchQuery.trim()), 250);
 return () => clearTimeout(t);
 }, [searchQuery]);

 const { data: live, isFetching: liveFetching } = useQuery({
 queryKey: ['live-search', debounced],
 queryFn: () => api.get(`/search?q=${encodeURIComponent(debounced)}`).then((r) => r.data),
 enabled: dropOpen && debounced.length > 0,
 staleTime: 15_000,
 });

 // Click outside closes the dropdown
 useEffect(() => {
 const onDoc = (e: MouseEvent) => {
 if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setDropOpen(false);
 };
 document.addEventListener('mousedown', onDoc);
 return () => document.removeEventListener('mousedown', onDoc);
 }, []);

 const liveUsers = (dropOpen && debounced.length > 0 && live?.users) || [];
 const livePosts = (dropOpen && debounced.length > 0 && live?.posts) || [];
 const showDrop = dropOpen && debounced.length > 0;

 const goUser = (username: string) => {
 setDropOpen(false);
 setSearchQuery('');
 navigate(`/profile/${username}`);
 };

 const goPost = (postId: string) => {
 setDropOpen(false);
 setSearchQuery('');
 navigate(`/post/${postId}`);
 };

 const handleSearch = (e: React.FormEvent) => {
 e.preventDefault();
 if (searchQuery.trim()) {
 setDropOpen(false);
 navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
 }
 };

 const { data: unreadData } = useQuery({
 queryKey: ['unread-notifications'],
 queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
 refetchInterval: 60_000,
 });
 const queryClient = useQueryClient();

 // PUSH: the server emits notification-new the moment something happens —
 // refetch immediately instead of waiting out the polling interval (which
 // now only covers missed events while the socket is down).
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const onNew = () => {
 queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
 queryClient.invalidateQueries({ queryKey: ['notifications'] });
 };
 socket.on('notification-new', onNew);
 return () => {
 socket.off('notification-new', onNew);
 };
 }, [queryClient]);

 const unreadCount = unreadData?.count || 0;

  return (
  <div
  className="fixed top-0 left-0 right-0 h-16 bg-ink z-[60] flex items-center gap-2 px-3 sm:px-4 overflow-x-clip"
  style={{ paddingLeft: 'max(0.75rem, env(safe-area-inset-left))', paddingTop: 'env(safe-area-inset-top)' }}
  >
  {/* Desktop: reserve exactly the sidebar's width so content never hides under it */}
  <div className="hidden lg:block w-64 shrink-0" aria-hidden="true">
  <Logo size={30} />
  </div>
  <Link to="/home" className="lg:hidden shrink-0 min-w-0" aria-label="Zoclo home">
  <Logo size={26} />
  </Link>

  <form onSubmit={handleSearch} className="flex-1 min-w-0 max-w-md" role="search">
 <div className="relative" ref={searchBoxRef}>
  <input
  type="text"
  placeholder="Search people, posts..."
  aria-label="Search people and posts"
  value={searchQuery}
  onChange={(e) => {
  setSearchQuery(e.target.value);
  setDropOpen(true);
  }}
  onFocus={() => setDropOpen(true)}
  className="nb-input py-2 text-base sm:text-sm pl-10 pr-8 min-w-0"
  />
 <Search size={16} strokeWidth={2.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
 {searchQuery && (
 <button
 type="button"
 onClick={() => { setSearchQuery(''); setDropOpen(false); }}
 className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-ink"
 title="Clear"
 >
 <X size={14} strokeWidth={2.5} />
 </button>
 )}

  {/* Live results dropdown — smart search as you type */}
  {showDrop && (
  <div className="absolute top-full left-0 right-0 mt-2 nb-card bg-white max-h-[60dvh] overflow-y-auto overscroll-contain z-[70] max-w-[calc(100vw-2rem)]">
 {liveFetching && !live ? (
 <p className="p-4 text-sm text-gray-500 font-body">Searching…</p>
 ) : liveUsers.length === 0 && livePosts.length === 0 ? (
 <p className="p-4 text-sm text-gray-500 font-body">
 No matches for “{debounced}” — press Enter for full search.
 </p>
 ) : (
 <>
 {liveUsers.length > 0 && (
 <div className="py-1">
  <p className="px-3 pt-1.5 pb-1 text-xs font-display font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
  <Users size={11} strokeWidth={2.5} /> People
  </p>
 {liveUsers.map((u: any) => (
 <button
 key={u.id}
 type="button"
 onClick={() => goUser(u.username)}
 className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-nb-cream text-left"
 >
 <Avatar src={u.avatarUrl} photoId={u.avatarPhotoId} color={u.avatarColor} name={u.displayName} size="sm" />
 <div className="min-w-0">
 <p className="text-sm font-display font-semibold truncate">{u.displayName}</p>
 <p className="text-[11px] text-gray-500 truncate">@{u.username}{u.course ? ` • ${u.course}` : ''}</p>
 </div>
 </button>
 ))}
 </div>
 )}
 {livePosts.length > 0 && (
 <div className="py-1 border-t-2 border-gray-200">
  <p className="px-3 pt-1.5 pb-1 text-xs font-display font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
  <FileText size={11} strokeWidth={2.5} /> Posts
  </p>
 {livePosts.slice(0, 4).map((p: any) => (
 <button
 key={p.id}
 type="button"
 onClick={() => goPost(p.id)}
 className="w-full px-3 py-2 hover:bg-nb-cream text-left"
 >
 <p className="text-xs font-body text-gray-700 line-clamp-1">{p.content}</p>
 <p className="text-[10px] text-gray-400 font-body">by {p.author.displayName}</p>
 </button>
 ))}
 </div>
 )}
 <button
 type="submit"
 className="w-full px-3 py-2 text-xs font-display font-semibold text-nb-violet border-t-2 border-gray-200 hover:bg-nb-cream text-left"
 >
 See all results for “{debounced}” →
 </button>
 </>
 )}
 </div>
 )}
 </div>
 </form>

 <div className="flex items-center gap-2 shrink-0" style={{ marginRight: 'env(safe-area-inset-right)' }}>
 <button
 onClick={toggleIncognito}
 className={`nb-btn text-sm px-3 py-1.5 ${
 isIncognito ? 'bg-nb-yellow text-ink' : 'bg-white text-ink'
 }`}
 title={isIncognito ? 'Incognito ON — all posts & comments are anonymous' : 'Turn on Incognito'}
 >
 <Glasses size={16} strokeWidth={2.5} className="inline" />
 <span className="hidden sm:inline ml-1">{isIncognito ? 'ON' : 'Off'}</span>
 </button>

 <Link to="/notifications" className="nb-btn bg-nb-yellow text-ink text-sm px-3 py-1.5 relative">
 <Bell size={16} strokeWidth={2.5} />
 {unreadCount > 0 && (
 <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-nb-pink text-white text-xs font-bold border-2 border-ink flex items-center justify-center">
 {unreadCount > 9 ? '9+' : unreadCount}
 </span>
 )}
 </Link>

 <Link to={`/profile/${user?.username}`}>
 {bestAvatarSrc(user) ? (
 <img src={bestAvatarSrc(user)!} alt="" className="w-9 h-9 nb-avatar !border-white" />
 ) : (
 <div className="w-9 h-9 bg-nb-violet border-nb-2 border-white flex items-center justify-center text-white text-sm font-bold">
 {user?.displayName?.[0]?.toUpperCase() || '?'}
 </div>
 )}
 </Link>
 </div>
 </div>
 );
}
