import { prisma } from '../config/prisma';

export class MessageService {
  async getOrCreateConversation(userId: string, otherUserId: string) {
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

  async getConversations(userId: string) {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId },
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
      const lastMessage = conv.messages[0] || null;
      return {
        id: conv.id,
        otherUser: otherMember?.user,
        lastMessage,
        updatedAt: lastMessage?.createdAt || conv.createdAt,
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
      where: { conversationId, deletedAt: null },
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
      messages: data.reverse(),
      nextCursor: hasMore ? data[0]?.id : null,
    };
  }

  async sendMessage(conversationId: string, senderId: string, content: string, mediaUrl?: string) {
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: senderId } },
    });
    if (!member) throw new Error('Not a member of this conversation');

    const message = await prisma.message.create({
      data: { conversationId, senderId, content, mediaUrl },
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
