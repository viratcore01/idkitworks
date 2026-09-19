import { prisma } from '../config/prisma';

export class NotificationService {
  /** Blocked actors never surface — either direction is a hard wall. */
  private async blockedActorIds(userId: string): Promise<string[]> {
    const { prisma: db } = await import('../config/prisma');
    const blocks = await db.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const b of blocks) {
      if (b.blockerId !== userId) ids.add(b.blockerId);
      if (b.blockedId !== userId) ids.add(b.blockedId);
    }
    return Array.from(ids);
  }

  async getNotifications(userId: string, limit = 20, cursor?: string, viewerCollegeId?: string | null) {
    const take = Math.min(Math.max(limit, 1), 50);
    const excluded = await this.blockedActorIds(userId);
    // NOTE: actorId:null (anonymous) must stay visible — SQL NULL never
    // matches NOT IN, so excluded actors are filtered via OR(null, notIn).
    const blockFilter = excluded.length
      ? { OR: [{ actorId: null }, { actorId: { notIn: excluded } }] }
      : {};
    const notifications = await prisma.notification.findMany({
      where: {
        recipientId: userId,
        AND: [
          blockFilter,
          // PRODUCT RULE: college-only — never surface an actor from another college.
          // OR actorId:null keeps ANONYMOUS notifications visible: a relation
          // filter alone would silently hide every actor-less notification.
          ...(viewerCollegeId ? [{ OR: [{ actor: { collegeId: viewerCollegeId } }, { actorId: null }] }] : []),
        ],
      } as any,
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarColor: true, avatarPhotoId: true } },
      },
    });

    const hasMore = notifications.length > take;
    const data = hasMore ? notifications.slice(0, take) : notifications;

    return {
      notifications: data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'All notifications marked as read' };
  }

  async getUnreadCount(userId: string, viewerCollegeId?: string | null) {
    const excluded = await this.blockedActorIds(userId);
    const blockFilter = excluded.length
      ? { OR: [{ actorId: null }, { actorId: { notIn: excluded } }] }
      : {};
    const count = await prisma.notification.count({
      where: {
        recipientId: userId,
        isRead: false,
        AND: [
          blockFilter,
          // Keep the badge consistent with the filtered list (includes anonymous)
          ...(viewerCollegeId ? [{ OR: [{ actor: { collegeId: viewerCollegeId } }, { actorId: null }] }] : []),
        ],
      } as any,
    });
    return { count };
  }
}
