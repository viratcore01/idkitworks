import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { MessageSquare, Ban, FileText, BadgeCheck, CircleHelp, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user: currentUser } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => api.get(`/users/${username}`).then((r) => r.data),
    enabled: !!username,
  });

  const { data: postData, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ['profile-posts', username],
    queryFn: ({ pageParam }) =>
      api.get(`/users/${username}/posts`, { params: { cursor: pageParam } }).then((r) => r.data),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!username && !profile?.blocked,
  });

  const blockMutation = useMutation({
    mutationFn: () => api.post(`/users/${profile.id}/block`),
    onSuccess: () => {
      toast.success('User blocked');
      queryClient.invalidateQueries({ queryKey: ['profile', username] });
    },
  });

  const messagesMutation = useMutation({
    mutationFn: () => api.post('/messages/conversation', { userId: profile.id }).then((r) => r.data),
    onSuccess: (conv) => navigate(`/messages/${conv.id}`),
  });

  const posts = postData?.pages.flatMap((p) => p.posts) || [];
  const isOwnProfile = currentUser?.username === username;

  if (isLoading) return <LoadingSpinner />;
  if (profile?.blocked) {
    return <EmptyState icon={<ShieldAlert strokeWidth={2.5} />} title="Blocked" description="You can't see this profile." />;
  }
  if (!profile) return <EmptyState icon={<CircleHelp strokeWidth={2.5} />} title="User not found" />;

  return (
    <div>
      <div className="nb-card p-6 mb-4">
        <div className="flex items-start gap-4">
          <Avatar src={profile.avatarUrl} name={profile.displayName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-xl">{profile.displayName}</h1>
              {profile.isVerified && <BadgeCheck size={18} strokeWidth={2.5} className="text-nb-blue" />}
            </div>
            <p className="text-sm text-gray-500 font-body">@{profile.username}</p>

            {profile.college && (
              <p className="mt-1 text-sm font-body">
                {profile.course || ''} {profile.course && '•'}{' '}
                {profile.college.shortName || profile.college.name}
                {profile.year && ` • ${profile.year}${profile.year === 1 ? 'st' : 'nd'} Year`}
              </p>
            )}

            {profile.bio && (
              <p className="mt-2 text-sm font-body text-gray-600">"{profile.bio}"</p>
            )}
          </div>
        </div>

        {profile.interests?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {profile.interests.map((i: any) => (
              <span key={i.id} className="nb-tag text-xs">{i.name}</span>
            ))}
          </div>
        )}

        <div className="mt-4 flex gap-4 text-center">
          <div>
            <p className="font-display font-bold text-lg">{profile.postCount || 0}</p>
            <p className="text-xs text-gray-500 font-body">Posts</p>
          </div>
        </div>

        {!isOwnProfile && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => messagesMutation.mutate()}
              className="nb-btn-orange flex-1 text-center text-sm inline-flex items-center justify-center gap-1.5"
            >
              <MessageSquare size={14} strokeWidth={2.5} /> Message
            </button>
            <button onClick={() => blockMutation.mutate()} className="nb-btn-danger text-sm inline-flex items-center gap-1.5">
              <Ban size={14} strokeWidth={2.5} /> Block
            </button>
          </div>
        )}
      </div>

      <h2 className="font-display font-bold text-lg mb-3">Posts</h2>
      {posts.length === 0 ? (
        <EmptyState icon={<FileText strokeWidth={2.5} />} title="No posts yet" />
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
    </div>
  );
}
