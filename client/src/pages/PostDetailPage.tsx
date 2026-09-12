import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ghost, MessageCircle, Reply } from 'lucide-react';
import api from '@/services/api';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import CommentRow from '@/components/feed/CommentRow';
import { useAuthStore } from '@/store/auth.store';
import { Post, Comment } from '@/types';

export default function PostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isIncognito } = useAuthStore();
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const goingBackRef = useRef(false);

  // Back button: return to where the user actually was (feed scroll, search, profile...),
  // or /home if there is no in-app history.
  const handleBack = () => {
    goingBackRef.current = true;
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/home', { replace: true });
    }
  };

  const { data: post, isLoading, error } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => api.get(`/posts/${postId}`).then((r) => r.data),
    enabled: !!postId,
  });

  const {
    data: commentsData,
    isLoading: commentsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['post-comments', postId],
    queryFn: ({ pageParam }) =>
      api
        .get(`/posts/${postId}/comments`, { params: { cursor: pageParam, limit: 20 } })
        .then((r) => r.data),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!postId,
  });

  const comments: Comment[] = commentsData?.pages.flatMap((p: any) => p.comments) || [];

  const commentMutation = useMutation({
    mutationFn: () =>
      api.post(`/posts/${postId}/comments`, {
        content: commentText,
        isAnonymous: isIncognito,
        parentCommentId: replyTo?.id,
      }),
    onSuccess: () => {
      setCommentText('');
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ['post-comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  // On mount: stash the feed's scroll position (passed via navigate state) for
  // restoration when the user comes back, and jump this page to the top.
  // If the user leaves via any path other than Back, drop the saved position.
  useEffect(() => {
    const saved = (window.history.state?.usr as { scrollY?: number } | undefined)?.scrollY;
    if (typeof saved === 'number') {
      sessionStorage.setItem('restore-scroll-y', String(saved));
    }
    window.scrollTo(0, 0);
    return () => {
      if (!goingBackRef.current) sessionStorage.removeItem('restore-scroll-y');
    };
  }, []);

  if (isLoading) return <LoadingSpinner />;

  if (error || !post) {
    return (
      <div>
        <button onClick={handleBack} className="nb-btn text-sm mb-4 inline-flex items-center gap-1.5">
          <ArrowLeft size={16} strokeWidth={2.5} /> Back
        </button>
        <EmptyState icon={<MessageCircle strokeWidth={2.5} />} title="Post not found" description="It may have been deleted." />
      </div>
    );
  }

  const typedPost = post as Post;

  return (
    <div>
      {/* Sticky back header */}
      <button
        onClick={handleBack}
        className="nb-btn bg-white text-sm px-3 py-1.5 mb-4 inline-flex items-center gap-1.5"
      >
        <ArrowLeft size={16} strokeWidth={2.5} /> Back
      </button>

      {/* The post */}
      <PostCard post={typedPost} detailView />

      {/* Comments */}
      <div className="mt-4" id="post-comments">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2">
          <MessageCircle size={18} strokeWidth={2.5} /> Comments ({typedPost._count.comments})
        </h2>

        {commentsLoading ? (
          <LoadingSpinner size="sm" />
        ) : comments.length === 0 ? (
          <p className="font-body text-sm text-gray-500 py-4">No comments yet. Start the conversation.</p>
        ) : (
          <div className="space-y-4">
            {comments.map((c) => {
              const isAnon = c.isAnonymous || !c.author;
              return (
                <div key={c.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CommentRow comment={c} interactive />
                    </div>
                    <button
                      onClick={() => setReplyTo(replyTo?.id === c.id ? null : c)}
                      className="text-gray-400 hover:text-nb-orange transition-colors shrink-0 pt-0.5"
                      title="Reply"
                    >
                      <Reply size={14} strokeWidth={2.5} />
                    </button>
                  </div>

                  {/* One level of replies */}
                  {replyTo?.id === c.id && (
                    <div className="mt-2 ml-8 nb-card bg-white p-2.5 animate-slide-up">
                      <p className="text-xs font-display font-semibold mb-1.5 text-gray-500">
                        Replying to {isAnon ? 'Anonymous Student' : c.author!.displayName}
                      </p>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          className="nb-input text-sm py-1.5 flex-1"
                          placeholder="Write a reply..."
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && commentText.trim()) commentMutation.mutate();
                          }}
                        />
                        <button
                          onClick={() => commentText.trim() && commentMutation.mutate()}
                          disabled={!commentText.trim() || commentMutation.isPending}
                          className="nb-btn-orange text-sm px-3 disabled:opacity-50"
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="nb-btn-ghost w-full text-center text-sm"
              >
                {isFetchingNextPage ? 'Loading...' : 'Load more comments'}
              </button>
            )}
          </div>
        )}

        {/* Main comment box */}
        <div className="mt-4 pt-4 border-t-2 border-gray-100">
          {replyTo && (
            <p className="text-xs font-display font-semibold text-gray-500 mb-2">
              Replying to {replyTo.isAnonymous || !replyTo.author ? 'Anonymous Student' : replyTo.author.displayName}{' '}
              <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-nb-red ml-1">
                cancel
              </button>
            </p>
          )}
          <div className="flex gap-2">
            <input
              className="nb-input text-sm py-2 flex-1"
              placeholder={isIncognito ? 'Commenting anonymously...' : 'Write a comment...'}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && commentText.trim()) commentMutation.mutate();
              }}
            />
            <button
              onClick={() => commentText.trim() && commentMutation.mutate()}
              disabled={!commentText.trim() || commentMutation.isPending}
              className="nb-btn-orange text-sm px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {isIncognito ? <Ghost size={16} strokeWidth={2.5} /> : <MessageCircle size={16} strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
