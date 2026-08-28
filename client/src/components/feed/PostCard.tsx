import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import toast from 'react-hot-toast';
import { Post } from '@/types';
import { formatDistanceToNow } from '@/utils/date';

interface Props {
  post: Post;
}

export default function PostCard({ post }: Props) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const { user, isIncognito } = useAuthStore();
  const queryClient = useQueryClient();

  const likeMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/like`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

  const commentMutation = useMutation({
    mutationFn: () =>
      api.post(`/posts/${post.id}/comments`, {
        content: commentText,
        isAnonymous: isIncognito,
      }),
    onSuccess: () => {
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success('Commented! 💬');
    },
  });

  const authorName = post.isAnonymous ? 'Anonymous Student' : post.author.displayName;
  const authorUsername = post.isAnonymous ? null : post.author.username;
  const authorAvatar = post.isAnonymous ? null : post.author.avatarUrl;

  return (
    <div className={`nb-card p-4 mb-4 animate-slide-up ${post.type === 'CONFESSION' ? 'border-nb-purple' : ''}`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        {post.isAnonymous ? (
          <div className="w-10 h-10 rounded-full bg-nb-purple border-nb-2 border-nb-black flex items-center justify-center text-white text-lg shrink-0">
            👻
          </div>
        ) : (
          <Link to={`/profile/${post.author.username}`}>
            <Avatar src={post.author.avatarUrl} name={post.author.displayName} />
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
              <span className="nb-badge bg-nb-purple text-white text-[10px]">👻 CONFESS</span>
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
      <div className="mt-3">
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
      <div className="flex items-center gap-4 mt-4 pt-3 border-t-2 border-gray-100">
        <button
          onClick={() => likeMutation.mutate()}
          className={`flex items-center gap-1.5 font-display text-sm font-semibold transition-colors ${
            post.isLikedByMe ? 'text-nb-red' : 'text-gray-500 hover:text-nb-red'
          }`}
        >
          <span className={post.isLikedByMe ? 'animate-pop' : ''}>
            {post.isLikedByMe ? '❤️' : '🤍'}
          </span>
          {post._count.likes}
        </button>

        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 font-display text-sm font-semibold text-gray-500 hover:text-nb-blue"
        >
          💬 {post._count.comments}
        </button>
      </div>

      {/* Comment input */}
      {showComments && (
        <div className="mt-3 pt-3 border-t-2 border-gray-100 animate-slide-up">
          <div className="flex gap-2">
            <input
              type="text"
              className="nb-input text-sm py-2 flex-1"
              placeholder={isIncognito ? 'Commenting anonymously...' : 'Write a comment...'}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && commentText.trim()) {
                  commentMutation.mutate();
                }
              }}
            />
            <button
              onClick={() => {
                if (commentText.trim()) commentMutation.mutate();
              }}
              disabled={!commentText.trim()}
              className="nb-btn-orange text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {isIncognito ? '👻' : '💬'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
