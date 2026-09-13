import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ghost, MessageCircle, Heart, ChevronRight, Bookmark, Share2, Flag } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import { Post } from '@/types';
import { formatDistanceToNow } from '@/utils/date';
import CommentRow from '@/components/feed/CommentRow';

interface Props {
  post: Post;
  /** Post detail page: hides inline previews (comments render below) and keeps inline reply box */
  detailView?: boolean;
}

export default function PostCard({ post, detailView = false }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const openPost = () => navigate(`/post/${post.id}`, { state: { scrollY: window.scrollY } });

  const [menuOpen, setMenuOpen] = useState(false);

  const likeMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/like`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/save`).then((r) => r.data),
    onSuccess: (data) => {
      toast(data.saved ? 'Saved' : 'Removed from saved');
      // Saved list is its own page — refresh it wherever it's cached
      queryClient.invalidateQueries({ queryKey: ['saved-posts'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
    },
    onError: () => toast.error('Could not save post'),
  });

  const reportMutation = useMutation({
    mutationFn: () => api.post('/admin/reports', { targetType: 'POST', targetId: post.id, reason: 'INAPPROPRIATE' }),
    onSuccess: () => {
      toast.success('Reported to moderators');
      setMenuOpen(false);
    },
    onError: (e: any) => {
      if (e?.response?.status !== 409) toast.error(e.response?.data?.error || 'Could not report');
      setMenuOpen(false);
    },
  });

  // Author delete — the ⋯ menu shows Delete only for your own posts (isMine
  // is computed server-side, so anonymous posts stay anonymous but their
  // authors can still remove them). Soft-delete server-side; the post 404s
  // for everyone afterwards.
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/posts/${post.id}`),
    onSuccess: () => {
      toast.success('Post deleted');
      setMenuOpen(false);
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
      queryClient.invalidateQueries({ queryKey: ['saved-posts'] });
      queryClient.invalidateQueries({ queryKey: ['profile-posts'] });
      queryClient.invalidateQueries({ queryKey: ['anonymous-posts'] });
      // If we're on the post's detail page, it's gone — go home.
      if (detailView) navigate('/home', { replace: true });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not delete post'),
  });

  const sharePost = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Skola', text: post.content.slice(0, 80), url });
      } else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch {
      /* user cancelled the share sheet — not an error */
    }
  };

  const authorName = post.isAnonymous ? 'Anonymous Student' : post.author.displayName;
  const authorUsername = post.isAnonymous ? null : post.author.username;
  const authorAvatar = post.isAnonymous ? null : post.author.avatarUrl;

  return (
    <div className={`nb-card p-4 mb-4 animate-slide-up ${post.type === 'CONFESSION' ? 'border-nb-purple' : ''}`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        {post.isAnonymous ? (
          <div className="w-10 h-10 rounded-full bg-nb-purple border-nb-2 border-nb-black flex items-center justify-center text-white shrink-0">
            <Ghost size={20} strokeWidth={2.5} />
          </div>
        ) : (
          <Link to={`/profile/${post.author.username}`}>
            <Avatar src={post.author.avatarUrl} photoId={post.author.avatarPhotoId} name={post.author.displayName} />
          </Link>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-sm">
              {authorUsername ? (
                <Link to={`/profile/${authorUsername}`} className="hover:text-nb-orange">
                  {authorName}
                </Link>
              ) : (
                authorName
              )}
            </span>
            {post.type === 'CONFESSION' && (
              <span className="nb-badge bg-nb-purple text-white text-[10px] inline-flex items-center gap-1">
                <Ghost size={12} strokeWidth={2.5} /> CONFESS
              </span>
            )}
          </div>
          {!post.isAnonymous && post.author.college && (
            <p className="text-xs text-gray-500 font-body">
              {post.author.course || ''} {post.author.course && '•'}{' '}
              {post.author.college.shortName || post.author.college.name}
              {post.author.year && ` • ${post.author.year}${post.author.year === 1 ? 'st' : post.author.year === 2 ? 'nd' : post.author.year === 3 ? 'rd' : 'th'} Year`}
            </p>
          )}
        </div>

        <span className="text-xs text-gray-400 font-body shrink-0">
          {formatDistanceToNow(post.createdAt)}
        </span>
      </div>

      {/* Content */}
      <div
        className="mt-3"
        onClick={detailView ? undefined : openPost}
        role={detailView ? undefined : 'link'}
        aria-label={detailView ? undefined : 'Open post'}
      >
        <p className="font-body text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
      </div>

      {/* Media */}
      {post.mediaUrl && (
        <div className="mt-3 border-nb-2 border-nb-black rounded-nb overflow-hidden">
          {post.mediaType === 'IMAGE' && (
            <img src={post.mediaUrl} alt="" className="w-full object-cover" />
          )}
          {post.mediaType === 'VIDEO' && (
            <video src={post.mediaUrl} controls className="w-full" />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t-2 border-gray-300">
        <button
          onClick={() => !likeMutation.isPending && likeMutation.mutate()}
          disabled={likeMutation.isPending}
          className={`flex items-center gap-1.5 font-display text-sm font-semibold transition-colors ${
            post.isLikedByMe ? 'text-nb-red' : 'text-gray-500 hover:text-nb-red'
          } disabled:opacity-60`}
        >
          <span className={post.isLikedByMe ? 'animate-pop' : ''}>
            <Heart size={18} strokeWidth={2.5} className={post.isLikedByMe ? 'fill-current' : ''} />
          </span>
          {post._count.likes}
        </button>

        {!detailView && (
          <button
            onClick={openPost}
            className="flex items-center gap-1.5 font-display text-sm font-semibold text-gray-500 hover:text-nb-blue"
          >
            <MessageCircle size={18} strokeWidth={2.5} /> {post._count.comments}
          </button>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => !saveMutation.isPending && saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className={`p-1.5 rounded-full transition-colors ${
              post.isSavedByMe ? 'text-nb-blue' : 'text-gray-500 hover:text-nb-blue'
            } disabled:opacity-60`}
            title={post.isSavedByMe ? 'Remove from saved' : 'Save post'}
          >
            <Bookmark size={17} strokeWidth={2.5} className={post.isSavedByMe ? 'fill-current' : ''} />
          </button>
          <button
            onClick={sharePost}
            className="p-1.5 rounded-full text-gray-500 hover:text-nb-black transition-colors"
            title="Share"
          >
            <Share2 size={17} strokeWidth={2.5} />
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-1.5 rounded-full text-gray-500 hover:text-nb-red transition-colors"
              title="More options"
            >
              <Flag size={16} strokeWidth={2.5} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 bottom-8 z-30 nb-card bg-white py-1.5 min-w-[150px] flex flex-col">
                  {post.isMine && (
                    <button
                      onClick={() => {
                        if (window.confirm('Delete this post? This cannot be undone.')) {
                          deleteMutation.mutate();
                        } else {
                          setMenuOpen(false);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="py-1.5 px-3 text-left text-sm font-body text-nb-red hover:bg-red-50 disabled:opacity-60"
                    >
                      {deleteMutation.isPending ? 'Deleting…' : 'Delete post'}
                    </button>
                  )}
                  <button
                    onClick={() => reportMutation.mutate()}
                    disabled={reportMutation.isPending}
                    className="py-1.5 px-3 text-left text-sm font-body text-nb-red hover:bg-red-50"
                  >
                    Report post
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Comment previews — feed only, teases the discussion */}
      {!detailView && (post.topComments?.length || 0) > 0 && (
        <div
          className="mt-3 pt-3 border-t-2 border-gray-300 space-y-2 cursor-pointer"
          onClick={openPost}
          role="link"
          aria-label="Open post to see all comments"
        >
          {post.topComments!.map((c) => (
            <CommentRow key={c.id} comment={c} />
          ))}
          {post._count.comments > post.topComments!.length && (
            <p className="text-xs font-display font-semibold text-gray-400 hover:text-nb-orange transition-colors">
              View all {post._count.comments} comments
            </p>
          )}
        </div>
      )}
    </div>
  );
}
