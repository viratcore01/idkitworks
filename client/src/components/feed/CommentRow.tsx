import { Link } from 'react-router-dom';
import { Ghost } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import MentionText from '@/components/common/MentionText';
import { Comment } from '@/types';
import { formatDistanceToNow } from '@/utils/date';

/**
 * One comment line used in the feed previews and the post detail page.
 * `interactive`: author name/avatar link to the profile.
 * `clamped`: clip content to one line (feed previews).
 * `edited`: show an "edited" tag (detail page only).
 */
export default function CommentRow({
 comment,
 interactive = false,
 clamped = !interactive,
 edited = false,
}: {
 comment: Comment;
 interactive?: boolean;
 clamped?: boolean;
 edited?: boolean;
}) {
 const isAnon = comment.isAnonymous || !comment.author;
 const name = isAnon ? 'Anonymous Student' : comment.author!.displayName;
  const body = (
  <>
  <span className="font-display font-semibold text-ink break-words">{name}</span>{' '}
   <span className={`font-body text-gray-600 break-words overflow-wrap-anywhere ${clamped ? 'line-clamp-1' : ''}`}>
   <MentionText text={comment.content} linkClassName="text-nb-violet font-semibold hover:underline break-words" />
   </span>
  {edited && <span className="text-xs italic text-gray-500 ml-1 whitespace-nowrap">· edited</span>}
  </>
  );

  return (
  <div className="flex items-start gap-2 min-w-0">
 {isAnon ? (
 <div className="w-6 h-6 shrink-0 bg-nb-lilac border-nb-2 border-ink flex items-center justify-center text-white">
 <Ghost size={12} strokeWidth={2.5} />
 </div>
 ) : (
 <Link
 to={`/profile/${comment.author!.username}`}
 className="shrink-0"
 onClick={(e) => e.stopPropagation()}
 >
 <Avatar src={comment.author!.avatarUrl} photoId={comment.author!.avatarPhotoId} name={comment.author!.displayName} size="sm" className="!w-6 !h-6 !text-[10px]" />
 </Link>
 )}
  <p className="text-xs leading-relaxed min-w-0 flex-1 pt-0.5 break-words overflow-wrap-anywhere">
  {isAnon || !interactive ? body : <Link to={`/profile/${comment.author!.username}`} className="hover:text-nb-violet break-words" onClick={(e) => e.stopPropagation()}>{body}</Link>}
  </p>
  <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap pt-1">{formatDistanceToNow(comment.createdAt)}</span>
 </div>
 );
}
