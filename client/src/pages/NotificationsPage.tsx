import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Heart, MessageCircle, Reply, PartyPopper, Mail, Megaphone, AtSign, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import MatchReasons from '@/components/match/MatchReasons';
import { formatDistanceToNow } from '@/utils/date';
import type { Notification, NotificationType } from '@/types';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  LIKE: <Heart size={20} strokeWidth={2.5} className="text-nb-pink" />,
  COMMENT: <MessageCircle size={20} strokeWidth={2.5} className="text-nb-peri" />,
  COMMENT_REPLY: <Reply size={20} strokeWidth={2.5} className="text-nb-peri" />,
  MATCH: <PartyPopper size={20} strokeWidth={2.5} className="text-nb-pink" />,
  NEW_MESSAGE: <Mail size={20} strokeWidth={2.5} className="text-nb-peri" />,
  MENTION: <AtSign size={20} strokeWidth={2.5} className="text-nb-violet" />,
  ANNOUNCEMENT: <Megaphone size={20} strokeWidth={2.5} className="text-nb-violet" />,
};

function textFor(type: NotificationType, actorName: string): string {
  switch (type) {
    case 'LIKE': return `${actorName} liked your post`;
    case 'COMMENT': return `${actorName} commented on your post`;
    case 'COMMENT_REPLY': return `${actorName} replied to your comment`;
    case 'MATCH': return `You matched with ${actorName}!`;
    case 'NEW_MESSAGE': return `${actorName} sent you a message`;
    case 'MENTION': return `${actorName} mentioned you`;
    default: return `${actorName} interacted with you`;
  }
}

/** Where a notification leads, and the verb the CTA uses. */
type Target = { kind: 'post' | 'chat' | 'none'; cta?: string };

/**
 * Every notification type maps to a REAL destination.
 *
 * This used to be `notif.postId && navigate(...)` — so `MATCH` and
 * `NEW_MESSAGE` (the two most important ones, and the whole point of the app)
 * rendered as dead rows: "Priya sent you a message" and tapping it did
 * nothing. The inbox is now a working inbox.
 */
