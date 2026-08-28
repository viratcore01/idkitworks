import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import toast from 'react-hot-toast';
import { MOCK_MATCH_USERS, MOCK_MATCHES } from '@/data/mock';

type View = 'discover' | 'matches';

export default function MatchesPage() {
  const [view, setView] = useState<View>('discover');
  const [currentIndex, setCurrentIndex] = useState(0);
  const queryClient = useQueryClient();

  const { data: apiUsers, isLoading: loadingDiscover } = useQuery({
    queryKey: ['match-discover'],
    queryFn: () => api.get('/matches/discover').then((r) => r.data),
    enabled: view === 'discover',
    retry: false,
  });

  const { data: apiMatches, isLoading: loadingMatches } = useQuery({
    queryKey: ['matches'],
    queryFn: () => api.get('/matches').then((r) => r.data),
    enabled: view === 'matches',
    retry: false,
  });

  const users = apiUsers?.length ? apiUsers : MOCK_MATCH_USERS;
  const matches = apiMatches?.length ? apiMatches : MOCK_MATCHES;

  const likeMutation = useMutation({
    mutationFn: (receiverId: string) => api.post('/matches/like', { receiverId }),
    onSuccess: (data) => {
      if (data.data?.matched) {
        toast.success("🎉 It's a match! You can now chat!");
        queryClient.invalidateQueries({ queryKey: ['matches'] });
      }
      setCurrentIndex((i) => i + 1);
    },
    onError: () => {
      setCurrentIndex((i) => i + 1);
      toast('LIKED! ❤️');
    },
  });

  const passMutation = useMutation({
    mutationFn: (receiverId: string) => api.post('/matches/pass', { receiverId }),
    onSuccess: () => setCurrentIndex((i) => i + 1),
    onError: () => setCurrentIndex((i) => i + 1),
  });

  const currentUser = users[currentIndex];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl text-nb-black">❤️ Find Match</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView('discover')}
            className={`nb-btn text-sm ${view === 'discover' ? 'bg-nb-orange text-white' : ''}`}
          >
            🔍 Discover
          </button>
          <button
            onClick={() => setView('matches')}
            className={`nb-btn text-sm ${view === 'matches' ? 'bg-nb-pink text-white' : ''}`}
          >
            ❤️ Matches ({matches.length})
          </button>
        </div>
      </div>

      {view === 'discover' && (
        <>
          {loadingDiscover ? (
            <LoadingSpinner />
          ) : !currentUser ? (
            <EmptyState
              icon="🔍"
              title="No more people to discover"
              description="Check back later for new students!"
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
                    ✕
                  </button>
                  <button
                    onClick={() => likeMutation.mutate(currentUser.id)}
                    className="nb-btn-pink flex-1 text-center text-lg"
                  >
                    ❤️
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
          ) : !matches.length ? (
            <EmptyState
              icon="💔"
              title="No matches yet"
              description="Keep discovering people to find your match!"
            />
          ) : (
            <div className="space-y-3">
              {matches.map((match: any) => (
                <div key={match.id} className="nb-card-hover p-4 flex items-center gap-3">
                  <Avatar src={match.partner.avatarUrl} name={match.partner.displayName} />
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-semibold text-sm">{match.partner.displayName}</p>
                    <p className="text-xs text-gray-500 truncate">{match.partner.bio || 'No bio yet'}</p>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(match.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
