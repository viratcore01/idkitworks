import { prisma } from '../config/prisma';

export class UserService {
  async getPublicProfile(username: string, viewerId: string) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        college: true,
        interests: { include: { interest: true } },
        _count: { select: { posts: true } },
      },
    });

    if (!user || !user.isActive) return null;

    // Check if blocked
    const blocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: user.id },
          { blockerId: user.id, blockedId: viewerId },
        ],
      },
    });

    if (blocked) return { blocked: true };

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      college: user.college,
      course: user.course,
      year: user.year,
      isVerified: user.isVerified,
      interests: user.interests.map((ui) => ui.interest),
      postCount: user._count.posts,
      createdAt: user.createdAt,
    };
  }

  async getUserPosts(username: string, viewerId: string, limit = 20, cursor?: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('User not found');

    const posts = await prisma.post.findMany({
      where: { authorId: user.id, deletedAt: null },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: true, likes: true } },
        likes: { where: { userId: viewerId }, select: { userId: true } },
      },
    });

    const hasMore = posts.length > limit;
    const data = hasMore ? posts.slice(0, limit) : posts;

    return {
      posts: data.map((p) => ({ ...p, isLikedByMe: p.likes.length > 0, likes: undefined })),
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new Error("Can't block yourself");
    return prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
  }

  async unblock(blockerId: string, blockedId: string) {
    return prisma.block.delete({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
  }

  async getBlockedUsers(userId: string) {
    const blocks = await prisma.block.findMany({
      where: { blockerId: userId },
      include: {
        blocked: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
    return blocks.map((b) => b.blocked);
  }

  async getAllColleges() {
    return prisma.college.findMany({ orderBy: { name: 'asc' } });
  }

  async getAllInterests() {
    return prisma.interest.findMany({ orderBy: { name: 'asc' } });
  }
}
