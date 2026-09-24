import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Heart, MessageSquare, X, HeartCrack, SearchX, MessageSquareOff, SlidersHorizontal, PartyPopper, UserMinus, RotateCcw, Camera, ImageOff, ChevronLeft, ChevronRight, Undo2, BadgeCheck, Sparkles, Lock, UserPlus } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import MatchReasons from '@/components/match/MatchReasons';
import { formatDistanceToNow } from '@/utils/date';
import { photoSrc, usePhotoVersion } from '@/utils/photo';
import toast from 'react-hot-toast';

type View = 'discover' | 'matches' | 'chat';

const GENDERS = [
 { value: 'EVERYONE', label: 'Everyone' },
 { value: 'FEMALE', label: 'Women' },
 { value: 'MALE', label: 'Men' },
 { value: 'OTHER', label: 'Other' },
];

/** Relationship goals (intent matching) — mirrors the server's VALID_GOALS. */
const GOALS = [
 { value: 'DATING', label: 'Dating', hint: 'Casual going-out, see where it goes' },
 { value: 'RELATIONSHIP', label: 'Relationship', hint: 'Looking for something serious' },
 { value: 'HOOKUP', label: 'Hookup', hint: 'No strings, keep it casual' },
 { value: 'CASUAL', label: 'Casual', hint: 'Low-key, no pressure' },
 { value: 'NOT_SURE', label: 'Not sure yet', hint: 'Open to whatever happens' },
];

const GOAL_LABEL: Record<string, string> = Object.fromEntries(GOALS.map((g) => [g.value, g.label]));

/** Chip styling per goal — the card/profile badge colors. */
const GOAL_CHIP: Record<string, string> = {
 DATING: 'bg-nb-pink text-white',
 RELATIONSHIP: 'bg-nb-violet text-white',
 HOOKUP: 'bg-nb-mint text-ink',
 CASUAL: 'bg-nb-yellow text-ink',
 NOT_SURE: 'bg-nb-lilac text-ink',
};

