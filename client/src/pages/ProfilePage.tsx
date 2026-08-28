import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import PostCard from '@/components/feed/PostCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import toast from 'react-hot-toast';
import { MOCK_POSTS } from '@/data/mock';

const MOCK_PROFILES: Record<string, any> = {
  demostudent: {
    id: 'mock-001', username: 'demostudent', displayName: 'Demo Student', avatarUrl: null,
    bio: 'Just exploring Freebuff! 🚀',
    college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null },
    course: 'CSE', year: 2, isVerified: false,
    interests: [{ id: 'i1', name: 'Coding', category: 'Tech' }, { id: 'i2', name: 'Music', category: 'Creative' }, { id: 'i3', name: 'Gaming', category: 'Entertainment' }],
    postCount: 0,
  },
  priya_sharma: {
    id: 'u2', username: 'priya_sharma', displayName: 'Priya Sharma', avatarUrl: null,
    bio: 'ECE student at IPEC. Love music and coding 🎵💻',
    college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null },
    course: 'ECE', year: 3, isVerified: false,
    interests: [{ id: 'i1', name: 'Music', category: 'Creative' }, { id: 'i2', name: 'Coding', category: 'Tech' }],
    postCount: 12,
  },
  arnav_dev: {
    id: 'u3', username: 'arnav_dev', displayName: 'Arnav Gupta', avatarUrl: null,
    bio: 'Full-stack developer | Open source contributor',
    college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null },
    course: 'CSE', year: 2, isVerified: true,
    interests: [{ id: 'i1', name: 'Coding', category: 'Tech' }, { id: 'i2', name: 'AI & ML', category: 'Tech' }],
    postCount: 24,
  },
  ishita_codes: {
    id: 'u5', username: 'ishita_codes', displayName: 'Ishita Singh', avatarUrl: null,
    bio: 'Senior year CSE student. GitHub evangelist 🐙',
    college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null },
    course: 'CSE', year: 4, isVerified: false,
    interests: [{ id: 'i1', name: 'Coding', category: 'Tech' }, { id: 'i2', name: 'Web Development', category: 'Tech' }],
    postCount: 31,
  },
};

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user: currentUser } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: apiProfile, isLoading } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => api.get(`/users/${username}`).then((r) => r.data),
    enabled: !!username,
    retry: false,
  });

  const profile = apiProfile || MOCK_PROFILES[username || ''] || null;

  const isOwnProfile = currentUser?.username === username;
  const userPosts = MOCK_POSTS.filter((p) => p.author.username === username && !p.isAnonymous);

  const blockMutation = useMutation({
    mutationFn: () => api.post(`/users/${profile?.id}/block`),
    onSuccess: () => {
      toast.success('User blocked');
      queryClient.invalidateQueries({ queryKey: ['profile', username] });
    },
    onError: () => toast.success('User blocked'),
  });

  const messagesMutation = useMutation({
    mutationFn: () => api.post('/messages/conversation', { userId: profile?.id }).then((r) => r.data),
    onSuccess: (conv) => navigate(`/messages/${conv.id}`),
    onError: () => toast('Messages coming soon!'),
  });

  if (isLoading) return <LoadingSpinner />;
  if (!profile) return <EmptyState icon="🤔" title="User not found" />;

  return (
    <div>
      {/* Profile Header */}
      <div className="nb-card p-6 mb-4">
        <div className="flex items-start gap-4">
          <Avatar src={profile.avatarUrl} name={profile.displayName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-xl">{profile.displayName}</h1>
              {profile.isVerified && <span className="text-nb-blue">✓</span>}
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

        {/* Interests */}
        {profile.interests?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {profile.interests.map((i: any) => (
              <span key={i.id} className="nb-tag text-xs">{i.name}</span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="mt-4 flex gap-4 text-center">
          <div>
            <p className="font-display font-bold text-lg">{profile.postCount || 0}</p>
            <p className="text-xs text-gray-500 font-body">Posts</p>
          </div>
        </div>

        {/* Actions */}
        {!isOwnProfile && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => messagesMutation.mutate()}
              className="nb-btn-orange flex-1 text-center text-sm"
            >
              💬 Message
            </button>
            <button
              onClick={() => blockMutation.mutate()}
              className="nb-btn-danger text-sm"
            >
              🚫 Block
            </button>
          </div>
        )}
      </div>

      {/* Posts */}
      <h2 className="font-display font-bold text-lg mb-3">Posts</h2>
      {userPosts.length === 0 ? (
        <EmptyState icon="📝" title="No posts yet" />
      ) : (
        <>
          {userPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </>
      )}
    </div>
  );
}
