import { prisma } from '../config/prisma';

export class MessageService {
  async getOrCreateConversation(userId: string, otherUserId: string) {
    if (!otherUserId || otherUserId === userId) throw new Error('Invalid conversation target');

    const [me, other] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } }),
      prisma.user.findUnique({ where: { id: otherUserId }, select: { collegeId: true, isActive: true } }),
    ]);
    if (!other || !other.isActive) throw new Error('User not available');

    // PRODUCT RULE: college-only chat. Conversations can never be created across
    // colleges — even with a guessed userId.
    if (!me?.collegeId || me.collegeId !== other.collegeId) {
      const e: any = new Error('User not available'); e.status = 404; throw e;
    }

    // Blocks stop conversations cold — either direction
    const blocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: otherUserId },
          { blockerId: otherUserId, blockedId: userId },
        ],
      },
    });
    if (blocked) throw new Error('Cannot message this user');

    // Check if conversation already exists between these two users
    const existingMember = await prisma.conversationMember.findFirst({
      where: { userId: otherUserId },
      include: { conversation: { include: { members: true } } },
    });

    if (existingMember) {
      const conv = existingMember.conversation;
      if (conv.members.some((m) => m.userId === userId)) {
        return conv;
      }
    }

    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        members: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
    });

    return conversation;
  }

  async getConversations(userId: string, viewerCollegeId?: string | null) {
    const memberships = await prisma.conversationMember.findMany({
      where: {
        userId,
        // PRODUCT RULE: hide any thread that has ANY member outside your college
        // (only possible from legacy data — creation is already college-locked).
        ...(viewerCollegeId && {
          conversation: { members: { none: { user: { collegeId: { not: viewerCollegeId } } } } },
        }),
      },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
              },
            },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { conversation: { messages: { _count: 'desc' } } },
    });

    return memberships.map((m) => {
      const conv = m.conversation;
      const otherMember = conv.members.find((mem) => mem.userId !== userId);
      const raw = conv.messages[0] || null;
      const lastMessage = raw
        ? {
            ...raw,
            content: raw.deletedAt ? 'Message deleted' : raw.content,
            isDeleted: !!raw.deletedAt,
          }
        : null;
      return {
        id: conv.id,
        otherUser: otherMember?.user,
        lastMessage,
        updatedAt: raw?.createdAt || conv.createdAt,
      };
    });
  }

  async getMessages(conversationId: string, userId: string, limit = 50, cursor?: string) {
    // Verify user is a member
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) throw new Error('Not a member of this conversation');

    const messages = await prisma.message.findMany({
      // Deleted messages stay in the thread as tombstones (WhatsApp-style)
      where: { conversationId },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, limit) : messages;

    return {
      messages: data.reverse().map((m) => ({
        ...m,
        content: m.deletedAt ? '' : m.content,
        isDeleted: !!m.deletedAt,
      })),
      nextCursor: hasMore ? data[0]?.id : null,
    };
  }

  /** Edit own message. Real apps window this; we keep the window short (15 min). */
  async editMessage(conversationId: string, messageId: string, senderId: string, content: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId || message.deletedAt) {
      throw new Error('Message not found');
    }
    if (message.senderId !== senderId) throw new Error('You can only edit your own messages');
    if (Date.now() - message.createdAt.getTime() > 15 * 60 * 1000) {
      throw new Error('Message can no longer be edited');
    }
    if (!content.trim()) throw new Error('Message cannot be empty');

    return prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
  }

  /** Soft-delete own message: becomes a "Message deleted" placeholder for everyone. */
  async deleteMessage(conversationId: string, messageId: string, senderId: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId || message.deletedAt) {
      throw new Error('Message not found');
    }
    if (message.senderId !== senderId) throw new Error('You can only delete your own messages');

    await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: '' },
    });
    return { deleted: true };
  }

  async sendMessage(conversationId: string, senderId: string, content: string, mediaUrl?: string) {
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: senderId } },
    });
    if (!member) throw new Error('Not a member of this conversation');

    const trimmed = String(content || '').trim();
    if (!trimmed) throw new Error('Message cannot be empty');
    if (trimmed.length > 2000) throw new Error('Message must be under 2000 characters');

    // Blocks stop new messages even in an existing thread
    const members = await prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    const otherIds = members.map((m) => m.userId).filter((id) => id !== senderId);
    if (otherIds.length) {
      const blocked = await prisma.block.findFirst({
        where: { OR: otherIds.flatMap((id) => [
          { blockerId: senderId, blockedId: id },
          { blockerId: id, blockedId: senderId },
        ]) },
      });
      if (blocked) throw new Error('Cannot message this user');
    }

    const message = await prisma.message.create({
      data: { conversationId, senderId, content: trimmed, mediaUrl },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });

    // Notify other members
    const otherMembers = await prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: senderId } },
    });

    await prisma.notification.createMany({
      data: otherMembers.map((m) => ({
        recipientId: m.userId,
        actorId: senderId,
        type: 'NEW_MESSAGE' as const,
      })),
    });

    return message;
  }
}
