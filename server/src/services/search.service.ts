import { prisma } from '../config/prisma';

const SEARCH_MAX = 100;

/**
 * Determine if a user is a minor (under 18) based on dateOfBirth.
 * Missing DOB = treated as adult (conservative default for safety).
 */
function isMinor(dob: Date | null): boolean {
  if (!dob) return false;
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
  return age < 18;
}

/**
 * Rank a user against the query the way real search bars do:
 *   0 — exact match (username or display name, case-insensitive)
 *   1 — starts with the query
 *   2 — a word in the name starts with the query ("pri" → "Priya Sharma")
 *   3 — contains the query anywhere
 */
function rankUser(q: string, username: string, displayName: string): number {
  const un = (username || '').toLowerCase();
  const dn = (displayName || '').toLowerCase();
  if (un === q || dn === q) return 0;
  if (un.startsWith(q) || dn.startsWith(q)) return 1;
  if (dn.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  return 3;
}

/** User rows returned to the client, without any private fields. */
const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  
  avatarPhotoId: true,
  college: true,
  course: true,
  year: true,
} as const;

export class SearchService {
  async search(query: string, userId: string, viewerCollegeId?: string | null) {
    const raw = query.trim().slice(0, SEARCH_MAX);
    if (!raw) return { users: [], posts: [], colleges: [] };

    // PRODUCT RULE: hyperlocal search — only your college exists.
    if (!viewerCollegeId) return { users: [], posts: [], colleges: [] };

    // ═══════════════════════════════════════════════════════════════
    // STRICT AGE SEGREGATION — minors only search minors, adults only search adults
    // ═══════════════════════════════════════════════════════════════
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } });
    const viewerMinor = isMinor(viewer?.dateOfBirth ?? null);
    const today = new Date();
    const eighteenCutoff = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
    const ageFilter = viewerMinor
      ? { dateOfBirth: { gt: eighteenCutoff } } // minor: only search minors
      : { dateOfBirth: { lte: eighteenCutoff } }; // adult: only search adults

    // Sanitize for Prisma `contains` (which is regex-powered): neutralize the
    // special characters instead of throwing, so "c++" or "(wifi)" just search.
    const q = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();
    const prefixQ = q + '%';

    // Blocked users disappear from search — both directions
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = Array.from(
      new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== userId)),
    );

    const userWhere: any = {
      isActive: true,
      collegeId: viewerCollegeId, // PRODUCT RULE: your college only
      ...ageFilter, // STRICT AGE SEGREGATION
      ...(blockedIds.length && { id: { notIn: blockedIds } }),
    };

    // Postgres full-text search for posts: matches whole phrases and
    // prefix words ("mess fo" finds "mess food"). Falls back to contains
    // automatically through the same call.
    const postsWhere: any = {
      deletedAt: null,
      author: { collegeId: viewerCollegeId, isActive: true }, // PRODUCT RULE: your college only
    };

    const [rawUsers, rawPosts] = await Promise.all([
      prisma.user.findMany({
        where: {
          ...userWhere,
          OR: [
            { username: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 20,
        select: USER_SELECT,
      }),
      prisma.$queryRaw<any[]>`
        SELECT p.id, p."content", p."createdAt", p."isAnonymous",
               p."authorId",
               u.username AS "authorUsername", u."displayName" AS "authorDisplayName",
               u."avatarUrl" AS "authorAvatarUrl",
               u."avatarPhotoId" AS "authorAvatarPhotoId",
               (SELECT COUNT(*)::int FROM comments c WHERE c."post_id" = p.id AND c."deleted_at" IS NULL) AS "commentCount",
               (SELECT COUNT(*)::int FROM post_likes pl WHERE pl."post_id" = p.id) AS "likeCount",
               ts_rank(to_tsvector('english', p."content"), plainto_tsquery('english', ${raw})) AS rank
        FROM posts p
        JOIN users u ON u.id = p."author_id"
        WHERE p."deleted_at" IS NULL
          AND u."is_active" = true
          AND u."college_id" = ${viewerCollegeId}
          AND to_tsvector('english', p."content") @@ plainto_tsquery('english', ${raw})
        ORDER BY rank DESC, p."createdAt" DESC
        LIMIT 10
      `.catch(() =>
        // FTS unavailable → graceful contains fallback, same shape
        prisma.post.findMany({
          where: { ...postsWhere, content: { contains: q, mode: 'insensitive' } },
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, content: true, createdAt: true, isAnonymous: true, authorId: true,
            author: {
              select: { username: true, displayName: true, avatarUrl: true,  avatarPhotoId: true },
            },
            _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
          },
        }),
      ),
    ]);

    // Rank + cap users the smart-search way
    const users = (rawUsers as any[])
      .map((u) => ({ ...u, _rank: rankUser(q.toLowerCase(), u.username, u.displayName) }))
      .sort((a, b) => a._rank - b._rank || a.displayName.localeCompare(b.displayName))
      .slice(0, 10)
      .map(({ _rank, ...u }) => u);

    // Normalize posts into one shape regardless of which query produced them
    const posts = (rawPosts as any[]).map((p: any) => ({
      id: p.id,
      content: p.content,
      createdAt: p.createdAt,
      isAnonymous: p.isAnonymous,
      author: {
        id: p.author?.id ?? p.authorId,
        username: p.author?.username ?? p.authorUsername,
        displayName: p.author?.displayName ?? p.authorDisplayName,
        avatarUrl: p.author?.avatarUrl ?? p.authorAvatarUrl,
        
        avatarPhotoId: p.author?.avatarPhotoId ?? p.authorAvatarPhotoId,
      },
      _count: { comments: p._count?.comments ?? p.commentCount ?? 0, likes: p._count?.likes ?? p.likeCount ?? 0 },
    }));

    // Anonymous posts must not leak their authors through search
    const safePosts = posts.map((p) =>
      p.isAnonymous
        ? {
            ...p,
            author: {
              id: 'anonymous',
              username: 'anonymous',
              displayName: 'Anonymous Student',
              avatarUrl: null,
              
              avatarPhotoId: null,
            },
          }
        : p,
    );

    return { users, posts: safePosts, colleges: [] }; // colleges removed: cross-college discovery is against the product rule
  }
}
