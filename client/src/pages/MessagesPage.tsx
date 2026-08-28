import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { formatDistanceToNow } from '@/utils/date';
import { MOCK_CONVERSATIONS } from '@/data/mock';

export default function MessagesPage() {
  const { data: apiConversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get('/messages/conversations').then((r) => r.data),
    retry: false,
  });

  const conversations = apiConversations?.length ? apiConversations : MOCK_CONVERSATIONS;

  return (
    <div>
      <h1 className="font-display font-bold text-2xl text-nb-black mb-4">💬 Messages</h1>

      {isLoading ? (
        <LoadingSpinner />
      ) : !conversations.length ? (
        <EmptyState
          icon="💬"
          title="No conversations yet"
          description="Match with someone to start chatting!"
        />
      ) : (
        <div className="space-y-2">
          {conversations.map((conv: any) => (
            <Link
              key={conv.id}
              to={`/messages/${conv.id}`}
              className="nb-card-hover p-4 flex items-center gap-3 block"
            >
              {conv.otherUser && (
                <>
                  <Avatar src={conv.otherUser.avatarUrl} name={conv.otherUser.displayName} />
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-semibold text-sm">{conv.otherUser.displayName}</p>
                    <p className="text-xs text-gray-500 truncate font-body">
                      {conv.lastMessage?.content || 'No messages yet'}
                    </p>
                  </div>
                  {conv.lastMessage && (
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {formatDistanceToNow(conv.lastMessage.createdAt)}
                    </span>
                  )}
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
