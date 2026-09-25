import { safeLocalStorage, safeSessionStorage } from '@/utils/safeStorage';
import { useEffect, useRef, useCallback, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import api from '@/services/api';
import { getSocket, onDebouncedEvent } from '@/services/realtime';
import { useSocketLive } from '@/hooks/useSocketLive';
import CreatePost from '@/components/feed/CreatePost';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';

/** Feed sections. "All" shows everything; a type tab shows ONLY that type,
 * and whatever you post from the composer while it's active gets that type. */
const FEED_TABS = [
 { key: 'all', label: 'All' },
 { key: 'QUESTION', label: 'Questions' },
 { key: 'CONFESSION', label: 'Confessions' },
] as const;

type FeedTab = (typeof FEED_TABS)[number]['key'];

export default function HomePage() {
 const observerRef = useRef<IntersectionObserver | null>(null);
 const loadMoreRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<FeedTab>('all');
  const queryClient = useQueryClient();
  const socketLive = useSocketLive();

  // LIVE FEED (push): the server emits feed-new whenever anyone on campus
  // posts. Pushes are debounced + jittered so one viral post doesn't stampede
  // every connected client into a simultaneous full refetch; the interval
  // below only runs while the socket is DOWN (missed-event fallback).
  useEffect(() => {
  const socket = getSocket();
  if (!socket) return;
  return onDebouncedEvent(socket, 'feed-new', () => {
  queryClient.invalidateQueries({ queryKey: ['feed'] });
  }, 6000);
  }, [queryClient]);

  const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isFetching,
  dataUpdatedAt,
  } = useInfiniteQuery({
  queryKey: ['feed', tab],
  queryFn: ({ pageParam }) =>
  api.get('/posts', { params: { cursor: pageParam, limit: 20, ...(tab !== 'all' && { type: tab }) } }).then((r) => r.data),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  initialPageParam: undefined as string | undefined,
  // PERF: switching tabs shows the cached list immediately and refetches in
  // the background, instead of blanking to a spinner every switch.
  placeholderData: (prev) => prev,
  // LIVE FEED: push events above handle the instant case. The interval runs
  // ONLY while disconnected (missed-event fallback); window-focus refetch
  // covers returning users. At launch scale a fixed 60s poll per user is a
  // self-inflicted DDoS — never run it while push is healthy.
  refetchInterval: socketLive ? false : 60_000,
  refetchOnWindowFocus: true,
  });

 const posts = data?.pages.flatMap((p) => p.posts) || [];

 // Returning from a post detail page: restore the exact scroll position the
 // user left from, fetching more pages if the feed isn't tall enough yet.
 const restoredRef = useRef(false);
 useEffect(() => {
 if (restoredRef.current || isLoading) return;
 const saved = safeSessionStorage.getItem('restore-scroll-y');
 if (saved === null) {
 restoredRef.current = true;
 return;
 }
 const y = parseInt(saved, 10);
 if (!Number.isFinite(y)) {
 safeSessionStorage.removeItem('restore-scroll-y');
 restoredRef.current = true;
 return;
 }
 const canReach = document.documentElement.scrollHeight >= y + window.innerHeight;
 if (canReach || !hasNextPage) {
 window.scrollTo(0, y);
 safeSessionStorage.removeItem('restore-scroll-y');
 restoredRef.current = true;
 } else {
 fetchNextPage();
 }
 }, [isLoading, posts.length, hasNextPage, fetchNextPage]);

 const handleObserver = useCallback(
 (entries: IntersectionObserverEntry[]) => {
 const [entry] = entries;
 if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
 fetchNextPage();
 }
 },
 [hasNextPage, isFetchingNextPage, fetchNextPage]
 );

 useEffect(() => {
 observerRef.current = new IntersectionObserver(handleObserver, { threshold: 0.5 });
 if (loadMoreRef.current) observerRef.current.observe(loadMoreRef.current);
 return () => observerRef.current?.disconnect();
 }, [handleObserver]);

  return (
  <div className="min-w-0 overflow-x-clip">
  <CreatePost type={tab === 'all' ? 'NORMAL' : tab} />

  {/* Feed sections — Reddit-style tabs. Scrollable row, never wraps. */}
  <div className="flex gap-2 mb-4 overflow-x-auto overscroll-x-contain pb-1.5 -mx-1 px-1" role="tablist" aria-label="Feed sections">
 {FEED_TABS.map((t) => (
 <button
 key={t.key}
 onClick={() => setTab(t.key)}
 className={`shrink-0 px-4 py-1.5 border-nb-2 border-ink font-display text-xs font-bold transition-colors ${
 tab === t.key ? 'bg-nb-yellow text-ink' : 'bg-white text-gray-600 hover:bg-gray-50'
 }`}
 >
 {t.label}
 </button>
 ))}
 </div>

 {isLoading ? (
 <LoadingSpinner />
 ) : posts.length === 0 && !isFetching ? (
 <EmptyState
 icon={<FileText strokeWidth={2.5} />}
 title={
 tab === 'QUESTION' ? 'No questions yet'
 : tab === 'CONFESSION' ? 'No confessions yet'
 : 'Nothing here yet'
 }
 description={
 tab === 'QUESTION' ? 'Ask the first question — anything you post while this tab is open becomes a question.'
 : tab === 'CONFESSION' ? 'Drop the first confession — anything you post while this tab is open is anonymous.'
 : 'Be the first to drop a post. Start a conversation, share something, or just say hi.'
 }
 />
 ) : (
 <>
 {posts.map((post) => (
 <PostCard key={post.id} post={post} activeTab={tab} />
 ))}

 <div ref={loadMoreRef} className="py-4">
 {isFetchingNextPage && <LoadingSpinner size="sm" />}
 {!hasNextPage && posts.length > 0 && (
 <p className="text-center text-xs text-gray-400 font-body">You're all caught up</p>
 )}
 </div>
 </>
 )}
 </div>
 );
}
