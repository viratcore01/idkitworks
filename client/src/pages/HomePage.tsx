import { useEffect, useRef, useCallback, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import api from '@/services/api';
import CreatePost from '@/components/feed/CreatePost';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';

/** Reddit-style feed filters. */
const FEED_TABS = [
  { key: 'all', label: 'All' },
  { key: 'NORMAL', label: 'Posts' },
  { key: 'QUESTION', label: 'Questions' },
  { key: 'CONFESSION', label: 'Confessions' },
] as const;

type FeedTab = (typeof FEED_TABS)[number]['key'];

export default function HomePage() {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<FeedTab>('all');

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ['feed', tab],
    queryFn: ({ pageParam }) =>
      api.get('/posts', { params: { cursor: pageParam, limit: 20, ...(tab !== 'all' && { type: tab }) } }).then((r) => r.data),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    // PERF: switching tabs shows the cached list immediately and refetches in
    // the background, instead of blanking to a spinner every switch.
    placeholderData: (prev) => prev,
  });

  const posts = data?.pages.flatMap((p) => p.posts) || [];

  // Returning from a post detail page: restore the exact scroll position the
  // user left from, fetching more pages if the feed isn't tall enough yet.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || isLoading) return;
    const saved = sessionStorage.getItem('restore-scroll-y');
    if (saved === null) {
      restoredRef.current = true;
      return;
    }
    const y = parseInt(saved, 10);
    if (!Number.isFinite(y)) {
      sessionStorage.removeItem('restore-scroll-y');
      restoredRef.current = true;
      return;
    }
    const canReach = document.documentElement.scrollHeight >= y + window.innerHeight;
    if (canReach || !hasNextPage) {
      window.scrollTo(0, y);
      sessionStorage.removeItem('restore-scroll-y');
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
    <div>
      <CreatePost />

      {/* Feed filters — Reddit-style tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {FEED_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 px-4 py-1.5 rounded-full border-nb-2 border-nb-black font-display text-xs font-bold transition-colors ${
              tab === t.key ? 'bg-nb-lime text-nb-black' : 'bg-white text-gray-600 hover:bg-gray-50'
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
          title="Nothing here yet"
          description="Be the first to drop a post. Start a conversation, share something, or just say hi."
        />
      ) : (
        <>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
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
