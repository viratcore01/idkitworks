import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';

export class SearchService {
  async search(query: string, userId: string) {
    const q = query.trim();
    if (!q) return { users: [], posts: [], colleges: [] };

    const [users, posts, colleges] = await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { username: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 10,
        select: {
          id: true, username: true, displayName: true, avatarUrl: true,
          college: true, course: true, year: true,
        },
      }),
      prisma.post.findMany({
        where: {
          deletedAt: null,
          content: { contains: q, mode: 'insensitive' },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
          _count: { select: { comments: true, likes: true } },
        },
      }),
      prisma.college.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        take: 5,
      }),
    ]);

    return { users, posts, colleges };
  }
}
