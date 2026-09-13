import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ghost, MessageCircle, Heart, ChevronRight } from 'lucide-react';
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

  const likeMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/like`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

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
          onClick={() => likeMutation.mutate()}
          className={`flex items-center gap-1.5 font-display text-sm font-semibold transition-colors ${
            post.isLikedByMe ? 'text-nb-red' : 'text-gray-500 hover:text-nb-red'
          }`}
        >
          <span className={post.isLikedByMe ? 'animate-pop' : ''}>
            <Heart size={18} strokeWidth={2.5} className={post.isLikedByMe ? 'fill-current' : ''} />
          </span>
          {post._count.likes}
        </button>

        {!detailView && (
          <>
            <button
              onClick={openPost}
              className="flex items-center gap-1.5 font-display text-sm font-semibold text-gray-500 hover:text-nb-blue"
            >
              <MessageCircle size={18} strokeWidth={2.5} /> {post._count.comments}
            </button>
            <ChevronRight size={18} strokeWidth={2.5} className="ml-auto text-gray-400" />
          </>
        )}
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
