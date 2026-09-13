import { prisma } from '../config/prisma';

export class NotificationService {
  async getNotifications(userId: string, limit = 20, cursor?: string, viewerCollegeId?: string | null) {
    const take = Math.min(Math.max(limit, 1), 50);
    const notifications = await prisma.notification.findMany({
      where: {
        recipientId: userId,
        // PRODUCT RULE: college-only — never surface an actor from another college.
        // OR actorId:null keeps ANONYMOUS notifications visible: a relation
        // filter alone would silently hide every actor-less notification.
        ...(viewerCollegeId && {
          OR: [{ actor: { collegeId: viewerCollegeId } }, { actorId: null }],
        }),
      },
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
    const count = await prisma.notification.count({
      where: {
        recipientId: userId,
        isRead: false,
        // Keep the badge consistent with the filtered list (includes anonymous)
        ...(viewerCollegeId && {
          OR: [{ actor: { collegeId: viewerCollegeId } }, { actorId: null }],
        }),
      },
    });
    return { count };
  }
}
