import { useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import api from '@/services/api';
import CreatePost from '@/components/feed/CreatePost';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { MOCK_POSTS } from '@/data/mock';

export default function ConfessionsPage() {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['confessions'],
    queryFn: ({ pageParam }) =>
      api
        .get('/posts', { params: { cursor: pageParam, limit: 20, type: 'CONFESSION' } })
        .then((r) => r.data),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    retry: false,
  });

  const apiPosts = data?.pages.flatMap((p) => p.posts) || [];
  const allConfessions = MOCK_POSTS.filter((p) => p.type === 'CONFESSION' || p.isAnonymous);
  const posts = apiPosts.length > 0 ? apiPosts : allConfessions;

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
      <div className="mb-4">
        <h1 className="font-display font-bold text-2xl text-nb-black">👻 Confessions</h1>
        <p className="font-body text-sm text-gray-500">Anonymous posts from students</p>
      </div>

      <CreatePost type="CONFESSION" />

      {isLoading ? (
        <LoadingSpinner />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="👻"
          title="No confessions yet"
          description="Be the first to confess something! All confessions are anonymous."
        />
      ) : (
        <>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
          <div ref={loadMoreRef} className="py-4">
            {isFetchingNextPage && <LoadingSpinner size="sm" />}
          </div>
        </>
      )}
    </div>
  );
}
