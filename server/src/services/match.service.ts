import { prisma } from '../config/prisma';

export class MatchService {
  async discover(userId: string, limit = 20) {
    // Get users not already liked/blocked
    const likedIds = await prisma.matchLike.findMany({
      where: { senderId: userId },
      select: { receiverId: true },
    });

    const blockedIds = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });

    const excludeIds = new Set([
      userId,
      ...likedIds.map((l) => l.receiverId),
      ...blockedIds.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
    ]);

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        id: { notIn: Array.from(excludeIds) },
      },
      take: limit,
      select: {
        id: true, username: true, displayName: true, avatarUrl: true,
        college: true, course: true, year: true, bio: true,
        interests: { include: { interest: true } },
      },
    });

    return users.map((u) => ({ ...u, interests: u.interests.map((ui) => ui.interest) }));
  }

  async like(senderId: string, receiverId: string) {
    if (senderId === receiverId) throw new Error("Can't like yourself");

    // Check if blocked
    const blocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId },
        ],
      },
    });
    if (blocked) throw new Error('Cannot like this user');

    await prisma.matchLike.upsert({
      where: { senderId_receiverId: { senderId, receiverId } },
      create: { senderId, receiverId },
      update: {},
    });

    // Check for mutual like
    const mutual = await prisma.matchLike.findUnique({
      where: { senderId_receiverId: { senderId: receiverId, receiverId: senderId } },
    });

    if (mutual) {
      // Create match
      const [userA, userB] = [senderId, receiverId].sort();
      const match = await prisma.match.create({
        data: { userA, userB, type: 'DATING' },
      });

      // Notify both users
      await prisma.notification.createMany({
        data: [
          { recipientId: senderId, actorId: receiverId, type: 'MATCH', matchId: match.id },
          { recipientId: receiverId, actorId: senderId, type: 'MATCH', matchId: match.id },
        ],
      });

      return { matched: true, match };
    }

    return { matched: false };
  }

  async pass(senderId: string, receiverId: string) {
    // Just record the like with a "pass" — or simply skip
    // For V1, passing means doing nothing
    return { passed: true };
  }

  async getMatches(userId: string) {
    const matches = await prisma.match.findMany({
      where: {
        OR: [{ userA: userId }, { userB: userId }],
        status: 'ACTIVE',
      },
      include: {
        userAObj: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true } },
        userBObj: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return matches.map((m) => ({
      ...m,
      partner: m.userA === userId ? m.userBObj : m.userAObj,
    }));
  }

  async updatePreference(userId: string, data: {
    lookingFor?: string;
    ageRangeMin?: number;
    ageRangeMax?: number;
    collegePreference?: string;
  }) {
    return prisma.matchPreference.upsert({
      where: { userId },
      create: {
        userId,
        lookingFor: (data.lookingFor as any) || 'DATING',
        ageRangeMin: data.ageRangeMin,
        ageRangeMax: data.ageRangeMax,
        collegePreference: data.collegePreference,
      },
      update: {
        ...(data.lookingFor && { lookingFor: data.lookingFor as any }),
        ...(data.ageRangeMin !== undefined && { ageRangeMin: data.ageRangeMin }),
        ...(data.ageRangeMax !== undefined && { ageRangeMax: data.ageRangeMax }),
        ...(data.collegePreference !== undefined && { collegePreference: data.collegePreference }),
      },
    });
  }
}
