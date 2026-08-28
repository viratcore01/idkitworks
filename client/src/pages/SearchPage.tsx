import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { MOCK_SEARCH } from '@/data/mock';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';

  const { data: apiData, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
    enabled: !!q,
    retry: false,
  });

  const data = apiData?.users?.length ? apiData : (q ? MOCK_SEARCH : null);

  return (
    <div>
      <h1 className="font-display font-bold text-2xl text-nb-black mb-4">
        🔍 Search {q && `for "${q}"`}
      </h1>

      {!q ? (
        <EmptyState
          icon="🔍"
          title="Search for people, posts, or colleges"
          description="Use the search bar above to find what you're looking for."
        />
      ) : isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-6">
          {/* People */}
          {data?.users?.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-lg mb-3">👥 People</h2>
              <div className="space-y-2">
                {data.users.map((user: any) => (
                  <Link
                    key={user.id}
                    to={`/profile/${user.username}`}
                    className="nb-card-hover p-3 flex items-center gap-3 block"
                  >
                    <Avatar src={user.avatarUrl} name={user.displayName} />
                    <div>
                      <p className="font-display font-semibold text-sm">{user.displayName}</p>
                      <p className="text-xs text-gray-500">
                        @{user.username} {user.college && `• ${user.college.shortName || user.college.name}`}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Posts */}
          {data?.posts?.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-lg mb-3">📝 Posts</h2>
              <div className="space-y-2">
                {data.posts.map((post: any) => (
                  <div key={post.id} className="nb-card p-4">
                    <p className="text-sm text-gray-500 font-body">
                      by {post.author.displayName}
                    </p>
                    <p className="font-body text-sm mt-1 line-clamp-3">{post.content}</p>
                    <div className="mt-2 flex gap-3 text-xs text-gray-400">
                      <span>❤️ {post._count.likes}</span>
                      <span>💬 {post._count.comments}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Colleges */}
          {data?.colleges?.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-lg mb-3">🏫 Colleges</h2>
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

          {(!data?.users?.length && !data?.posts?.length && !data?.colleges?.length) && (
            <EmptyState
              icon="🤔"
              title="No results found"
              description={`Nothing found for "${q}". Try a different search.`}
            />
          )}
        </div>
      )}
    </div>
  );
}