function targetFor(n: Notification): Target {
  if (n.type === 'NEW_MESSAGE') {
    const conversationId = n.metadata?.conversationId;
    return conversationId ? { kind: 'chat', cta: 'Open chat' } : { kind: 'none' };
  }
  if (n.type === 'MATCH') return { kind: 'chat', cta: 'Say hi' };
  if (n.postId) return { kind: 'post', cta: 'View post' };
  return { kind: 'none' };
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Guards double-taps while a MATCH row resolves its conversation over the wire.
  const [openingId, setOpeningId] = useState<string | null>(null);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) =>
      api
        .get('/notifications', { params: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } })
        .then((r) => r.data),
    initialPageParam: null as string | null,
    getNextPageParam: (last: any) => last?.nextCursor ?? undefined,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
    },
  });

  const notifications: Notification[] = (data?.pages || []).flatMap((p: any) => p?.notifications || []);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  /** Patch the open row in the infinite cache so the badge + highlight react
   *  instantly, then let the server catch up. A failed PATCH is silent: the
   *  next list refetch restores the truth. */
  const markOneRead = (id: string) => {
    queryClient.setQueryData(['notifications'], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((p: any) => ({
          ...p,
          notifications: (p?.notifications || []).map((n: Notification) =>
            n.id === id ? { ...n, isRead: true } : n,
          ),
        })),
      };
    });
    queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
    api.patch(`/notifications/${id}/read`).catch(() => {});
  };

  const open = async (n: Notification) => {
    const target = targetFor(n);
    if (target.kind === 'none') return;
    if (openingId) return;
    setOpeningId(n.id);
    if (!n.isRead) markOneRead(n.id);
    try {
      if (target.kind === 'post') {
        navigate(`/post/${n.postId}`);
        return;
      }
      // MATCH notifications carry no conversation: threads are created lazily
      // on first open. POST /messages/conversation is pair-idempotent (the id
      // is derived from the sorted user pair), so this can never fork a thread.
      const direct = n.metadata?.conversationId;
      if (direct) {
        navigate(`/messages/${direct}`);
        return;
      }
      if (!n.actor?.id) return;
      const { data: conv } = await api.post('/messages/conversation', { userId: n.actor.id });
      navigate(`/messages/${conv.id}`);
    } catch (e: any) {
      // Blocked / unmatched / cross-college targets land here — say so instead
      // of a button that silently does nothing.
      toast.error(e?.response?.data?.error || 'That chat is no longer available');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h1 className="font-display font-bold text-2xl text-ink flex items-center gap-2">
          <Bell size={22} strokeWidth={2.5} /> Notifications
        </h1>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="nb-badge bg-nb-yellow text-ink text-xs" aria-live="polite">
              {unreadCount} new
            </span>
          )}
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending || notifications.length === 0}
            aria-busy={markAllReadMutation.isPending}
            className="nb-btn bg-nb-peri text-ink text-xs px-3 py-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {markAllReadMutation.isPending ? 'Marking…' : 'Mark all read'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !notifications.length ? (
        <EmptyState
          icon={<Bell strokeWidth={2.5} />}
          title="Nothing yet"
          description="When someone likes your post, comments, or matches with you — it'll show up here."
        />
      ) : (
        <>
          <ul className="space-y-2 list-none p-0 m-0">
            {notifications.map((notif) => {
              const target = targetFor(notif);
              const actorName = notif.actor?.displayName || 'Someone';
              const isAnnouncement = notif.type === 'ANNOUNCEMENT' && notif.metadata;
              const meta = notif.metadata || {};

              return (
                <li key={notif.id}>
                  <div
                    role={target.kind !== 'none' ? 'button' : undefined}
                    tabIndex={target.kind !== 'none' ? 0 : undefined}
                    aria-label={target.kind !== 'none' ? `${textFor(notif.type, actorName)} — ${target.cta}` : undefined}
                    onClick={() => open(notif)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open(notif);
                      }
                    }}
                    className={`nb-card p-4 flex items-start gap-3 min-w-0 transition-colors ${
                      !notif.isRead ? 'border-l-nb border-l-nb-yellow bg-yellow-50' : ''
                    } ${target.kind !== 'none' ? 'cursor-pointer hover:bg-nb-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nb-violet' : ''}`}
                  >
                    <span className="shrink-0 mt-0.5">
                      {TYPE_ICONS[notif.type] || <Megaphone size={20} strokeWidth={2.5} className="text-gray-400" />}
                    </span>
                    {notif.actor && (
                      <Avatar
                        src={notif.actor.avatarUrl}
                        photoId={notif.actor.avatarPhotoId}
                        color={notif.actor.avatarColor}
                        name={notif.actor.displayName}
                        size="sm"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {isAnnouncement ? (
                        <>
                          <p className="font-display font-bold text-sm flex items-center gap-1.5 flex-wrap">
                            <Megaphone size={14} strokeWidth={2.5} /> {meta.title}
                            <span className="text-xs font-body font-semibold text-gray-400">
                              · from {notif.actor?.displayName || 'your moderators'}
                            </span>
                          </p>
                          <p className="font-body text-sm mt-0.5 whitespace-pre-wrap">{meta.body}</p>
                        </>
                      ) : (
                        <p className="font-body text-sm">{textFor(notif.type, actorName)}</p>
                      )}

                      {notif.type === 'MATCH' && (
                        <MatchReasons criteria={{ goals: meta.goals ?? [], interests: meta.interests ?? [] }} />
                      )}

                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        {formatDistanceToNow(notif.createdAt)}
                        {!notif.isRead && (
                          <span className="inline-flex items-center gap-1 text-nb-pink font-semibold">
                            <span className="w-1.5 h-1.5 bg-nb-pink" aria-hidden="true" /> unread
                          </span>
                        )}
                      </p>
                    </div>

                    {target.kind !== 'none' && (
                      <span className="shrink-0 self-center text-gray-400 flex items-center gap-1 text-xs font-display font-semibold">
                        <span className="hidden sm:inline">{openingId === notif.id ? 'Opening…' : target.cta}</span>
                        <ChevronRight size={16} strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="nb-btn bg-white text-sm w-full mt-3 disabled:opacity-50"
            >
              {isFetchingNextPage ? 'Loading…' : 'Load older notifications'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
