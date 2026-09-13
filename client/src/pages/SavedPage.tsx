import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bookmark, FileText } from 'lucide-react';
import api from '@/services/api';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';

/**
 * Saved/bookmarked posts (Reddit/Instagram "Save").
 * Only live, in-college posts surface — the server filters deleted and
 * cross-college content even if a bookmark outlives it.
 */
export default function SavedPage() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['saved-posts'],
    queryFn: ({ pageParam }) =>
      api.get('/posts/saved/list', { params: { cursor: pageParam, limit: 20 } }).then((r) => r.data),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
  });

  const posts = data?.pages.flatMap((p: any) => p.posts) || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-nb-blue/15 flex items-center justify-center shrink-0">
          <Bookmark size={22} className="text-nb-blue" fill="currentColor" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold">Saved</h1>
          <p className="text-sm opacity-60">Posts you bookmarked — only you can see this list.</p>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Bookmark strokeWidth={2.5} />}
          title="Nothing saved yet"
          description="Tap the bookmark on any post to keep it here for later."
        />
      ) : (
        <>
          {posts.map((post: any) => (
            <PostCard key={post.id} post={post} />
          ))}
          <div className="py-4">
            {isFetchingNextPage && <LoadingSpinner size="sm" />}
            {!hasNextPage && (
              <p className="text-center text-xs text-gray-400 font-body">
                That's everything you've saved
              </p>
            )}
          </div>
        </>
      )}

      <p className="text-center text-xs text-gray-400 font-body mt-2">
        <Link to="/home" className="hover:text-nb-orange">Back to feed</Link>
      </p>
    </div>
  );
}
