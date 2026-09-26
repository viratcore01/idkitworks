import { safeLocalStorage, safeSessionStorage } from '@/utils/safeStorage';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ghost, MessageCircle, Reply, X, MoreVertical, Pencil, Trash2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import CommentRow from '@/components/feed/CommentRow';
import MentionSuggestions from '@/components/common/MentionSuggestions';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useAuthStore } from '@/store/auth.store';
import { Post, Comment } from '@/types';

/** "Name: first line" — the minimal reply chip text. */
function replyChipText(c: Comment): string {
 const who = c.isAnonymous || !c.author ? 'Anonymous Student' : c.author.displayName;
 const firstLine = c.content.split('\n')[0].trim();
 return `${who}: ${firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine}`;
}

export default function PostDetailPage() {
 const { postId } = useParams<{ postId: string }>();
 const navigate = useNavigate();
 const queryClient = useQueryClient();
 const { user, isIncognito } = useAuthStore();
 const [commentText, setCommentText] = useState('');
 const [replyTo, setReplyTo] = useState<Comment | null>(null);
 const [highlightId, setHighlightId] = useState<string | null>(null);
 const [menuFor, setMenuFor] = useState<string | null>(null);
 const [editingId, setEditingId] = useState<string | null>(null);
 const [editText, setEditText] = useState('');
  const commentInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchParams] = useSearchParams();

  // @mention autocomplete in the comment box — panel floats above the field.
  const mention = useMentionAutocomplete({ value: commentText, inputRef: commentInputRef, onChange: setCommentText });
 const replyClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
 .get(`/posts/${postId}/comments`, { params: { cursor: pageParam, limit: 50 } })
 .then((r) => r.data),
 getNextPageParam: (lastPage) => lastPage.nextCursor,
 initialPageParam: undefined as string | undefined,
 enabled: !!postId,
 });

 // Nest: top-level comments with their replies attached.
 const { threads, replyCount } = useMemo(() => {
 const all: Comment[] = commentsData?.pages.flatMap((p: any) => p.comments) || [];
 const byId = new Map<string, Comment & { replies: Comment[] }>();
 for (const c of all) byId.set(c.id, { ...c, replies: [] });
 const roots: (Comment & { replies: Comment[] })[] = [];
 let replies = 0;
 for (const c of byId.values()) {
 if (c.parentCommentId && byId.has(c.parentCommentId)) {
 byId.get(c.parentCommentId)!.replies.push(c);
 replies++;
 } else {
 roots.push(c);
 }
 }
  return { threads: roots, replyCount: replies };
  }, [commentsData]);

  // Deep link from a MENTION notification: /post/:id?comment=:commentId
  // scrolls to that exact comment (auto-paging a few times if needed).
  const mentionTarget = searchParams.get('comment');
  const mentionJumped = useRef(false);
  const mentionPages = useRef(0);
  useEffect(() => {
  if (!mentionTarget || mentionJumped.current || commentsLoading) return;
  if (document.getElementById(`comment-${mentionTarget}`)) {
  mentionJumped.current = true;
  const id = mentionTarget;
  setTimeout(() => jumpToComment(id), 150);
  return;
  }
  if (hasNextPage && !isFetchingNextPage && mentionPages.current < 3) {
  mentionPages.current++;
  fetchNextPage();
  return;
  }
  // Not on any reachable page (deleted or out of range) — stop hunting.
  mentionJumped.current = true;
  }, [mentionTarget, commentsLoading, commentsData, hasNextPage, isFetchingNextPage]);

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

 const editMutation = useMutation({
 mutationFn: ({ id, content }: { id: string; content: string }) =>
 api.patch(`/posts/comments/${id}`, { content }),
 onSuccess: () => {
 setEditingId(null);
 setEditText('');
 queryClient.invalidateQueries({ queryKey: ['post-comments', postId] });
 queryClient.invalidateQueries({ queryKey: ['feed'] });
 },
 onError: (e: any) => toast(e.response?.data?.error || 'Could not edit comment'),
 });

 const deleteCommentMutation = useMutation({
 mutationFn: (id: string) => api.delete(`/posts/comments/${id}`),
 onSuccess: () => {
 toast('Comment deleted');
 queryClient.invalidateQueries({ queryKey: ['post-comments', postId] });
 queryClient.invalidateQueries({ queryKey: ['post', postId] });
 queryClient.invalidateQueries({ queryKey: ['feed'] });
 },
 onError: (e: any) => toast(e.response?.data?.error || 'Could not delete comment'),
 });

 /** Double-click a comment (or click a reply chip): focus the composer in reply mode. */
 const startReply = (c: Comment) => {
 setReplyTo(c);
 commentInputRef.current?.focus();
 };

 /** Single-click a reply: jump to the message it replies to. Double-click still wins. */
 const handleRowClick = (c: Comment) => {
 if (!c.parentCommentId) return;
 if (replyClickTimer.current) {
 // Second click of a double-click — cancel the pending jump.
 clearTimeout(replyClickTimer.current);
 replyClickTimer.current = null;
 return;
 }
 replyClickTimer.current = setTimeout(() => {
 replyClickTimer.current = null;
 jumpToComment(c.parentCommentId!);
 }, 250);
 };

 /** Scroll to a comment and glow it for ~2s. */
 const jumpToComment = (id: string) => {
 const el = document.getElementById(`comment-${id}`);
 if (!el) return;
 el.scrollIntoView({ behavior: 'smooth', block: 'center' });
 setHighlightId(id);
 if (highlightTimer.current) clearTimeout(highlightTimer.current);
 highlightTimer.current = setTimeout(() => setHighlightId(null), 2000);
 };

 // Close the 3-dot menu on any outside click
 useEffect(() => {
 if (!menuFor) return;
 const close = () => setMenuFor(null);
 window.addEventListener('click', close);
 return () => window.removeEventListener('click', close);
 }, [menuFor]);

 // Focus the inline edit box when editing starts
 useEffect(() => {
 if (editingId) editInputRef.current?.focus();
 }, [editingId]);

 useEffect(() => {
 const saved = (window.history.state?.usr as { scrollY?: number } | undefined)?.scrollY;
 if (typeof saved === 'number') {
 safeSessionStorage.setItem('restore-scroll-y', String(saved));
 }
 window.scrollTo(0, 0);
 return () => {
 if (!goingBackRef.current) safeSessionStorage.removeItem('restore-scroll-y');
 if (highlightTimer.current) clearTimeout(highlightTimer.current);
 if (replyClickTimer.current) clearTimeout(replyClickTimer.current);
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

 const saveCommentEdit = () => {
 if (editingId && editText.trim()) {
 editMutation.mutate({ id: editingId, content: editText.trim() });
 } else {
 setEditingId(null);
 }
 };

 const renderComment = (c: Comment & { replies?: Comment[] }, isReply = false) => {
 const highlighted = highlightId === c.id;
 // The server decides ownership — anonymous comments mask authorId, so a
 // client-side authorId comparison would unmask nothing but also match nothing.
 const isOwn = !!(c as any).isMine;
 const isDeleted = !!(c as any).isDeleted;
 const isEditing = editingId === c.id;

  return (
  <div key={c.id} id={`comment-${c.id}`} className={!isReply ? 'space-y-3' : ''}>
  <div
  className={`group relative px-2 py-1.5 -mx-2 transition-colors min-w-0 ${
  highlighted ? 'comment-highlight' : ''
  } ${isReply ? 'ml-4 sm:ml-9' : ''}`}
  >
  <div className="flex items-start justify-between gap-2 min-w-0">
  <div
  className={`flex-1 min-w-0 cursor-default select-none ${isReply && !isEditing && !isDeleted ? 'hover:bg-nb-yellow/20 px-1 -mx-1 transition-colors' : ''}`}
 onClick={() => handleRowClick(c)}
 onDoubleClick={() => {
 if (replyClickTimer.current) {
 clearTimeout(replyClickTimer.current);
 replyClickTimer.current = null;
 }
 if (!isDeleted && !isEditing) startReply(c);
 }}
 title={isDeleted ? undefined : isReply ? 'Click to jump to the original · double-click to reply' : 'Double-click to reply'}
 >
 {isEditing ? (
 <div className="flex items-center gap-2">
 <input
 ref={editInputRef}
 className="nb-input text-sm py-1.5 flex-1"
 value={editText}
 onChange={(e) => setEditText(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter') saveCommentEdit();
 if (e.key === 'Escape') setEditingId(null);
 }}
 />
 <button onClick={saveCommentEdit} title="Save" className="text-ink hover:scale-110 transition-transform shrink-0">
 <Check size={16} strokeWidth={2.5} />
 </button>
 <button onClick={() => setEditingId(null)} title="Cancel" className="text-gray-500 hover:text-nb-pink transition-colors shrink-0">
 <X size={16} strokeWidth={2.5} />
 </button>
 </div>
 ) : isDeleted ? (
 <p className="font-body text-sm italic text-gray-500">This comment was deleted</p>
 ) : (
 // Non-interactive: single clicks must not navigate away, the row is a reply gesture
 <CommentRow comment={c} clamped={false} edited={!!(c as any).editedAt} />
 )}
 </div>
 {isOwn && !isDeleted && !isEditing ? (
 <div className="relative shrink-0">
 <button
 onClick={(e) => {
 e.stopPropagation();
 setMenuFor(menuFor === c.id ? null : c.id);
 }}
 className="text-gray-600 hover:text-ink p-0.5 opacity-70 hover:opacity-100 transition-opacity"
 title="Comment options"
 >
 <MoreVertical size={14} strokeWidth={2.5} />
 </button>
 {menuFor === c.id && (
 <div
 className="absolute right-0 top-6 z-20 nb-card bg-white py-1 min-w-[140px]"
 onClick={(e) => e.stopPropagation()}
 >
 <button
 onClick={() => {
 setEditingId(c.id);
 setEditText(c.content);
 setMenuFor(null);
 }}
 className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body hover:bg-nb-yellow/30 text-left"
 >
 <Pencil size={14} strokeWidth={2.5} /> Edit
 </button>
 <button
 onClick={() => {
 setMenuFor(null);
 deleteCommentMutation.mutate(c.id);
 }}
 className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body hover:bg-nb-pink/20 text-nb-pink text-left"
 >
 <Trash2 size={14} strokeWidth={2.5} /> Delete
 </button>
 </div>
 )}
 </div>
 ) : (
 <button
 onClick={() => !isDeleted && startReply(c)}
 className="text-gray-600 hover:text-nb-violet transition-colors shrink-0 pt-0.5 opacity-70 hover:opacity-100"
 title="Reply"
 >
 <Reply size={14} strokeWidth={2.5} />
 </button>
 )}
 </div>
 </div>

 {/* Replies nested under the parent */}
  {c.replies && c.replies.length > 0 && (
  <div className="ml-4 sm:ml-9 space-y-1 border-l-nb-2 border-gray-200 pl-2.5 sm:pl-3 min-w-0">
  {c.replies.map((r) => renderComment(r as Comment & { replies?: Comment[] }, true))}
  </div>
  )}
 </div>
 );
 };

  return (
  <div className="min-w-0 overflow-x-clip">
  {/* Sticky back header */}
  <button
  onClick={handleBack}
  className="nb-btn bg-white text-sm px-3 py-1.5 mb-4 inline-flex items-center gap-1.5 sticky top-[4.5rem] z-30"
  >
 <ArrowLeft size={16} strokeWidth={2.5} /> Back
 </button>

 {/* The post */}
 <PostCard post={typedPost} detailView />

  {/* Comments — own white surface so text reads on white, not on the doodle canvas */}
  <div className="mt-4 nb-card bg-white p-3 sm:p-5 min-w-0 overflow-hidden" id="post-comments">
 <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2">
 <MessageCircle size={18} strokeWidth={2.5} /> Comments ({typedPost._count.comments})
 </h2>

 {commentsLoading ? (
 <LoadingSpinner size="sm" />
 ) : threads.length === 0 ? (
 <p className="font-body text-sm text-gray-500 py-4">
 No comments yet. Double-click any comment to reply to it.
 </p>
 ) : (
 <div className="space-y-4">{threads.map((c) => renderComment(c))}</div>
 )}

 {hasNextPage && (
 <button
 onClick={() => fetchNextPage()}
 disabled={isFetchingNextPage}
 className="nb-btn-ghost w-full text-center text-sm mt-4"
 >
 {isFetchingNextPage ? 'Loading...' : 'Load more comments'}
 </button>
 )}

 {/* Composer */}
 <div className="mt-4 pt-4 border-t-nb-2 border-gray-300">
 {replyTo && (
 <div className="mb-2 inline-flex items-center gap-1.5 max-w-full nb-badge bg-nb-yellow text-ink">
 <Reply size={12} strokeWidth={2.5} className="shrink-0" />
 <span className="truncate">{replyChipText(replyTo)}</span>
 <button
 onClick={() => jumpToComment(replyTo.id)}
 title="Jump to comment"
 className="hover:scale-110 transition-transform shrink-0"
 >
 <MessageCircle size={12} strokeWidth={2.5} />
 </button>
 <button onClick={() => setReplyTo(null)} title="Cancel reply" className="hover:text-nb-pink shrink-0">
 <X size={12} strokeWidth={2.5} />
 </button>
 </div>
 )}
   <div className="flex gap-2 min-w-0">
   <div className="relative flex-1 min-w-0" ref={mention.containerRef}>
   {mention.open && (
   <MentionSuggestions
   query={mention.query}
   items={mention.items}
   loading={mention.loading}
   failed={mention.failed}
   highlight={mention.highlight}
   onHighlight={mention.setHighlight}
   onPick={mention.pick}
   />
   )}
   <input
   ref={commentInputRef}
   className="nb-input text-base sm:text-sm py-2 w-full min-w-0"
   placeholder={
   replyTo
   ? `Reply to ${replyTo.isAnonymous || !replyTo.author ? 'Anonymous Student' : replyTo.author!.displayName}...`
   : isIncognito
   ? 'Commenting anonymously... (type @ to mention)'
   : 'Write a comment... (double-click a comment to reply, @ to mention)'
   }
   value={commentText}
   onChange={(e) => {
   setCommentText(e.target.value);
   mention.sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
   }}
   onClick={() => mention.sync()}
   onKeyUp={() => mention.sync()}
   onKeyDown={(e) => {
   if (mention.handleKeyDown(e)) return;
   if (e.key === 'Enter' && commentText.trim()) commentMutation.mutate();
   }}
   aria-expanded={mention.open}
   aria-controls={mention.open ? 'mention-listbox' : undefined}
   />
   </div>
 <button
 onClick={() => commentText.trim() && commentMutation.mutate()}
 disabled={!commentText.trim() || commentMutation.isPending}
 className="nb-btn-orange text-sm px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1"
 >
 {replyTo ? (
 <>
 <Reply size={14} strokeWidth={2.5} /> Reply
 </>
 ) : isIncognito ? (
 <Ghost size={16} strokeWidth={2.5} />
 ) : (
 <MessageCircle size={16} strokeWidth={2.5} />
 )}
 </button>
 </div>
 </div>
 </div>
 </div>
 );
}
