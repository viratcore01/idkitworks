import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Heart, MessageSquare, X, HeartCrack, SearchX, MessageSquareOff } from 'lucide-react';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { formatDistanceToNow } from '@/utils/date';
import toast from 'react-hot-toast';

type View = 'discover' | 'matches' | 'chat';

export default function MatchesPage() {
  const [view, setView] = useState<View>('discover');
  const [currentIndex, setCurrentIndex] = useState(0);
  const queryClient = useQueryClient();

  const { data: users, isLoading: loadingDiscover } = useQuery({
    queryKey: ['match-discover'],
    queryFn: () => api.get('/matches/discover').then((r) => r.data),
    enabled: view === 'discover',
  });

  const { data: matches, isLoading: loadingMatches } = useQuery({
    queryKey: ['matches'],
    queryFn: () => api.get('/matches').then((r) => r.data),
    enabled: view === 'matches',
  });

  const { data: conversations, isLoading: loadingConversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get('/messages/conversations').then((r) => r.data),
  });

  // Map partner user id -> conversation, so match cards can link to their chat
  const conversationByUserId = new Map<string, any>(
    (conversations || []).map((conv: any) => [conv.otherUser?.id, conv]),
  );

  const likeMutation = useMutation({
    mutationFn: (receiverId: string) => api.post('/matches/like', { receiverId }),
    onSuccess: (data) => {
      if (data.data?.matched) {
        toast.success("It's a match! You can now chat!");
        queryClient.invalidateQueries({ queryKey: ['matches'] });
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }
      setCurrentIndex((i) => i + 1);
    },
  });

  const passMutation = useMutation({
    mutationFn: (receiverId: string) => api.post('/matches/pass', { receiverId }),
    onSuccess: () => setCurrentIndex((i) => i + 1),
  });

  const currentUser = users?.[currentIndex];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl text-nb-black flex items-center gap-2">
          <Heart size={22} strokeWidth={2.5} className="text-nb-pink fill-current" /> Find Match
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView('discover')}
            className={`nb-btn text-sm ${view === 'discover' ? 'bg-nb-orange text-white' : ''}`}
          >
            <Search size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Discover
          </button>
          <button
            onClick={() => setView('matches')}
            className={`nb-btn text-sm ${view === 'matches' ? 'bg-nb-pink text-white' : ''}`}
          >
            <Heart size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Matches ({matches?.length || 0})
          </button>
          <button
            onClick={() => setView('chat')}
            className={`nb-btn text-sm ${view === 'chat' ? 'bg-nb-cyan text-white' : ''}`}
          >
            <MessageSquare size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Chat ({conversations?.length || 0})
          </button>
        </div>
      </div>

      {view === 'discover' && (
        <>
          {loadingDiscover ? (
            <LoadingSpinner />
          ) : !currentUser ? (
            <EmptyState
              icon={<SearchX strokeWidth={2.5} />}
              title="No more people to discover"
              description="You've seen everyone! Check back later for new students."
            />
          ) : (
            <div className="nb-card p-6 max-w-md mx-auto">
              <div className="text-center">
                <div className="mb-4">
                  <Avatar src={currentUser.avatarUrl} name={currentUser.displayName} size="lg" className="mx-auto" />
                </div>
                <h2 className="font-display font-bold text-xl">{currentUser.displayName}</h2>
                <p className="text-sm text-gray-500 font-body">@{currentUser.username}</p>

                {currentUser.college && (
                  <p className="mt-2 text-sm font-body">
                    {currentUser.course || ''} • {currentUser.college.shortName || currentUser.college.name}
                    {currentUser.year && ` • ${currentUser.year}${currentUser.year === 1 ? 'st' : 'nd'} Year`}
                  </p>
                )}

                {currentUser.bio && (
                  <p className="mt-3 text-sm font-body text-gray-600 italic">"{currentUser.bio}"</p>
                )}

                {currentUser.interests?.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                    {currentUser.interests.map((i: any) => (
                      <span key={i.id} className="nb-tag text-xs">{i.name}</span>
                    ))}
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => passMutation.mutate(currentUser.id)}
                    className="nb-btn-ghost flex-1 text-center text-lg"
                  >
                    <X size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={() => likeMutation.mutate(currentUser.id)}
                    className="nb-btn-pink flex-1 flex items-center justify-center"
                  >
                    <Heart size={20} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {view === 'matches' && (
        <>
          {loadingMatches ? (
            <LoadingSpinner />
          ) : !matches?.length ? (
            <EmptyState
              icon={<HeartCrack strokeWidth={2.5} />}
              title="No matches yet"
              description="Keep swiping — your person is out there."
            />
          ) : (
            <div className="space-y-3">
              {matches.map((match: any) => {
                const conv = conversationByUserId.get(match.partner.id);
                return (
                  <div key={match.id} className="nb-card-hover p-4 flex items-center gap-3">
                    <Avatar src={match.partner.avatarUrl} name={match.partner.displayName} />
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-sm">{match.partner.displayName}</p>
                      <p className="text-xs text-gray-500 truncate">{match.partner.bio || 'No bio yet'}</p>
                    </div>
                    {conv && (
                      <Link
                        to={`/messages/${conv.id}`}
                        className="nb-btn bg-nb-cyan text-white text-xs shrink-0"
                      >
                        <MessageSquare size={12} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Chat
                      </Link>
                    )}
                    <span className="text-xs text-gray-400 shrink-0">
                      {new Date(match.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {view === 'chat' && (
        <>
          {loadingConversations ? (
            <LoadingSpinner />
          ) : !conversations?.length ? (
            <EmptyState
              icon={<MessageSquareOff strokeWidth={2.5} />}
              title="No conversations yet"
              description="Match with someone to start chatting."
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
        </>
      )}
    </div>
  );
}