export default function MatchesPage() {
 const [view, setView] = useState<View>('discover');
 const [deckPage, setDeckPage] = useState(0);
 const [matchBanner, setMatchBanner] = useState<{ name: string; username: string; criteria?: { goals: string[]; interests: { id: string; name: string }[] } } | null>(null);
 const [showPrefs, setShowPrefs] = useState(false);
 const [prefs, setPrefs] = useState({
 genderPreference: 'EVERYONE',
 ageRangeMin: 16,
 ageRangeMax: 60,
openToGoals: [] as string[],
minYear: null as number | null,
});
 const [photoIdx, setPhotoIdx] = useState(0);
 const queryClient = useQueryClient();
 const navigate = useNavigate();  const { data: deck, isLoading: loadingDiscover } = useQuery({
 queryKey: ['match-discover', deckPage],
 queryFn: () => api.get('/matches/discover', { params: { page: deckPage } }).then((r) => r.data),
 enabled: view === 'discover',
staleTime: 20_000,
gcTime: 5 * 60_000,
refetchOnWindowFocus: false,
 // Keep the previous page's card visible while the next page loads —
 // swiping feels instant even across page boundaries.
 placeholderData: (prev: any) => prev,
 });

// LOOP CHAIN: when the server reports this page has drained (hasMore=false
  // but the pool isn't empty), wrap to page 0 — the passed tail cycles back
  // around automatically. Fetching page 0 while page N is still mounted
  // gives a seamless loop instead of a dead "no more people" screen.
  useEffect(() => {
  if (deck && !deck.hasMore && deck.totalRemaining > 0 && deck.users.length <= 1 && deckPage > 0) {
  setDeckPage(0);
  }
  }, [deck, deckPage]);

  // PREFETCH NEXT PAGE: when user reaches the last 2 cards of current page,
  // silently fetch the next page in background so the next swipe is instant.
  useEffect(() => {
  if (!deck || !deck.hasMore || view !== 'discover') return;
  const users = deck.users || [];
  if (users.length <= 2) {
    const nextPage = deckPage + 1;
    queryClient.prefetchQuery({
      queryKey: ['match-discover', nextPage],
      queryFn: () => api.get('/matches/discover', { params: { page: nextPage } }).then((r) => r.data),
      staleTime: 20_000,
    });
  }
  }, [deck, deckPage, view, queryClient]);

  // Matches list is paginated (server default 50/page): power users with
  // 100+ matches page through instead of one giant fetch. Pages append;
  // any match mutation invalidates the whole ['matches'] prefix.
  const [matchesPage, setMatchesPage] = useState(0);
  const { data: matchesData, isLoading: loadingMatches, isFetching: fetchingMatches } = useQuery({
  queryKey: ['matches', matchesPage],
  queryFn: () => api.get('/matches', { params: { page: matchesPage } }).then((r) => r.data),
  // Always on: the tab badge needs a live count even before the tab is opened
  placeholderData: (prev: any) => prev,
  });
  const [matchPages, setMatchPages] = useState<any[][]>([]);
  const matchesHasMore = !!matchesData?.hasMore;
  useEffect(() => {
  if (matchesData?.matches) {
  setMatchPages((prev) => {
  const next = [...prev];
  next[matchesPage] = matchesData.matches;
  return next;
  });
  }
  }, [matchesData, matchesPage]);
  // View/discover churn must not resurrect stale appended pages.
  useEffect(() => { setMatchPages([]); setMatchesPage(0); }, [view]);

 const { data: conversations, isLoading: loadingConversations } = useQuery({
 queryKey: ['conversations'],
 queryFn: () => api.get('/messages/conversations').then((r) => r.data),
 });

// Prefetch preferences on mount (stale-while-revalidate): opening the
// filters modal used to pay a full round-trip + show "Loading your saved
// filters…" with Save disabled — the perceived lag. Now the data is warm
// before the user taps Filters, and local edits sync via the effect below.
const { data: savedPrefs } = useQuery({
queryKey: ['match-preferences'],
queryFn: () => api.get('/matches/preferences').then((r) => r.data),
staleTime: 5 * 60_000,
gcTime: 10 * 60_000,
refetchOnWindowFocus: false,
});
// Sync the modal's local draft the moment saved filters arrive (first mount
// or background refetch) — opening Filters is then instant, never defaults.
useEffect(() => {
if (!savedPrefs) return;
setPrefs({
genderPreference: savedPrefs.genderPreference || 'EVERYONE',
ageRangeMin: savedPrefs.ageRangeMin ?? 16,
ageRangeMax: savedPrefs.ageRangeMax ?? 60,
openToGoals: savedPrefs.openToGoals || [],
minYear: savedPrefs.minYear ?? null,
});
}, [savedPrefs]);

  // Waiting likes — powers the "N waiting" chip on the deck header AND the
  // honest total on the Matches tab badge (matches pages are capped at 50,
  // so `matches.length` undercounts for power users — stats never lies).
  const { data: matchStats } = useQuery({
  queryKey: ['match-stats'],
  queryFn: () => api.get('/matches/stats').then((r) => r.data),
  });

  // WHO LIKED YOU (waiting list): fetched only for the Matches tab so the
  // deck query stays lean. Liking back from here is an instant match.
  const { data: likesYouData, isLoading: loadingLikesYou } = useQuery({
  queryKey: ['likes-you'],
  queryFn: () => api.get('/matches/likes-you').then((r) => r.data),
  enabled: view === 'matches',
  staleTime: 30_000,
  });
  const waiting = likesYouData?.users || [];
  const [likeBackId, setLikeBackId] = useState<string | null>(null);

  const likeBackMutation = useMutation({
  mutationFn: (receiverId: string) => api.post('/matches/like', { receiverId }).then((r) => r.data),
  onMutate: (receiverId) => setLikeBackId(receiverId),
  onSuccess: (data, receiverId) => {
  const u = waiting.find((w: any) => w.id === receiverId);
  if (data?.matched) {
  setMatchBanner({ name: u?.displayName || 'Someone', username: u?.username || '', criteria: data.criteria });
  } else {
  toast('Like sent');
  }
  // Remove the answered row optimistically; server state follows.
queryClient.setQueryData(['likes-you'], (old: any) =>
old ? { ...old, users: (old.users || []).filter((x: any) => x.id !== receiverId) } : old,
);
refreshAfterSwipe(!!data?.matched, true);
},
onError: (e: any) => toast.error(e.response?.data?.error || 'Could not like back'),
  onSettled: () => setLikeBackId(null),
  });

  const users = deck?.users || [];
  const currentIndex = 0; // each action moves to the next card; page refetch gives a fresh deck
  const currentUser = users[currentIndex];
  // Flattened across fetched pages (see paginated matches query above).
  const matches = matchPages.flat();

  // Reset the photo carousel whenever a new card comes up
  useEffect(() => {
  setPhotoIdx(0);
  setBrokenPhotos([]);
  }, [currentUser?.id]);

  /** All displayable photos of the current card: stored slots first, then avatarUrl.
   * URLs that failed to load are dropped (expired tokens, deleted files) so a
   * broken <img> never bricks the card — the Avatar fallback renders instead. */
  const pv = usePhotoVersion(); // token rotation → rebuild URLs → images reload
  const [brokenPhotos, setBrokenPhotos] = useState<string[]>([]);
  const cardPhotos: string[] = currentUser
  ? [
  ...(currentUser.photos || []).map((p: any) => photoSrc(p.id)),
  currentUser.avatarUrl || null,
  ].filter((u) => Boolean(u) && !brokenPhotos.includes(u as string)) as string[]
  : [];
  // Clamp: the photo list can shrink under a stale index (recycled cards,
  // filtered broken URLs) — never render src={undefined}.
  const safePhotoIdx = Math.min(photoIdx, Math.max(cardPhotos.length - 1, 0));

  const refreshAll = () => {
  queryClient.invalidateQueries({ queryKey: ['match-discover'] });
  queryClient.invalidateQueries({ queryKey: ['matches'] });
  queryClient.invalidateQueries({ queryKey: ['match-stats'] });
  queryClient.invalidateQueries({ queryKey: ['likes-you'] });
  // Paginated matches list: restart from page 0 so appended pages can't go
  // stale underneath a mutation (unmatch/like-back change list membership).
setMatchPages([]);
setMatchesPage(0);
};
// LIGHTWEIGHT refresh paths (the lag fix): the old code called refreshAll()
// (4 query invalidations + matches-page reset) after EVERY swipe and every
// filter save, so one tap refetched the deck, matches, stats and likes-you
// at once. Swipes already update the deck optimistically — they only need
// the counters; filter saves only need a fresh deck.
const refreshAfterSwipe = (matched: boolean, liked: boolean) => {
queryClient.invalidateQueries({ queryKey: ['match-stats'] });
if (liked) queryClient.invalidateQueries({ queryKey: ['likes-you'] });
if (matched) {
queryClient.invalidateQueries({ queryKey: ['matches'] });
setMatchPages([]);
setMatchesPage(0);
}
};
const refreshAfterPrefsSave = () => {
queryClient.invalidateQueries({ queryKey: ['match-discover'] });
};

  // Which swipe is in flight (like vs pass tracked separately so a pending
  // pass never freezes the Like button and vice versa).
  const [pendingAction, setPendingAction] = useState<{ receiverId: string; action: 'like' | 'pass' } | null>(null);

  const actionMutation = useMutation({
  mutationFn: ({ receiverId, action }: { receiverId: string; action: 'like' | 'pass' }) =>
  api.post(`/matches/${action}`, { receiverId }).then((r) => r.data),
  onMutate: (v) => {
  setPendingAction(v);
  // Snapshot the card being acted on — onSuccess must use THIS, not the
  // (possibly already advanced) currentUser closure, or fast double-swipes
  // show the wrong name and slice the wrong card.
  return { user: currentUser };
  },
  onSuccess: (data, variables, context: any) => {
  const acted = context?.user;
  if (data?.matched) {
  setMatchBanner({
  name: acted?.displayName || 'Someone',
  username: acted?.username || '',
  criteria: data.criteria,
  });
  }
  // Move past the ACTIONED card by id (not blind slice(1) — safe under
  // races, page wraps and likes-you boosts that reorder the deck).
  queryClient.setQueryData(['match-discover', deckPage], (old: any) =>
  old ? { ...old, users: (old.users || []).filter((u: any) => u.id !== variables.receiverId), totalRemaining: Math.max((old.totalRemaining ?? 1) - 1, 0) } : old,
  );
// Refetch the deck when the page runs dry
if (users.length <= 1) {
setDeckPage((p) => p + 1);
}
// Optimistic deck removal above already moved past the card — only the
// counters (and the matches list on a real match) need refetching.
refreshAfterSwipe(!!data?.matched, variables.action === 'like');
},
onError: (e: any, variables) => {
  const msg = e.response?.data?.error || 'Something went wrong';
  toast.error(msg);
  // Rate-limited or blocked — still advance past the stuck card so the
  // user isn't frozen on it.
  queryClient.setQueryData(['match-discover', deckPage], (old: any) => old ? { ...old, users: (old.users || []).filter((u: any) => u.id !== variables.receiverId) } : old);
  if (users.length <= 1) setDeckPage((p) => p + 1);
  },
  onSettled: () => setPendingAction(null),
  });

 const unmatchMutation = useMutation({
 mutationFn: (matchId: string) => api.delete(`/matches/${matchId}`),
 onSuccess: () => {
 toast('Match removed');
 refreshAll();
 queryClient.invalidateQueries({ queryKey: ['conversations'] });
 },
 });

 // REWIND (Tinder-style): undo the last pass — mis-swipes are recoverable
 // for 10 minutes, server-enforced. Restores the card you just passed.
 const rewindMutation = useMutation({
 mutationFn: () => api.post('/matches/rewind').then((r) => r.data),
 onSuccess: (data) => {
 toast('Pass undone — here they are again');
 refreshAll();
 // Re-fetch the deck so the rewound user reappears as the current card
 queryClient.resetQueries({ queryKey: ['match-discover'] });
 setDeckPage(0);
 },
 onError: (e: any) => {
 toast.error(e.response?.data?.error || 'Nothing to rewind');
 },
 });

const savePrefsMutation = useMutation({
mutationFn: () => api.patch('/matches/preferences', {
...prefs,
// empty selection = open to every goal — send [] not undefined
openToGoals: prefs.openToGoals,
}),
onSuccess: (saved) => {
toast.success('Preferences saved');
// Server returns the merged preference shape — seed the cache instantly
// so reopening Filters never flashes stale values, then refetch the deck
// from page 0. Matches / likes-you / stats are untouched by filters.
if (saved) queryClient.setQueryData(['match-preferences'], saved);
setShowPrefs(false);
setDeckPage(0);
refreshAfterPrefsSave();
},
 onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save'),
 });

const openPrefs = () => {
// Local draft already mirrors savedPrefs via the sync effect (prefetched on
// mount), so opening is instant. Re-apply here as a belt-and-braces for a
// background refetch that landed while the modal was closed.
if (savedPrefs) {
setPrefs({
genderPreference: savedPrefs.genderPreference || 'EVERYONE',
ageRangeMin: savedPrefs.ageRangeMin ?? 16,
ageRangeMax: savedPrefs.ageRangeMax ?? 60,
openToGoals: savedPrefs.openToGoals || [],
minYear: savedPrefs.minYear ?? null,
});
}
setShowPrefs(true);
};

  // Escape closes the match banner / prefs modal (focus-lite: no trap, but
  // keyboard users are never stuck).
  useEffect(() => {
  if (!matchBanner && !showPrefs) return;
  const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') { setMatchBanner(null); setShowPrefs(false); }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
  }, [matchBanner, showPrefs]);

  return (
  <div>
  <div className="mb-5 sm:mb-6">
  <div className="flex items-center justify-between gap-3 mb-3 sm:mb-4">
  <h1 className="font-display font-bold text-2xl text-ink flex items-center gap-2 min-w-0">
  <Heart size={22} strokeWidth={2.5} className="text-nb-pink fill-current shrink-0" aria-hidden="true" />
  <span className="truncate">Find Match</span>
  </h1>
  {/* Filters used to end the tab row, which at 390px pushed it 120px past the
      right edge — a primary action reachable only by an invisible horizontal
      swipe. It lives on the title line now, icon-only on phones. */}
  {view === 'discover' && (
  <button
  onClick={openPrefs}
  aria-label="Discovery preferences"
  title="Discovery preferences"
  className="nb-btn bg-white text-sm shrink-0 px-3 sm:px-5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1.5"
  >
  <SlidersHorizontal size={15} strokeWidth={2.5} aria-hidden="true" />
  <span className="hidden sm:inline">Filters</span>
  </button>
  )}
  </div>

  {/* Segmented switcher. Below sm this is a strict 3-column grid: every tab
      gets exactly one third of the width, so nothing can overflow or hide.
      Icons and count badges are sm+ only — at a 320px budget phone the labels
      alone are what must fit. */}
  <div className="grid grid-cols-3 gap-2 sm:flex sm:w-auto" role="tablist" aria-label="Match sections">
 <button
 role="tab"
 aria-selected={view === 'discover'}
 onClick={() => setView('discover')}
 className={`nb-btn text-[13px] sm:text-sm px-1.5 sm:px-5 min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${view === 'discover' ? 'bg-nb-violet text-white' : ''}`}
 >
 <Search size={14} strokeWidth={2.5} className="hidden sm:inline" aria-hidden="true" /> Discover
 </button>
  <button
  role="tab"
  aria-selected={view === 'matches'}
  onClick={() => setView('matches')}
  className={`nb-btn text-[13px] sm:text-sm px-1.5 sm:px-5 min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${view === 'matches' ? 'bg-nb-pink text-white' : ''}`}
  >
  <Heart size={14} strokeWidth={2.5} className="hidden sm:inline" aria-hidden="true" /> Matches{(matchStats?.totalMatches ?? matches.length) > 0 && (<span className="hidden sm:inline-block ml-0.5 px-1.5 py-0.5 text-xs font-display border-nb-2 border-ink bg-nb-yellow text-ink" title="Total matches">{matchStats?.totalMatches ?? matches.length}</span>)}
 </button>
  <button
  role="tab"
  aria-selected={view === 'chat'}
  onClick={() => setView('chat')}
  className={`nb-btn text-[13px] sm:text-sm px-1.5 sm:px-5 min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${view === 'chat' ? 'bg-nb-peri text-ink' : ''}`}
  >
  <MessageSquare size={14} strokeWidth={2.5} className="hidden sm:inline" aria-hidden="true" /> Chat{conversations && conversations.length > 0 && (<span className="hidden sm:inline-block ml-0.5 px-1.5 py-0.5 text-xs font-display border-nb-2 border-ink bg-nb-yellow text-ink">{conversations.length}</span>)}
 </button>
 </div>
 </div>

 {/* Match celebration */}
 {matchBanner && (
 <div className="fixed inset-0 z-[80] bg-black/60 overflow-y-auto overscroll-contain" onClick={() => setMatchBanner(null)}>
 <div className="min-h-full flex items-center justify-center p-4" onClick={() => setMatchBanner(null)}>
  <div className="nb-card bg-nb-yellow p-6 sm:p-8 max-w-sm w-full min-w-0 text-center" role="dialog" aria-modal="true" aria-label="It's a match" onClick={(e) => e.stopPropagation()}>
 <PartyPopper size={48} strokeWidth={2.5} className="mx-auto mb-3 text-ink" />
 <h2 className="font-display font-bold text-2xl mb-1">It's a Match!</h2>
  <p className="font-body text-sm">
  You and {matchBanner.name} liked each other.
  </p>
  <div className="flex justify-center text-left mt-2 mb-1">
  <MatchReasons criteria={matchBanner.criteria} compact />
  </div>
 <div className="h-3" />
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
 </div>
 )}

 {/* Preferences editor */}
 {showPrefs && (
  <div className="fixed inset-0 z-[80] bg-black/60 overflow-y-auto overscroll-contain" onClick={() => setShowPrefs(false)}>
  <div className="min-h-full flex items-center justify-center p-3 sm:p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]" onClick={() => setShowPrefs(false)}>
  <div className="nb-card bg-white p-4 sm:p-6 max-w-sm w-full min-w-0 overflow-hidden" role="dialog" aria-modal="true" aria-label="Discovery preferences" onClick={(e) => e.stopPropagation()}>
  <h2 className="font-display font-bold text-xl mb-1 flex items-center gap-2">
  <SlidersHorizontal size={18} strokeWidth={2.5} /> Discovery preferences
  </h2>
  {!savedPrefs ? (
  <p className="text-xs font-body text-gray-500 mb-4" role="status">Loading your saved filters…</p>
  ) : (
  <p className="text-xs font-body text-gray-500 mb-4">Filters apply to your college deck instantly on save.</p>
  )}

 <label className="block font-display font-semibold text-sm mb-2">Show me</label>
 <div className="flex gap-2 mb-4 flex-wrap">
 {GENDERS.map((g) => (
 <button
 key={g.value}
 onClick={() => setPrefs((p) => ({ ...p, genderPreference: g.value }))}
 className={`nb-btn text-xs px-3 py-1.5 ${prefs.genderPreference === g.value ? 'bg-nb-violet text-white' : 'bg-white'}`}
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
 type="range" min={16} max={99} value={prefs.ageRangeMin}
 onChange={(e) => setPrefs((p) => ({ ...p, ageRangeMin: Math.min(Number(e.target.value), p.ageRangeMax - 1) }))}
 className="flex-1 accent-nb-violet"
 />
 <span className="font-display font-bold text-sm w-8 text-center">{prefs.ageRangeMin}</span>
 </div>
 <div className="flex items-center gap-3 mb-5">
 <input
 type="range" min={16} max={99} value={prefs.ageRangeMax}
 onChange={(e) => setPrefs((p) => ({ ...p, ageRangeMax: Math.max(Number(e.target.value), p.ageRangeMin + 1) }))}
 className="flex-1 accent-nb-violet"
 />
 <span className="font-display font-bold text-sm w-8 text-center">{prefs.ageRangeMax}</span>
 </div>

 {/* ── Looking for (intent matching) ── */}
 {/* SYNCED with the profile's "Looking for" — one setting, two doors. */}
  <label className="block font-display font-semibold text-sm mb-1">Looking for</label>
  <p className="text-xs text-gray-500 mb-2 font-body">
  Same setting as on your profile — change it here or there, it stays in sync.
  </p>
 <div className="flex gap-2 mb-2 flex-wrap">
 {GOALS.map((g) => {
 const on = prefs.openToGoals.includes(g.value);
 return (
 <button
 key={g.value}
 onClick={() => setPrefs((p) => ({
 ...p,
 openToGoals: on ? p.openToGoals.filter((x) => x !== g.value) : [...p.openToGoals, g.value],
 }))}
 className={`nb-btn text-xs px-3 py-1.5 ${on ? 'bg-nb-pink text-white' : 'bg-white'}`}
 title={g.hint}
 >
 {g.label}
 </button>
 );
 })}
 </div>
  <p className="text-xs text-gray-500 mb-4 font-body flex items-start gap-1">
 <Lock size={11} strokeWidth={2.5} className="mt-0.5 shrink-0" />
 <span>
 {prefs.openToGoals.length === 0
 ? 'Nothing picked — every goal can appear in your deck. '
 : 'Only these goals (plus people who haven\'t set one) will show up. '}
 Private: only you see this — nobody else ever does.
 </span>
 </p>

 {/* ── Dealbreakers ── */}
 <label className="block font-display font-semibold text-sm mb-2">Dealbreakers</label>
  <div className="space-y-2 mb-4 min-w-0">
  <div className="flex items-center gap-2 flex-wrap">
  <span className="font-body text-xs text-gray-600 shrink-0">Year</span>
 {[null, 1, 2, 3, 4].map((y) => (
 <button
 key={String(y)}
 onClick={() => setPrefs((p) => ({ ...p, minYear: y }))}
 className={`nb-btn text-xs px-2.5 py-1 ${prefs.minYear === y ? 'bg-nb-violet text-white' : 'bg-white'}`}
 >
 {y === null ? 'Any' : `${y}+`}
 </button>
 ))}
 </div>
{/* Shared-interest dealbreaker removed: shared interests are display-only now
(the chip on each card) — the deck already reflects profile + discovery prefs. */}
 </div>

  <div className="flex gap-2 justify-end">
  <button onClick={() => setShowPrefs(false)} className="nb-btn bg-white text-sm">Cancel</button>
  <button onClick={() => savePrefsMutation.mutate()} disabled={savePrefsMutation.isPending} aria-busy={savePrefsMutation.isPending} className="nb-btn-orange text-sm disabled:opacity-50 disabled:cursor-not-allowed">
  {savePrefsMutation.isPending ? 'Saving...' : 'Save'}
  </button>
  </div>
 </div>
 </div>
 </div>
 )}

 {view === 'discover' && (
 <>
{deck?.gated ? (
  /* PHOTO GATE — real apps (Tinder/Bumble/Hinge) all require a photo first */
  <div className="nb-card p-8 max-w-md mx-auto text-center">
  <div className="w-16 h-16 mx-auto mb-4 bg-nb-yellow border-nb-3 border-ink flex items-center justify-center">
  <Camera size={28} strokeWidth={2.5} />
  </div>
  <h2 className="font-display font-bold text-xl mb-2">Add a photo to start matching</h2>
  <p className="text-sm font-body text-gray-600 mb-5">
  Matching is for real people — every profile shows at least one photo.
  Add yours and your deck unlocks instantly.
  </p>
  <button
  onClick={() => navigate(deck?.actionUrl || '/settings')}
  className="nb-btn-orange text-sm inline-flex items-center gap-1.5"
  >
  <Camera size={14} strokeWidth={2.5} /> Add your photos
  </button>
  </div>
) : loadingDiscover ? (
 <LoadingSpinner />
) : !currentUser ? (
  <EmptyState
  icon={<SearchX strokeWidth={2.5} />}
  title="No one else to discover right now"
  description={
    deck?.totalFresh === 0
      ? "Your college doesn't have other active students with photos yet. Invite friends or check back soon!"
      : deckPage > 0
        ? "You've seen everyone matching your filters. Widen them or start over to loop passed profiles."
        : "You've seen everyone here. Check back later — new students join daily."
  }
  action={
    deckPage > 0
      ? <button onClick={() => setDeckPage(0)} className="nb-btn bg-white text-sm inline-flex items-center gap-1.5"><RotateCcw size={14} strokeWidth={2.5} /> Start over</button>
      : deck?.totalFresh === 0
        ? <button onClick={() => navigate('/settings')} className="nb-btn-orange text-sm inline-flex items-center gap-1.5"><UserPlus size={14} strokeWidth={2.5} /> Invite friends</button>
        : undefined
  }
  />
) : (
  <div className="nb-card p-4 sm:p-6 max-w-md mx-auto relative overflow-hidden min-w-0">
  {/* Pass — top corner, like every real swipe app */}
  <button
  onClick={() => !pendingAction && actionMutation.mutate({ receiverId: currentUser.id, action: 'pass' })}
  disabled={pendingAction?.action === 'pass'}
  aria-busy={pendingAction?.action === 'pass'}
  className="absolute top-3 right-3 w-10 h-10 bg-white border-nb-2 border-ink flex items-center justify-center hover:bg-nb-pink hover:text-white transition-colors z-10 disabled:opacity-50 disabled:cursor-not-allowed"
  title="Pass"
  aria-label="Pass"
  >
 <X size={18} strokeWidth={2.5} />
 </button>

  <div className="text-center min-w-0">
  {/* Photo carousel — profile pic + up to 3 extra photos. Clamped so the
      Like button stays above the fold on phones and small laptops. */}
  {cardPhotos.length > 0 ? (
  <div className="relative mb-4">
  <div className="nb-card overflow-hidden !p-0">
   <img
   key={cardPhotos[safePhotoIdx]}
   src={cardPhotos[safePhotoIdx]}
   alt={currentUser.displayName}
   decoding="async"
   draggable={false}
   loading="lazy"
   onError={() => setBrokenPhotos((b) => [...b, cardPhotos[safePhotoIdx]])}
   className="w-full aspect-[4/5] max-h-[52dvh] sm:max-h-[55vh] object-cover bg-nb-cream"
   />
  </div>
  {cardPhotos.length > 1 && (
  <>
  <button
  onClick={() => setPhotoIdx((i) => (i - 1 + cardPhotos.length) % cardPhotos.length)}
  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 border-nb-2 border-ink flex items-center justify-center"
  title="Previous photo"
  aria-label="Previous photo"
  >
  <ChevronLeft size={16} strokeWidth={2.5} />
  </button>
  <button
  onClick={() => setPhotoIdx((i) => (i + 1) % cardPhotos.length)}
  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 border-nb-2 border-ink flex items-center justify-center"
  title="Next photo"
  aria-label="Next photo"
  >
  <ChevronRight size={16} strokeWidth={2.5} />
  </button>
  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5" role="tablist" aria-label="Photos">
  {cardPhotos.map((_, i) => (
  <button
  key={i}
  role="tab"
  aria-selected={i === safePhotoIdx}
  aria-label={`Photo ${i + 1} of ${cardPhotos.length}`}
  onClick={() => setPhotoIdx(i)}
  className={`w-2.5 h-2.5 border border-ink ${i === safePhotoIdx ? 'bg-nb-yellow' : 'bg-white'}`}
  />
  ))}
  </div>
  </>
  )}
 </div>
  ) : (
  <div className="mb-4">
  <Avatar src={currentUser.avatarUrl} photoId={currentUser.avatarPhotoId} name={currentUser.displayName} size="xl" className="mx-auto" />
  </div>
  )}

  <h2 className="font-display font-bold text-xl break-words overflow-wrap-anywhere px-8">{currentUser.displayName}</h2>

  <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1.5 px-2">
  {currentUser.isVerified && <span className="inline-flex items-center" title="Verified student"><BadgeCheck size={15} strokeWidth={2.5} className="text-nb-mint" /></span>}
  {currentUser.sharedInterests != null && currentUser.sharedInterests > 0 && (
  <span className="nb-badge bg-nb-yellow text-ink text-xs inline-flex items-center gap-1">
  <Sparkles size={10} strokeWidth={3} /> {currentUser.sharedInterests} shared interest{currentUser.sharedInterests === 1 ? '' : 's'}
  </span>
  )}
  {currentUser.theyLikedMe && (
  <span className="nb-badge bg-nb-pink text-white text-xs inline-flex items-center gap-1" title="They already liked you — like back to match instantly">
  <Heart size={10} strokeWidth={3} fill="currentColor" /> likes you
  </span>
  )}
  {currentUser.recycled && (
  <span className="nb-badge bg-nb-peri text-ink text-xs inline-flex items-center gap-1" title="You passed on this profile earlier — it's back around in your loop">
  <RotateCcw size={10} strokeWidth={3} /> back in your loop
  </span>
  )}
  </div>
  <p className="text-sm text-gray-500 font-body truncate px-2">@{currentUser.username}</p>

  <p className="mt-2 text-sm font-body break-words px-2">
  {[currentUser.course, currentUser.college?.shortName || currentUser.college?.name, currentUser.age ? `${currentUser.age} yrs` : null]
  .filter(Boolean)
  .join(' • ')}
  </p>

  {currentUser.bio && (
  <p className="mt-3 text-sm font-body text-gray-600 italic break-words overflow-wrap-anywhere line-clamp-4 px-2">"{currentUser.bio}"</p>
  )}

  {currentUser.interests?.length > 0 && (
  <div className="mt-4 flex flex-wrap gap-1.5 justify-center max-h-24 overflow-y-auto overscroll-contain px-1">
  {currentUser.interests.map((i: any) => (
  <span key={i.id} className="nb-tag text-xs break-words">{i.name}</span>
  ))}
  </div>
  )}

  {/* Like — the single big centered action */}
  <div className="flex items-center justify-center gap-4 mt-6">
  {/* Rewind — undo the last pass (Tinder's signature mercy button) */}
  <button
  onClick={() => !rewindMutation.isPending && rewindMutation.mutate()}
  disabled={rewindMutation.isPending}
  aria-busy={rewindMutation.isPending}
  className="w-11 h-11 bg-white border-nb-2 border-ink flex items-center justify-center hover:bg-nb-yellow transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  title="Undo last pass (10 min window)"
  aria-label="Undo last pass"
  >
  <Undo2 size={18} strokeWidth={2.5} />
  </button>
  <button
  onClick={() => !pendingAction && actionMutation.mutate({ receiverId: currentUser.id, action: 'like' })}
  disabled={pendingAction?.action === 'like'}
  aria-busy={pendingAction?.action === 'like'}
  className="nb-btn-pink w-16 h-16 !p-0 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
  title="Like"
  aria-label={`Like ${currentUser.displayName}`}
  >
  <Heart size={26} strokeWidth={2.5} fill="currentColor" />
  </button>
  </div>

  {deck && (
  <p className="mt-4 text-xs text-gray-500 font-body break-words">
  {deck.totalRemaining} student{deck.totalRemaining === 1 ? '' : 's'} in your deck
 {!!matchStats?.likesYou && (
 <span className="ml-1 text-nb-pink font-semibold">• {matchStats.likesYou} waiting to match with you</span>
 )}
 </p>
 )}
 </div>
 </div>
 )}
 </>
 )}

  {view === 'matches' && (
  <>
  {/* Waiting for you — people who already liked you. Answering here is the
      fastest path to a match; no need to wait for their card in the deck. */}
  {loadingLikesYou ? (
  <LoadingSpinner size="sm" />
  ) : waiting.length > 0 ? (
  <div className="mb-5">
  <h2 className="font-display font-bold text-base mb-2 flex items-center gap-1.5">
  <Heart size={16} strokeWidth={2.5} className="text-nb-pink fill-current" />
  Waiting for you
  <span className="px-1.5 py-0.5 text-xs font-display border-nb-2 border-ink bg-nb-yellow text-ink">{waiting.length}</span>
  </h2>
  <div className="flex gap-3 overflow-x-auto overscroll-x-contain pb-2 -mx-1 px-1">
  {waiting.map((w: any) => (
  <div key={w.id} className="nb-card p-3 w-44 shrink-0 text-center">
  <Avatar src={w.avatarUrl} photoId={w.avatarPhotoId ?? w.photos?.[0]?.id} name={w.displayName} className="mx-auto" />
  <p className="font-display font-semibold text-sm mt-2 truncate">{w.displayName}{w.age ? `, ${w.age}` : ''}</p>
  <p className="text-xs text-gray-500 truncate">{[w.course, w.college?.shortName || w.college?.name].filter(Boolean).join(' • ') || `@${w.username}`}</p>
  {w.isVerified && <p className="text-xs text-nb-mint font-semibold mt-0.5">✓ Verified</p>}
  <div className="flex gap-1.5 mt-2">
  <Link to={`/profile/${w.username}`} className="nb-btn bg-white text-xs flex-1 text-center px-2 py-1.5">View</Link>
  <button
  onClick={() => !likeBackId && likeBackMutation.mutate(w.id)}
  disabled={likeBackId === w.id}
  aria-busy={likeBackId === w.id}
  aria-label={`Like ${w.displayName} back`}
  className="nb-btn-pink text-xs flex-1 px-2 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
  >
  {likeBackId === w.id ? '…' : 'Like back'}
  </button>
  </div>
  </div>
  ))}
  </div>
  </div>
  ) : null}
  {loadingMatches ? (
  <LoadingSpinner />
  ) : !matches.length && waiting.length === 0 ? (
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
   <div key={match.id} className="nb-card-hover p-4 flex items-start gap-3">
   <Avatar src={match.partner.avatarUrl} photoId={match.partner.avatarPhotoId} name={match.partner.displayName} />
   <div className="flex-1 min-w-0">
   <p className="font-display font-semibold text-sm">{match.partner.displayName}</p>
   <p className="text-xs text-gray-500 truncate">{match.partner.bio || 'No bio yet'}</p>
   {match.criteria && (match.criteria.goals?.length || match.criteria.interests?.length) ? (
   <MatchReasons criteria={match.criteria} compact />
   ) : null}
   </div>
  {conv && (
  <Link
  to={`/messages/${conv.id}`}
  className="nb-btn bg-nb-peri text-ink text-xs shrink-0"
  >
  <MessageSquare size={12} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Chat
  </Link>
  )}
  <button
  onClick={() => !unmatchMutation.isPending && unmatchMutation.mutate(match.id)}
  disabled={unmatchMutation.isPending}
  aria-label={`Unmatch ${match.partner.displayName}`}
  className="text-gray-500 hover:text-nb-pink transition-colors shrink-0 p-2 min-w-[44px] min-h-[44px] grid place-items-center disabled:opacity-50"
  title="Unmatch"
  >
  <UserMinus size={16} strokeWidth={2.5} />
  </button>
  </div>
  );
  })}
  </div>
  )}
  {matches.length > 0 && matchesHasMore && (
  <button
  onClick={() => setMatchesPage((p) => p + 1)}
  disabled={fetchingMatches}
  aria-busy={fetchingMatches}
  className="nb-btn-ghost w-full text-center text-sm mt-3 disabled:opacity-50 disabled:cursor-not-allowed"
  >
  {fetchingMatches ? 'Loading...' : 'Show more matches'}
  </button>
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
 <Avatar src={conv.otherUser.avatarUrl} photoId={conv.otherUser.avatarPhotoId} name={conv.otherUser.displayName} />
 <div className="flex-1 min-w-0">
 <p className="font-display font-semibold text-sm">{conv.otherUser.displayName}</p>
 <p className="text-xs text-gray-500 truncate font-body">
 {conv.lastMessage?.isDeleted ? 'Message deleted' : conv.lastMessage?.content || 'No messages yet'}
 </p>
 </div>
  {conv.lastMessage && (
  <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">
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
