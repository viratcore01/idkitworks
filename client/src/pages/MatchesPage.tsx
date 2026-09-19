import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Heart, MessageSquare, X, HeartCrack, SearchX, MessageSquareOff, SlidersHorizontal, PartyPopper, UserMinus, RotateCcw, Zap, Camera, ImageOff, ChevronLeft, ChevronRight, Undo2, BadgeCheck, Sparkles, Lock } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
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
 sharedInterestMin: 0,
 });
 const [photoIdx, setPhotoIdx] = useState(0);
 const queryClient = useQueryClient();
 const navigate = useNavigate();  const { data: deck, isLoading: loadingDiscover } = useQuery({
 queryKey: ['match-discover', deckPage],
 queryFn: () => api.get('/matches/discover', { params: { page: deckPage } }).then((r) => r.data),
 enabled: view === 'discover',
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

 const { data: matchesData, isLoading: loadingMatches } = useQuery({
 queryKey: ['matches'],
 queryFn: () => api.get('/matches').then((r) => r.data),
 // Always on: the tab badge needs a live count even before the tab is opened
 });

 // MATCHED-ON BASIS: the MATCH notifications carry the criteria snapshot
 // ("you both listed Dating · chess"). Reused here so the matches list shows
 // exactly what brought each pair together.
 const { data: notifData } = useQuery({
 queryKey: ['notifications'],
 queryFn: () => api.get('/notifications').then((r) => r.data),
 });
 const criteriaByPartnerId: Record<string, any> = {};
 for (const n of (notifData?.notifications || []) as any[]) {
 if (n.type === 'MATCH' && n.matchId && n.actor?.id) {
 criteriaByPartnerId[n.actor.id] = n.metadata || null;
 }
 }

 const { data: conversations, isLoading: loadingConversations } = useQuery({
 queryKey: ['conversations'],
 queryFn: () => api.get('/messages/conversations').then((r) => r.data),
 });

 const { data: savedPrefs } = useQuery({
 queryKey: ['match-preferences'],
 queryFn: () => api.get('/matches/preferences').then((r) => r.data),
 });

 // Waiting likes — powers the "N waiting" chip on the deck header
 const { data: matchStats } = useQuery({
 queryKey: ['match-stats'],
 queryFn: () => api.get('/matches/stats').then((r) => r.data),
 });

 const users = deck?.users || [];
 const currentIndex = 0; // each action moves to the next card; page refetch gives a fresh deck
 const currentUser = users[currentIndex];
 const matches = matchesData?.matches || [];

 // Reset the photo carousel whenever a new card comes up
 useEffect(() => {
 setPhotoIdx(0);
 }, [currentUser?.id]);

 /** All displayable photos of the current card: stored slots first, then avatarUrl. */
 const pv = usePhotoVersion(); // token rotation → rebuild URLs → images reload
 const cardPhotos: string[] = currentUser
 ? [
 ...(currentUser.photos || []).map((p: any) => photoSrc(p.id)),
 currentUser.avatarUrl || null,
 ].filter(Boolean as any)
 : [];

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
 criteria: data.criteria,
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
 ageRangeMin: savedPrefs.ageRangeMin || 16,
 ageRangeMax: savedPrefs.ageRangeMax || 60,
 openToGoals: savedPrefs.openToGoals || [],
 minYear: savedPrefs.minYear ?? null,
 sharedInterestMin: savedPrefs.sharedInterestMin ?? 0,
 });
 }
 setShowPrefs(true);
 };

 return (
 <div>
 <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
 <h1 className="font-display font-bold text-2xl text-ink flex items-center gap-2">
 <Heart size={22} strokeWidth={2.5} className="text-nb-pink fill-current" /> Find Match
 </h1>
 <div className="flex gap-2 flex-wrap">
 <button
 onClick={() => setView('discover')}
 className={`nb-btn text-sm ${view === 'discover' ? 'bg-nb-violet text-white' : ''}`}
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
 className={`nb-btn text-sm ${view === 'chat' ? 'bg-nb-peri text-ink' : ''}`}
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
 <div className="fixed inset-0 z-[80] bg-black/60 overflow-y-auto overscroll-contain" onClick={() => setMatchBanner(null)}>
 <div className="min-h-full flex items-center justify-center p-4" onClick={() => setMatchBanner(null)}>
 <div className="nb-card bg-nb-yellow p-8 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
 <PartyPopper size={48} strokeWidth={2.5} className="mx-auto mb-3 text-ink" />
 <h2 className="font-display font-bold text-2xl mb-1">It's a Match!</h2>
 <p className="font-body text-sm">
 You and {matchBanner.name} liked each other.
 </p>
 {matchBanner.criteria && (matchBanner.criteria.goals?.length || matchBanner.criteria.interests?.length) ? (
 <div className="flex flex-wrap justify-center gap-1.5 mt-3 mb-1">
 {matchBanner.criteria.goals.map((g) => (
 <span key={g} className="nb-badge bg-nb-violet text-white text-[11px] px-2 py-1">
 Looking for: {g === 'DATING' ? 'Dating' : g === 'RELATIONSHIP' ? 'Relationship' : g === 'HOOKUP' ? 'Hookup' : g === 'CASUAL' ? 'Casual' : 'Not sure'}
 </span>
 ))}
 {matchBanner.criteria.interests.slice(0, 4).map((i) => (
 <span key={i.id} className="nb-badge bg-white text-ink text-[11px] px-2 py-1">{i.name}</span>
 ))}
 {matchBanner.criteria.interests.length > 4 && (
 <span className="nb-badge bg-white text-ink text-[11px] px-2 py-1">+{matchBanner.criteria.interests.length - 4} more</span>
 )}
 </div>
 ) : (
 <p className="text-[11px] text-gray-500 mt-1 mb-1 italic">You two don't have any listed criteria in common — the rest is chemistry.</p>
 )
 }
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
 <div className="min-h-full flex items-center justify-center p-4" onClick={() => setShowPrefs(false)}>
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
 <p className="text-[11px] text-gray-500 mb-2 font-body">
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
 <p className="text-[11px] text-gray-500 mb-4 font-body flex items-start gap-1">
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
 <div className="space-y-2 mb-4">
 <div className="flex items-center gap-2">
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
 <div className="flex items-center gap-2">
 <span className="font-body text-xs text-gray-600 shrink-0">Shared interests</span>
 {[0, 1, 2, 3].map((n) => (
 <button
 key={n}
 onClick={() => setPrefs((p) => ({ ...p, sharedInterestMin: n }))}
 className={`nb-btn text-xs px-2.5 py-1 ${prefs.sharedInterestMin === n ? 'bg-nb-violet text-white' : 'bg-white'}`}
 >
 {n === 0 ? 'Off' : `${n}+`}
 </button>
 ))}
 </div>
 </div>

 <div className="flex gap-2 justify-end">
 <button onClick={() => setShowPrefs(false)} className="nb-btn bg-white text-sm">Cancel</button>
 <button onClick={() => savePrefsMutation.mutate()} disabled={savePrefsMutation.isPending} className="nb-btn-orange text-sm">
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
 onClick={() => navigate(`/profile/${useAuthStore.getState().user?.username || ''}`)}
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
 <div className="nb-card p-6 max-w-md mx-auto relative">
 {/* Pass — top corner, like every real swipe app */}
 <button
 onClick={() => actionMutation.mutate({ receiverId: currentUser.id, action: 'pass' })}
 disabled={actionMutation.isPending}
 className="absolute top-3 right-3 w-9 h-9 bg-white border-nb-2 border-ink flex items-center justify-center hover:bg-nb-pink hover:text-white transition-colors z-10"
 title="Pass"
 >
 <X size={18} strokeWidth={2.5} />
 </button>

 <div className="text-center">
 {/* Photo carousel — profile pic + up to 3 extra photos */}
 {cardPhotos.length > 0 ? (
 <div className="relative mb-4">
 <div className="nb-card overflow-hidden !p-0">
 <img
 src={cardPhotos[photoIdx]}
 alt={currentUser.displayName}
 className="w-full aspect-[4/5] object-cover"
 />
 </div>
 {cardPhotos.length > 1 && (
 <>
 <button
 onClick={() => setPhotoIdx((i) => (i - 1 + cardPhotos.length) % cardPhotos.length)}
 className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 border-nb-2 border-ink flex items-center justify-center"
 title="Previous photo"
 >
 <ChevronLeft size={16} strokeWidth={2.5} />
 </button>
 <button
 onClick={() => setPhotoIdx((i) => (i + 1) % cardPhotos.length)}
 className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 border-nb-2 border-ink flex items-center justify-center"
 title="Next photo"
 >
 <ChevronRight size={16} strokeWidth={2.5} />
 </button>
 <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
 {cardPhotos.map((_, i) => (
 <span key={i} className={`w-2 h-2 border border-ink ${i === photoIdx ? 'bg-nb-yellow' : 'bg-white'}`} />
 ))}
 </div>
 </>
 )}
 </div>
 ) : (
 <div className="mb-4">
 <Avatar src={currentUser.avatarUrl} name={currentUser.displayName} size="xl" className="mx-auto" />
 </div>
 )}

 <h2 className="font-display font-bold text-xl">{currentUser.displayName}</h2>

 {currentUser.isVerified && <BadgeCheck size={15} strokeWidth={2.5} className="text-nb-mint inline-block align-text-bottom" />}
 {currentUser.sharedInterests != null && currentUser.sharedInterests > 0 && (
 <span className="nb-badge bg-nb-yellow text-ink text-[10px] inline-flex items-center gap-1 mb-1">
 <Sparkles size={10} strokeWidth={3} /> {currentUser.sharedInterests} shared interest{currentUser.sharedInterests === 1 ? '' : 's'}
 </span>
 )}
 {currentUser.theyLikedMe && (
 <span className="nb-badge bg-nb-pink text-white text-[10px] inline-flex items-center gap-1 mb-1" title="They already liked you — like back to match instantly">
 <Heart size={10} strokeWidth={3} fill="currentColor" /> likes you
 </span>
 )}
 {currentUser.recycled && (
 <span className="nb-badge bg-nb-peri text-ink text-[10px] inline-flex items-center gap-1 mb-1" title="You passed on this profile earlier — it's back around in your loop">
 <RotateCcw size={10} strokeWidth={3} /> back in your loop
 </span>
 )}
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

 {/* Like — the single big centered action */}
 <div className="flex items-center justify-center gap-4 mt-6">
 {/* Rewind — undo the last pass (Tinder's signature mercy button) */}
 <button
 onClick={() => rewindMutation.mutate()}
 disabled={rewindMutation.isPending}
 className="w-11 h-11 bg-white border-nb-2 border-ink flex items-center justify-center hover:bg-nb-yellow transition-colors disabled:opacity-50"
 title="Undo last pass (10 min window)"
 >
 <Undo2 size={18} strokeWidth={2.5} />
 </button>
 <button
 onClick={() => actionMutation.mutate({ receiverId: currentUser.id, action: 'like' })}
 disabled={actionMutation.isPending}
 className="nb-btn-pink w-16 h-16 !p-0 flex items-center justify-center "
 title="Like"
 >
 <Heart size={26} strokeWidth={2.5} fill="currentColor" />
 </button>
 </div>

 {deck && (
 <p className="mt-4 text-[11px] text-gray-500 font-body">
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
 <Avatar src={match.partner.avatarUrl} photoId={match.partner.avatarPhotoId} color={match.partner.avatarColor} name={match.partner.displayName} />
 <div className="flex-1 min-w-0">
 <p className="font-display font-semibold text-sm">{match.partner.displayName}</p>
 <p className="text-xs text-gray-500 truncate">{match.partner.bio || 'No bio yet'}</p>
 {(() => {
 const criteria = criteriaByPartnerId[match.partner.id];
 const goals: string[] = criteria?.goals || [];
 const interests: any[] = criteria?.interests || [];
 if (!goals.length && !interests.length) return null;
 return (
 <div className="flex flex-wrap items-center gap-1 mt-1">
 <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Matched on:</span>
 {goals.map((g) => (
 <span key={g} className="nb-badge bg-nb-violet text-white text-[10px] px-1.5 py-0.5">{GOAL_LABEL[g] || g}</span>
 ))}
 {interests.slice(0, 3).map((i) => (
 <span key={i.id} className="nb-badge bg-nb-peri text-ink text-[10px] px-1.5 py-0.5">{i.name}</span>
 ))}
 {interests.length > 3 && (
 <span className="text-[10px] text-gray-400">+{interests.length - 3} more</span>
 )}
 </div>
 );
 })()}
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
 onClick={() => unmatchMutation.mutate(match.id)}
 className="text-gray-500 hover:text-nb-pink transition-colors shrink-0 p-1"
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
 <Avatar src={conv.otherUser.avatarUrl} photoId={conv.otherUser.avatarPhotoId} color={conv.otherUser.avatarColor} name={conv.otherUser.displayName} />
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
