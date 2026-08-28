import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { formatDistanceToNow } from '@/utils/date';
import { MOCK_NOTIFICATIONS } from '@/data/mock';

const typeIcons: Record<string, string> = {
  LIKE: '❤️',
  COMMENT: '💬',
  COMMENT_REPLY: '↩️',
  MATCH: '🎉',
  NEW_MESSAGE: '✉️',
  MENTION: '📢',
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data),
    retry: false,
  });

  const markReadMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications = data?.notifications?.length ? data.notifications : MOCK_NOTIFICATIONS;

  const getNotificationText = (type: string, actorName: string) => {
    switch (type) {
      case 'LIKE': return `${actorName} liked your post`;
      case 'COMMENT': return `${actorName} commented on your post`;
      case 'COMMENT_REPLY': return `${actorName} replied to your comment`;
      case 'MATCH': return `🎉 You matched with ${actorName}!`;
      case 'NEW_MESSAGE': return `${actorName} sent you a message`;
      default: return `${actorName} interacted with you`;
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-2xl text-nb-black">🔔 Notifications</h1>
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
          icon="🔔"
          title="No notifications yet"
          description="When someone interacts with you, you'll see it here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((notif: any) => (
            <div
              key={notif.id}
              className={`nb-card p-4 flex items-center gap-3 ${
                !notif.isRead ? 'border-l-4 border-l-nb-orange bg-orange-50/50' : ''
              }`}
            >
              <span className="text-xl">{typeIcons[notif.type] || '📌'}</span>
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
