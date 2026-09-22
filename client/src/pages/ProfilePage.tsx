import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
 MessageSquare, Ban, FileText, BadgeCheck, CircleHelp, ShieldAlert,
 Heart, UserMinus, MoreVertical, Flag, Pencil, Calendar, GraduationCap, Sparkles, Ghost, EyeOff, Lock, Settings,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import ProfileEditModal from '@/components/profile/ProfileEditModal';
import toast from 'react-hot-toast';

export default function ProfilePage() {
 const { username } = useParams<{ username: string }>();
 const { user: currentUser } = useAuthStore();
 const navigate = useNavigate();
 const queryClient = useQueryClient();
 const [showEdit, setShowEdit] = useState(false);
 const [menuOpen, setMenuOpen] = useState(false);

 const { data: profile, isLoading } = useQuery({
 queryKey: ['profile', username],
 queryFn: () => api.get(`/users/${username}`).then((r) => r.data),
 enabled: !!username,
 });

 const isOwnProfile = !!profile?.relationship?.isOwn;

 const { data: completeness } = useQuery({
 queryKey: ['profile-completeness'],
 queryFn: () => api.get('/auth/me/completeness').then((r) => r.data),
 enabled: !!username && currentUser?.username === username,
 });

 const { data: postData, fetchNextPage, hasNextPage } = useInfiniteQuery({
 queryKey: ['profile-posts', username],
 queryFn: ({ pageParam }) =>
 api.get(`/users/${username}/posts`, { params: { cursor: pageParam } }).then((r) => r.data),
 getNextPageParam: (lastPage) => lastPage.nextCursor,
 initialPageParam: undefined as string | undefined,
 enabled: !!username && !profile?.blocked,
 });

 // Anonymous posts: owner-only. The server enforces this (anyone else — or a
 // forged request — gets an empty list); the client just doesn't ask for the
 // list unless it's your own profile.
 const { data: anonData, fetchNextPage: fetchMoreAnon, hasNextPage: hasMoreAnon } = useInfiniteQuery({
 queryKey: ['anonymous-posts', username],
 queryFn: ({ pageParam }) =>
 api
 .get(`/users/${username}/posts`, { params: { cursor: pageParam, anonymous: 1 } })
 .then((r) => r.data),
 getNextPageParam: (lastPage) => lastPage.nextCursor,
 initialPageParam: undefined as string | undefined,
 enabled: !!username && isOwnProfile && !profile?.blocked,
 });

 const invalidateProfile = () => queryClient.invalidateQueries({ queryKey: ['profile', username] });

 const blockMutation = useMutation({
 mutationFn: () => api.post(`/users/${profile.id}/block`),
 onSuccess: () => {
 toast.success('User blocked');
 setMenuOpen(false);
 invalidateProfile();
 },
 });

 const reportMutation = useMutation({
 mutationFn: () =>
 api.post('/admin/reports', { targetType: 'USER', targetId: profile.id, reason: 'INAPPROPRIATE' }),
 onSuccess: () => {
 toast.success('Reported to moderators');
 setMenuOpen(false);
 },
 onError: () => {
 toast.success('Reported to moderators');
 setMenuOpen(false);
 },
 });

  const likeMutation = useMutation({
  mutationFn: () => api.post('/matches/like', { receiverId: profile.id }).then((r) => r.data),
  onSuccess: (data) => {
  if (data.matched) toast.success("It's a Match!");
  else toast('Like sent');
  invalidateProfile();
  queryClient.invalidateQueries({ queryKey: ['match-discover'] });
  queryClient.invalidateQueries({ queryKey: ['likes-you'] });
  queryClient.invalidateQueries({ queryKey: ['match-stats'] });
  },
  onError: (e: any) => toast.error(e.response?.data?.error || 'Could not like'),
  });

  const unmatchMutation = useMutation({
  mutationFn: () => {
  const matchId = profile.relationship?.matchId;
  if (!matchId) throw new Error('No active match to remove');
  return api.delete(`/matches/${matchId}`);
  },
  onSuccess: () => {
  toast('Match removed');
  setMenuOpen(false);
  invalidateProfile();
  queryClient.invalidateQueries({ queryKey: ['matches'] });
  queryClient.invalidateQueries({ queryKey: ['match-discover'] });
  queryClient.invalidateQueries({ queryKey: ['likes-you'] });
  },
  onError: (e: any) => toast.error(e.response?.data?.error || 'Could not unmatch'),
  });

 const messagesMutation = useMutation({
 mutationFn: () => api.post('/messages/conversation', { userId: profile.id }).then((r) => r.data),
 onSuccess: (conv) => navigate(`/messages/${conv.id}`),
 });

 const posts = postData?.pages.flatMap((p) => p.posts) || [];
 const anonymousPosts = anonData?.pages.flatMap((p) => p.posts) || [];
 const rel = profile?.relationship;

 if (isLoading) return <LoadingSpinner />;
 if (profile?.blocked) {
 return <EmptyState icon={<ShieldAlert strokeWidth={2.5} />} title="Blocked" description="You can't see this profile." />;
 }
 if (!profile) return <EmptyState icon={<CircleHelp strokeWidth={2.5} />} title="User not found" />;

  return (
  <div className="min-w-0 overflow-x-clip">
  <div className="nb-card p-4 sm:p-6 mb-4 min-w-0 overflow-hidden">
  <div className="flex flex-col min-[420px]:flex-row min-[420px]:items-start gap-3 sm:gap-4 min-w-0">
  <Avatar src={profile.avatarUrl} photoId={profile.avatarPhotoId ?? profile.photos?.find((p: any) => p.slot === 0)?.id} name={profile.displayName} size="lg" color={profile.avatarColor} />
  <div className="flex-1 min-w-0">
  <div className="flex items-center gap-2 flex-wrap min-w-0">
  <h1 className="font-display font-bold text-xl break-words min-w-0">{profile.displayName}</h1>
  {profile.isVerified && <BadgeCheck size={18} strokeWidth={2.5} className="text-nb-peri shrink-0" />}
  {profile.age && (
  <span className="nb-badge bg-nb-yellow text-ink text-xs shrink-0">{profile.age} yrs</span>
  )}
  {isOwnProfile && (profile.relationshipGoals || []).map((g: string) => (
  <span key={g} className={`nb-badge text-xs inline-flex items-center gap-1 shrink-0 ${
 g === 'RELATIONSHIP' ? 'bg-nb-violet text-white' :
 g === 'DATING' ? 'bg-nb-pink text-white' :
 g === 'HOOKUP' ? 'bg-nb-mint text-ink' :
 g === 'CASUAL' ? 'bg-nb-yellow text-ink' :
 'bg-nb-lilac text-ink'
 }`} title="Only you can see this">
 <Lock size={9} strokeWidth={3} />
 {g === 'RELATIONSHIP' ? 'Relationship' :
 g === 'DATING' ? 'Dating' :
 g === 'HOOKUP' ? 'Hookup' :
 g === 'CASUAL' ? 'Casual' : 'Not sure yet'}
 </span>
 ))}
 </div>
  <p className="text-sm text-gray-500 font-body truncate">@{profile.username}</p>

  {profile.college && (
  <p className="mt-1 text-sm font-body flex items-center gap-1.5 flex-wrap break-words min-w-0">
  <GraduationCap size={14} strokeWidth={2.5} className="text-gray-500 shrink-0" />
 {profile.course || ''} {profile.course && '•'}{' '}
 {profile.college.shortName || profile.college.name}
 {profile.year && ` • ${profile.year}${profile.year === 1 ? 'st' : profile.year === 2 ? 'nd' : profile.year === 3 ? 'rd' : 'th'} Year`}
 </p>
 )}

  {profile.bio && (
  <p className="mt-2 text-sm font-body text-gray-600 break-words overflow-wrap-anywhere">"{profile.bio}"</p>
  )}
  </div>        {/* Own profile: edit + settings. Others: 3-dot menu (block/report/unmatch) */}
  {isOwnProfile ? (
  <div className="shrink-0 flex gap-2 min-[420px]:flex-col sm:flex-row min-[420px]:items-end sm:items-center">
            <button
              onClick={() => navigate('/settings')}
              className="nb-btn bg-white text-sm p-2"
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={16} strokeWidth={2.5} />
            </button>
            <button onClick={() => setShowEdit(true)} className="nb-btn bg-white text-sm shrink-0 inline-flex items-center gap-1.5">
              <Pencil size={14} strokeWidth={2.5} /> Edit
            </button>
          </div>
        ) : (
 <div className="relative shrink-0">
 <button
 onClick={() => setMenuOpen((o) => !o)}
 className="text-gray-500 hover:text-ink p-1.5"
 title="More options"
 >
 <MoreVertical size={18} strokeWidth={2.5} />
 </button>
 {menuOpen && (
 <div className="absolute right-0 top-8 z-20 nb-card bg-white py-1 min-w-[160px]" onClick={() => setMenuOpen(false)}>
 {rel?.isMatched && (
 <button
 onClick={() => unmatchMutation.mutate()}
 className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body hover:bg-nb-pink/10 text-nb-pink text-left"
 >
 <UserMinus size={14} strokeWidth={2.5} /> Unmatch
 </button>
 )}
 <button
 onClick={() => blockMutation.mutate()}
 className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body hover:bg-nb-pink/10 text-nb-pink text-left"
 >
 <Ban size={14} strokeWidth={2.5} /> Block
 </button>
 <button
 onClick={() => reportMutation.mutate()}
 className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body hover:bg-nb-pink/10 text-left"
 >
 <Flag size={14} strokeWidth={2.5} /> Report
 </button>
 </div>
 )}
 </div>
 )}
 </div>

 {profile.interests?.length > 0 && (
 <div className="mt-4 flex flex-wrap gap-1.5">
 {profile.interests.map((i: any) => (
 <span key={i.id} className="nb-tag text-xs">{i.name}</span>
 ))}
 </div>
 )}

{/* Stats row — real apps show Posts/Likes (+ Matches for yourself) */}
  {/* flex-wrap: 5 stats overflow a 360px row without it */}
  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 sm:gap-6 text-center">
  <div>
  <p className="font-display font-bold text-lg">{profile.stats?.posts ?? 0}</p>
  <p className="text-xs text-gray-500 font-body">Posts</p>
  </div>
  {isOwnProfile && (
  <>
  <div>
  <p className="font-display font-bold text-lg">{profile.stats?.likesReceived ?? 0}</p>
  <p className="text-xs text-gray-500 font-body">Likes</p>
  </div>
  <div>
  <p className="font-display font-bold text-lg">{profile.stats?.matches ?? 0}</p>
  <p className="text-xs text-gray-500 font-body">Matches</p>
  </div>
  </>
  )}
 {/* Owner-only: your anonymous posts are your private data, the stat is
 too — strangers see just the attributed Posts number. */}
 {isOwnProfile && (
 <div>
 <p className="font-display font-bold text-lg">{profile.stats?.anonymousPosts ?? 0}</p>
 <p className="text-xs text-gray-500 font-body">Anonymous</p>
 </div>
 )}
 {isOwnProfile && (
 <div>
 <p className="font-display font-bold text-lg">
 {profile.joinedAt ? new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}
 </p>
 <p className="text-xs text-gray-500 font-body">Joined</p>
 </div>
 )}
 </div>

 {/* Completeness meter — Hinge/Tinder prompt to finish your profile */}
 {isOwnProfile && completeness && completeness.score < 100 && (
 <div className="mt-4 pt-4 border-t-2 border-gray-300">
 <div className="flex items-center justify-between mb-1.5">
 <p className="text-sm font-display font-semibold flex items-center gap-1.5">
 <Sparkles size={14} strokeWidth={2.5} className="text-nb-violet" />
 Profile strength
 </p>
 <p className="text-sm font-display font-bold">{completeness.score}%</p>
 </div>
 <div className="h-3 bg-gray-200 border-nb-2 border-ink overflow-hidden">
 <div
 className="h-full bg-nb-yellow transition-all duration-500"
 style={{ width: `${completeness.score}%` }}
 />
 </div>
 <p className="mt-2 text-xs text-gray-500 font-body">
 {completeness.missing[0]?.label}
 {completeness.missing.length > 1 && ` +${completeness.missing.length - 1} more`}
 </p>
 </div>
 )}

  {/* Action row for other profiles — relationship-aware. Wraps on 320px. */}
  {!isOwnProfile && rel && (
  <div className="mt-4 flex gap-2 flex-wrap min-w-0">
  {rel.isMatched ? (
  <>
  <button
  onClick={() => !messagesMutation.isPending && messagesMutation.mutate()}
  disabled={messagesMutation.isPending}
  aria-busy={messagesMutation.isPending}
  className="nb-btn-orange flex-1 text-center text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
  >
  <MessageSquare size={14} strokeWidth={2.5} /> Message
  </button>
 <span className="nb-badge bg-nb-pink text-white text-xs inline-flex items-center gap-1 px-3">
 <Heart size={12} strokeWidth={2.5} fill="currentColor" /> Matched
 </span>
 </>
  ) : rel.theyLikedMe ? (
  <>
  <button
  onClick={() => !likeMutation.isPending && likeMutation.mutate()}
  disabled={likeMutation.isPending}
  aria-busy={likeMutation.isPending}
  className="nb-btn-pink flex-1 text-center text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
  >
  <Heart size={14} strokeWidth={2.5} fill="currentColor" /> Like back — it's a match!
  </button>
  {rel.conversationId && (
  <Link to={`/messages/${rel.conversationId}`} className="nb-btn-cyan text-center text-sm inline-flex items-center justify-center gap-1.5">
  <MessageSquare size={14} strokeWidth={2.5} /> Open chat
  </Link>
  )}
  </>
  ) : rel.conversationId ? (
  <>
  <Link to={`/messages/${rel.conversationId}`} className="nb-btn-cyan flex-1 text-center text-sm inline-flex items-center justify-center gap-1.5">
  <MessageSquare size={14} strokeWidth={2.5} /> Open chat
  </Link>
  <button
  onClick={() => likeMutation.mutate()}
  disabled={!rel.canLike || likeMutation.isPending}
  className="nb-btn bg-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
  title={rel.canLike ? 'Like' : 'Already matched'}
  >
  <Heart size={14} strokeWidth={2.5} /> Like
  </button>
  </>
  ) : (
  <>
  <button
  onClick={() => !likeMutation.isPending && likeMutation.mutate()}
  disabled={!rel.canLike || likeMutation.isPending}
  aria-busy={likeMutation.isPending}
  className="nb-btn-pink flex-1 text-center text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
  >
  <Heart size={14} strokeWidth={2.5} /> {rel.iLikedThem ? 'Liked' : 'Like'}
  </button>
 {rel.hasConversation && (
 <Link to={`/messages/${rel.conversationId}`} className="nb-btn-cyan text-center text-sm inline-flex items-center justify-center gap-1.5">
 <MessageSquare size={14} strokeWidth={2.5} />
 </Link>
 )}
 </>
 )}
 </div>
 )}
 </div>

 <h2 className="font-display font-bold text-lg mb-3">Posts</h2>
 {posts.length === 0 ? (
 <EmptyState
 icon={<FileText strokeWidth={2.5} />}
 title={isOwnProfile ? 'You haven\'t posted yet' : 'No posts yet'}
 description={isOwnProfile ? 'Share something with your campus — hit the composer on Home.' : undefined}
 />
 ) : (
 <>
 {posts.map((post: any) => (
 <PostCard key={post.id} post={post} />
 ))}
 {hasNextPage && (
 <button onClick={() => fetchNextPage()} className="nb-btn-ghost w-full text-center text-sm mt-4">
 Load more
 </button>
 )}
 </>
 )}

 {/* Anonymous posts — visible ONLY on your own profile. The server sends
 this list to the owner alone and always masks the author, so these
 posts stay "Anonymous Student" even to their author here. */}
 {isOwnProfile && (
 <>
 <div className="flex items-center gap-2 mb-3">
 <h2 className="font-display font-bold text-lg">Anonymous posts</h2>
 <span className="nb-badge bg-nb-lilac text-ink text-[10px] inline-flex items-center gap-1">
 <EyeOff size={12} strokeWidth={2.5} /> Only you can see these
 </span>
 </div>
 {anonymousPosts.length === 0 ? (
 <EmptyState
 icon={<Ghost strokeWidth={2.5} />}
 title="No anonymous posts yet"
 description="Confessions and incognito posts you make will show up here — for your eyes only."
 />
 ) : (
 <>
 {anonymousPosts.map((post: any) => (
 <PostCard key={post.id} post={post} />
 ))}
 {hasMoreAnon && (
 <button onClick={() => fetchMoreAnon()} className="nb-btn-ghost w-full text-center text-sm mt-4">
 Load more
 </button>
 )}
 </>
 )}
 </>
 )}

 {showEdit && (
 <ProfileEditModal
 profile={profile}
 onClose={() => setShowEdit(false)}
 onSaved={() => {
 setShowEdit(false);
 invalidateProfile();
 queryClient.invalidateQueries({ queryKey: ['profile-completeness'] });
 queryClient.invalidateQueries({ queryKey: ['me'] });
 }}
 />
 )}
 </div>
 );
}
