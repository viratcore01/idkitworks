import { prisma } from '../config/prisma';

const SEARCH_MAX = 100;

export class SearchService {
  async search(query: string, userId: string, viewerCollegeId?: string | null) {
    const q = query.trim().slice(0, SEARCH_MAX);
    if (!q) return { users: [], posts: [], colleges: [] };

    // PRODUCT RULE: hyperlocal search — only your college exists.
    if (!viewerCollegeId) return { users: [], posts: [], colleges: [] };

    // Blocked users disappear from search — both directions
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = Array.from(
      new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== userId)),
    );

    const [users, posts] = await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          collegeId: viewerCollegeId, // PRODUCT RULE: your college only
          ...(blockedIds.length && { id: { notIn: blockedIds } }),
          OR: [
            { username: { contains: q } },
            { displayName: { contains: q } },
          ],
        },
        take: 10,
        select: {
          id: true, username: true, displayName: true, avatarUrl: true, avatarColor: true,
          college: true, course: true, year: true,
        },
      }),
      prisma.post.findMany({
        where: {
          deletedAt: null,
          content: { contains: q },
          author: { collegeId: viewerCollegeId, isActive: true }, // PRODUCT RULE: your college only
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: { id: true, username: true, displayName: true, avatarUrl: true, avatarColor: true },
          },
          _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
        },
      }),
    ]);

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
              avatarColor: null,
            },
          }
        : p,
    );

    return { users, posts: safePosts, colleges: [] }; // colleges removed: cross-college discovery is against the product rule
  }
}
