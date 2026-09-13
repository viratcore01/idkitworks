import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Heart, MessageCircle, Users, FileText, GraduationCap, CircleHelp, SearchX } from 'lucide-react';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { formatDistanceToNow } from '@/utils/date';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';

  const { data, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
    enabled: !!q,
  });

  return (
    <div>
      <h1 className="font-display font-bold text-2xl text-nb-black mb-4 flex items-center gap-2">
        <Search size={22} strokeWidth={2.5} /> Search {q && `for "${q}"`}
      </h1>

      {!q ? (
        <EmptyState
          icon={<Search strokeWidth={2.5} />}
          title="Search for people, posts, or colleges"
          description="Use the search bar at the top to find students, posts, or your college."
        />
      ) : isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-6">
          {data?.users?.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2">
                <Users size={18} strokeWidth={2.5} /> People
              </h2>
              <div className="space-y-2">
                {data.users.map((user: any) => (
                  <Link
                    key={user.id}
                    to={`/profile/${user.username}`}
                    className="nb-card-hover p-3 flex items-center gap-3 block"
                  >
                    <Avatar src={user.avatarUrl} photoId={user.avatarPhotoId} color={user.avatarColor} name={user.displayName} />
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-sm">{user.displayName}</p>
                      <p className="text-xs text-gray-500 truncate">
                        @{user.username} {user.course && `• ${user.course}`}
                        {user.college && ` • ${user.college.shortName || user.college.name}`}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data?.posts?.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2">
                <FileText size={18} strokeWidth={2.5} /> Posts
              </h2>
              <div className="space-y-2">
                {data.posts.map((post: any) => (
                  <Link key={post.id} to={`/post/${post.id}`} className="nb-card-hover p-4 block">
                    <p className="text-xs text-gray-500 font-body">
                      {post.isAnonymous ? 'Anonymous' : `by ${post.author.displayName}`} · {formatDistanceToNow(post.createdAt)}
                    </p>
                    <p className="font-body text-sm mt-1 line-clamp-3">{post.content}</p>
                    <div className="mt-2 flex gap-3 text-xs text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <Heart size={12} strokeWidth={2.5} className={post._count.likes > 0 ? 'text-nb-red fill-current' : ''} /> {post._count.likes}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle size={12} strokeWidth={2.5} /> {post._count.comments}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data?.colleges?.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2">
                <GraduationCap size={18} strokeWidth={2.5} /> Colleges
              </h2>
              <div className="space-y-2">
                {data.colleges.map((college: any) => (
                  <div key={college.id} className="nb-card p-4">
                    <p className="font-display font-semibold">{college.name}</p>
                    <p className="text-sm text-gray-500">{college.city}, {college.state}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!data?.users?.length && !data?.posts?.length && !data?.colleges?.length && (
            <EmptyState
              icon={<SearchX strokeWidth={2.5} />}
              title="No results"
              description={`Nothing matched "${q}". Try a different search.`}
            />
          )}
        </div>
      )}
    </div>
  );
}
