import { prisma } from '../config/prisma';

export class NotificationService {
  async getNotifications(userId: string, limit = 20, cursor?: string) {
    const notifications = await prisma.notification.findMany({
      where: { recipientId: userId },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });

    const hasMore = notifications.length > limit;
    const data = hasMore ? notifications.slice(0, limit) : notifications;

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

  async getUnreadCount(userId: string) {
    const count = await prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });
    return { count };
  }
}
