import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Heart, MessageCircle, Reply, PartyPopper, Mail, Megaphone, AtSign } from 'lucide-react';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { formatDistanceToNow } from '@/utils/date';

const typeIcons: Record<string, React.ReactNode> = {
  LIKE: <Heart size={20} strokeWidth={2.5} className="text-nb-red" />,
  COMMENT: <MessageCircle size={20} strokeWidth={2.5} className="text-nb-blue" />,
  COMMENT_REPLY: <Reply size={20} strokeWidth={2.5} className="text-nb-blue" />,
  MATCH: <PartyPopper size={20} strokeWidth={2.5} className="text-nb-pink" />,
  NEW_MESSAGE: <Mail size={20} strokeWidth={2.5} className="text-nb-cyan" />,
  MENTION: <AtSign size={20} strokeWidth={2.5} className="text-nb-purple" />,
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data),
  });

  const markReadMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications = data?.notifications || [];

  const getNotificationText = (type: string, actorName: string) => {
    switch (type) {
      case 'LIKE': return `${actorName} liked your post`;
      case 'COMMENT': return `${actorName} commented on your post`;
      case 'COMMENT_REPLY': return `${actorName} replied to your comment`;
      case 'MATCH': return `You matched with ${actorName}!`;
      case 'NEW_MESSAGE': return `${actorName} sent you a message`;
      default: return `${actorName} interacted with you`;
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-2xl text-nb-black flex items-center gap-2">
          <Bell size={22} strokeWidth={2.5} /> Notifications
        </h1>
        <button
          onClick={() => markReadMutation.mutate()}
          className="nb-badge bg-nb-cyan text-white cursor-pointer"
        >
          Mark all read
        </button>
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
        <div className="space-y-2">          {notifications.map((notif: any) => (
            <div
              key={notif.id}
              onClick={() => notif.postId && navigate(`/post/${notif.postId}`)}
              className={`nb-card p-4 flex items-center gap-3 ${
                !notif.isRead ? 'border-l-4 border-l-nb-lime bg-lime-50' : ''
              } ${notif.postId ? 'cursor-pointer' : ''}`}
            >
              <span className="shrink-0">{typeIcons[notif.type] || <Megaphone size={20} strokeWidth={2.5} className="text-gray-400" />}</span>
              {notif.actor && (
                <Avatar src={notif.actor.avatarUrl} name={notif.actor.displayName} size="sm" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm">
                  {getNotificationText(notif.type, notif.actor?.displayName || 'Someone')}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDistanceToNow(notif.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
