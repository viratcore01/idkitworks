import { Link } from 'react-router-dom';
import { Ghost } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import { Comment } from '@/types';
import { formatDistanceToNow } from '@/utils/date';

/**
 * One comment line used in the feed previews and the post detail page.
 * Set `interactive` to enable profile links and full text (detail page);
 * previews use the clipped, non-navigating variant.
 */
export default function CommentRow({
  comment,
  interactive = false,
}: {
  comment: Comment;
  interactive?: boolean;
}) {
  const isAnon = comment.isAnonymous || !comment.author;
  const name = isAnon ? 'Anonymous Student' : comment.author!.displayName;
  const body = (
    <>
      <span className="font-display font-semibold text-nb-black">{name}</span>{' '}
      <span className={`font-body text-gray-600 ${interactive ? '' : 'line-clamp-1'}`}>
        {comment.content}
      </span>
    </>
  );

  return (
    <div className="flex items-start gap-2.5 min-w-0">
      {isAnon ? (
        <div className="w-6 h-6 shrink-0 rounded-full bg-nb-purple border-nb-2 border-nb-black flex items-center justify-center text-white">
          <Ghost size={12} strokeWidth={2.5} />
        </div>
      ) : (
        <Link
          to={`/profile/${comment.author!.username}`}
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Avatar src={comment.author!.avatarUrl} name={comment.author!.displayName} size="sm" className="!w-6 !h-6 !text-[10px]" />
        </Link>
      )}
      <p className="text-xs leading-relaxed min-w-0 pt-0.5">
        {isAnon || !interactive ? body : <Link to={`/profile/${comment.author!.username}`} className="hover:text-nb-orange" onClick={(e) => e.stopPropagation()}>{body}</Link>}
      </p>
      <span className="text-[10px] text-gray-400 shrink-0 pt-1">{formatDistanceToNow(comment.createdAt)}</span>
    </div>
  );
}
