import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Heart, MessageSquare, X, HeartCrack, SearchX, MessageSquareOff, SlidersHorizontal, PartyPopper, UserMinus, RotateCcw, Zap } from 'lucide-react';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { formatDistanceToNow } from '@/utils/date';
import toast from 'react-hot-toast';

type View = 'discover' | 'matches' | 'chat';

const GENDERS = [
  { value: 'EVERYONE', label: 'Everyone' },
  { value: 'FEMALE', label: 'Women' },
  { value: 'MALE', label: 'Men' },
  { value: 'OTHER', label: 'Other' },
];

export default function MatchesPage() {
  const [view, setView] = useState<View>('discover');
  const [deckPage, setDeckPage] = useState(0);
  const [matchBanner, setMatchBanner] = useState<{ name: string; username: string } | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState({ genderPreference: 'EVERYONE', ageRangeMin: 18, ageRangeMax: 60 });
  const queryClient = useQueryClient();

  const { data: deck, isLoading: loadingDiscover } = useQuery({
    queryKey: ['match-discover', deckPage],
    queryFn: () => api.get('/matches/discover', { params: { page: deckPage } }).then((r) => r.data),
    enabled: view === 'discover',
  });

  const { data: matchesData, isLoading: loadingMatches } = useQuery({
    queryKey: ['matches'],
    queryFn: () => api.get('/matches').then((r) => r.data),
    // Always on: the tab badge needs a live count even before the tab is opened
  });

  const { data: conversations, isLoading: loadingConversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get('/messages/conversations').then((r) => r.data),
  });

  const { data: savedPrefs } = useQuery({
    queryKey: ['match-preferences'],
    queryFn: () => api.get('/matches/preferences').then((r) => r.data),
  });

  const users = deck?.users || [];
  const currentIndex = 0; // each action moves to the next card; page refetch gives a fresh deck
  const currentUser = users[currentIndex];
  const matches = matchesData?.matches || [];

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['match-discover'] });
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    queryClient.invalidateQueries({ queryKey: ['match-stats'] });
  };

  const actionMutation = useMutation({
    mutationFn: ({ receiverId, action }: { receiverId: string; action: 'like' | 'pass' }) =>
      api.post(`/matches/${action}`, { receiverId }).then((r) => r.data),
    onSuccess: (data) => {
      if (data?.matched) {
        setMatchBanner({
          name: currentUser?.displayName || 'Someone',
          username: currentUser?.username || '',
        });
      }
      // Move past the actioned card; refetch the deck when the page runs dry
      if (users.length <= 1) {
        setDeckPage((p) => p + 1);
      } else {
        queryClient.setQueryData(['match-discover', deckPage], (old: any) =>
          old ? { ...old, users: old.users.slice(1) } : old,
        );
      }
      refreshAll();
    },
    onError: (e: any) => {
      const msg = e.response?.data?.error || 'Something went wrong';
      toast.error(msg);
      // Rate-limited or blocked — still advance so the user isn't stuck on the card
      if (users.length <= 1) setDeckPage((p) => p + 1);
      else queryClient.setQueryData(['match-discover', deckPage], (old: any) => old ? { ...old, users: old.users.slice(1) } : old);
    },
  });

  const unmatchMutation = useMutation({
    mutationFn: (matchId: string) => api.delete(`/matches/${matchId}`),
    onSuccess: () => {
      toast('Match removed');
      refreshAll();
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const savePrefsMutation = useMutation({
    mutationFn: () => api.patch('/matches/preferences', prefs),
    onSuccess: () => {
      toast.success('Preferences saved');
      setShowPrefs(false);
      setDeckPage(0);
      refreshAll();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save'),
  });

  const openPrefs = () => {
    if (savedPrefs) {
      setPrefs({
        genderPreference: savedPrefs.genderPreference || 'EVERYONE',
        ageRangeMin: savedPrefs.ageRangeMin || 18,
        ageRangeMax: savedPrefs.ageRangeMax || 60,
      });
    }
    setShowPrefs(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display font-bold text-2xl text-nb-black flex items-center gap-2">
          <Heart size={22} strokeWidth={2.5} className="text-nb-pink fill-current" /> Find Match
        </h1>
        <div className="flex gap-2 flex-wrap">
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
            <Heart size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Matches ({matches.length})
          </button>
          <button
            onClick={() => setView('chat')}
            className={`nb-btn text-sm ${view === 'chat' ? 'bg-nb-cyan text-white' : ''}`}
          >
            <MessageSquare size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Chat ({conversations?.length || 0})
          </button>
          {view === 'discover' && (
            <button onClick={openPrefs} className="nb-btn bg-white text-sm" title="Discovery preferences">
              <SlidersHorizontal size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Filters
            </button>
          )}
        </div>
      </div>

      {/* Match celebration */}
      {matchBanner && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setMatchBanner(null)}>
          <div className="nb-card bg-nb-lime p-8 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <PartyPopper size={48} strokeWidth={2.5} className="mx-auto mb-3 text-nb-black" />
            <h2 className="font-display font-bold text-2xl mb-1">It's a Match!</h2>
            <p className="font-body text-sm mb-5">
              You and {matchBanner.name} liked each other.
            </p>
            <div className="flex gap-2 justify-center">
              <Link
                to={`/profile/${matchBanner.username}`}
                className="nb-btn bg-white text-sm"
                onClick={() => setMatchBanner(null)}
              >
                View profile
              </Link>
              <button onClick={() => setMatchBanner(null)} className="nb-btn-orange text-sm">
                Keep swiping
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preferences editor */}
      {showPrefs && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setShowPrefs(false)}>
          <div className="nb-card bg-white p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display font-bold text-xl mb-4 flex items-center gap-2">
              <SlidersHorizontal size={18} strokeWidth={2.5} /> Discovery preferences
            </h2>

            <label className="block font-display font-semibold text-sm mb-2">Show me</label>
            <div className="flex gap-2 mb-4 flex-wrap">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setPrefs((p) => ({ ...p, genderPreference: g.value }))}
                  className={`nb-btn text-xs px-3 py-1.5 ${prefs.genderPreference === g.value ? 'bg-nb-orange text-white' : 'bg-white'}`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <label className="block font-display font-semibold text-sm mb-2">
              Age range: {prefs.ageRangeMin}–{prefs.ageRangeMax}
            </label>
            <div className="flex items-center gap-3 mb-1">
              <input
                type="range" min={18} max={99} value={prefs.ageRangeMin}
                onChange={(e) => setPrefs((p) => ({ ...p, ageRangeMin: Math.min(Number(e.target.value), p.ageRangeMax - 1) }))}
                className="flex-1 accent-nb-orange"
              />
              <span className="font-display font-bold text-sm w-8 text-center">{prefs.ageRangeMin}</span>
            </div>
            <div className="flex items-center gap-3 mb-5">
              <input
                type="range" min={18} max={99} value={prefs.ageRangeMax}
                onChange={(e) => setPrefs((p) => ({ ...p, ageRangeMax: Math.max(Number(e.target.value), p.ageRangeMin + 1) }))}
                className="flex-1 accent-nb-orange"
              />
              <span className="font-display font-bold text-sm w-8 text-center">{prefs.ageRangeMax}</span>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPrefs(false)} className="nb-btn bg-white text-sm">Cancel</button>
              <button onClick={() => savePrefsMutation.mutate()} disabled={savePrefsMutation.isPending} className="nb-btn-orange text-sm">
                {savePrefsMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'discover' && (
        <>
          {loadingDiscover ? (
            <LoadingSpinner />
          ) : !currentUser ? (
            <EmptyState
              icon={<SearchX strokeWidth={2.5} />}
              title="No more people to discover"
              description="You've seen everyone here. Check back later, or widen your filters."
              action={
                deckPage > 0 ? (
                  <button onClick={() => setDeckPage(0)} className="nb-btn bg-white text-sm inline-flex items-center gap-1.5">
                    <RotateCcw size={14} strokeWidth={2.5} /> Start over
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="nb-card p-6 max-w-md mx-auto">
              <div className="text-center">
                <div className="mb-4">
                  <Avatar src={currentUser.avatarUrl} name={currentUser.displayName} size="lg" className="mx-auto" />
                </div>
                <h2 className="font-display font-bold text-xl">{currentUser.displayName}</h2>
                <p className="text-sm text-gray-500 font-body">@{currentUser.username}</p>

                <p className="mt-2 text-sm font-body">
                  {[currentUser.course, currentUser.college?.shortName || currentUser.college?.name, currentUser.age ? `${currentUser.age} yrs` : null]
                    .filter(Boolean)
                    .join(' • ')}
                </p>

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
                    onClick={() => actionMutation.mutate({ receiverId: currentUser.id, action: 'pass' })}
                    disabled={actionMutation.isPending}
                    className="nb-btn-ghost flex-1 text-center text-lg"
                    title="Pass"
                  >
                    <X size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={() => actionMutation.mutate({ receiverId: currentUser.id, action: 'like' })}
                    disabled={actionMutation.isPending}
                    className="nb-btn-pink flex-1 flex items-center justify-center"
                    title="Like"
                  >
                    <Heart size={20} strokeWidth={2.5} />
                  </button>
                </div>

                {deck && (
                  <p className="mt-4 text-[11px] text-gray-500 font-body">
                    {deck.totalRemaining} student{deck.totalRemaining === 1 ? '' : 's'} in your deck
                  </p>
                )}
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
              icon={<HeartCrack strokeWidth={2.5} />}
              title="No matches yet"
              description="Keep swiping — your person is out there."
            />
          ) : (
            <div className="space-y-3">
              {matches.map((match: any) => {
                const conv = (conversations || []).find((c: any) => c.otherUser?.id === match.partner.id);
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
                    <button
                      onClick={() => unmatchMutation.mutate(match.id)}
                      className="text-gray-500 hover:text-nb-red transition-colors shrink-0 p-1"
                      title="Unmatch"
                    >
                      <UserMinus size={16} strokeWidth={2.5} />
                    </button>
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
                          {conv.lastMessage?.isDeleted ? 'Message deleted' : conv.lastMessage?.content || 'No messages yet'}
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
