import { prisma } from '../config/prisma';
import { publish } from '../config/bus';
import { invalidateUnreadCount } from './notification.service';

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
    if (blocked) {
      const e: any = new Error('Cannot message this user');
      e.status = 403;
      e.code = 'BLOCKED';
      throw e;
    }

    // PRODUCT RULE: chat is gated on an ACTIVE match — no messaging strangers.
    // (Unmatch keeps history readable via getMessages, but no NEW threads.)
    const [mA, mB] = [userId, otherUserId].sort();
    const match = await prisma.match.findUnique({
      where: { userA_userB: { userA: mA, userB: mB } },
      select: { status: true },
    });
    if (!match || match.status !== 'ACTIVE') {
      const e: any = new Error('Match required to message');
      e.status = 403;
      throw e;
    }

    // Existing chat between exactly THIS PAIR — both members, no one else.
    // (The old lookup scanned the other user's whole conversation history and
    // could "find" a chat they have with a third person.)
    const existingMember = await prisma.conversationMember.findFirst({
      where: {
        userId,
        conversation: {
          AND: [
            { members: { some: { userId } } },
            { members: { some: { userId: otherUserId } } },
            { members: { every: { userId: { in: [userId, otherUserId] } } } },
          ],
        },
      },
      include: { conversation: true },
    });
    if (existingMember) return existingMember.conversation;

    // Create inside a transaction with a PAIR-SAFE guard: two simultaneous
    // taps must converge on ONE conversation, not two parallel threads.
    //
    // RACE-SAFE BY CONSTRUCTION: the conversation id is DETERMINED by the
    // (sorted) user pair. Five simultaneous taps all try to create the SAME
    // row — the primary key unique index lets exactly one win, and every
    // loser catches P2002 and reads the winner. No lock tables, no windows.
    const [userA, userB] = [userId, otherUserId].sort();
    const pairConversationId = `pair_${userA}_${userB}`;
    try {
      return await prisma.conversation.create({
        data: {
          id: pairConversationId,
          members: {
            create: [{ userId }, { userId: otherUserId }],
          },
        },
      });
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
    }
    // Someone else created it a millisecond earlier — return theirs.
    const existing = await prisma.conversation.findUnique({
      where: { id: pairConversationId },
      include: { members: true },
    });
    if (existing) return existing;
    throw new Error('Could not open conversation');
  }

  async getConversations(userId: string, viewerCollegeId?: string | null) {
    // College scope (legacy-data guard) + BLOCK WALL, same semantics as the
    // matches list: a blocked partner's thread disappears from the list
    // (either direction — you blocked them, or they blocked you and you must
    // not keep seeing the thread). Creation and sending already refuse
    // blocked pairs; without this filter the list was the last surface that
    // still showed the door. Unblock restores the thread; history is kept.
    const memberships = await prisma.conversationMember.findMany({
      where: {
        userId,
        conversation: {
          AND: [
            // BLOCK WALL: hide threads with a blocked member (either direction),
            // same semantics as the matches list. Creation and sending already
            // refuse blocked pairs; without this the list was the last surface
            // still showing the door. Unblock restores the thread; history kept.
            {
              members: {
                none: {
                  user: {
                    OR: [
                      { blockedUsers: { some: { blockedId: userId } } },
                      { blockedBy: { some: { blockerId: userId } } },
                    ],
                  },
                },
              },
            },
            // PRODUCT RULE: hide any thread that has ANY member outside your
            // college (only possible from legacy data — creation is already
            // college-locked).
            ...(viewerCollegeId
              ? [{ members: { none: { user: { collegeId: { not: viewerCollegeId } } } } }]
              : []),
          ],
        },
      },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } },
              },
            },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { conversation: { messages: { _count: 'desc' } } },
      // Launch bound: one row per match max, but cap the list anyway — an
      // unbounded include-heavy query is a memory spike waiting for a
      // power user (100 most-recent threads is generous for a campus app).
      take: 100,
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
        // The partner deleted their account: keep the shell (history semantics
        // match unmatch) but label it honestly instead of rendering a ghost.
        otherUser: otherMember?.user || {
          id: 'deleted',
          username: 'deleted',
          displayName: 'Deleted User',
          avatarUrl: null,
          avatarPhotoId: null,
        },
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

    // Reading the thread IS the read receipt for its DM notifications — the
    // badge used to grow forever because nothing ever cleared NEW_MESSAGE.
    const otherMemberIds = (
      await prisma.conversationMember.findMany({
        where: { conversationId, userId: { not: userId } },
        select: { userId: true },
      })
    ).map((m) => m.userId);
    if (otherMemberIds.length) {
      const cleared = await prisma.notification.updateMany({
        where: { recipientId: userId, actorId: { in: otherMemberIds }, type: 'NEW_MESSAGE', isRead: false },
        data: { isRead: true },
      });
      if (cleared.count > 0) invalidateUnreadCount(userId);
    }

    const take = Math.min(Math.max(limit || 50, 1), 100);

    const messages = await prisma.message.findMany({
      // Deleted messages stay in the thread as tombstones (WhatsApp-style)
      where: { conversationId },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } },
      },
    });

    const hasMore = messages.length > take;
    const data = hasMore ? messages.slice(0, take) : messages;

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
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } },
      },
    }).then((updated) => {
      publish('message:new', { conversationId, message: updated, recipientIds: [] });
      return updated;
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
    publish('message:updated', { conversationId, messageId });
    return { deleted: true };
  }

  async sendMessage(conversationId: string, senderId: string, content: string, mediaUrl?: string) {
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: senderId } },
    });
    if (!member) throw new Error('Not a member of this conversation');

    // Match must STILL be active: unmatch ends the conversation's life too.
    // Without this re-check, an ex could keep DMing (and re-notifying) from
    // the pre-existing thread after unmatching — history stays readable in
    // getMessages, but sending is dead the moment the match ends.
    const [sender, otherMembersBefore] = await Promise.all([
      prisma.user.findUnique({ where: { id: senderId }, select: { collegeId: true } }),
      prisma.conversationMember.findMany({ where: { conversationId, userId: { not: senderId } }, select: { userId: true } }),
    ]);
    if (otherMembersBefore.length > 0) {
      const [mA, mB] = [senderId, otherMembersBefore[0].userId].sort();
      const activeMatch = await prisma.match.findUnique({
        where: { userA_userB: { userA: mA, userB: mB } },
        select: { status: true },
      });
      if (!activeMatch || activeMatch.status !== 'ACTIVE') {
        const e: any = new Error('Match required to message');
        e.status = 403;
        e.code = 'MATCH_REQUIRED';
        throw e;
      }
    }

    const trimmed = String(content || '').trim();
    if (!trimmed) throw new Error('Message cannot be empty');
    if (trimmed.length > 2000) throw new Error('Message must be under 2000 characters');
    // Unvalidated mediaUrl is a stored-XSS/phish vector — allowlist https only.
    let safeMediaUrl: string | undefined;
    if (mediaUrl !== undefined && mediaUrl !== null && String(mediaUrl).trim() !== '') {
      const u = String(mediaUrl).trim();
      if (!/^https:\/\//i.test(u) || u.length > 2048) throw new Error('Invalid media URL');
      safeMediaUrl = u;
    }

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
      if (blocked) {
        const e: any = new Error('Cannot message this user');
        e.status = 403;
        e.code = 'BLOCKED';
        throw e;
      }
    }

    const message = await prisma.message.create({
      data: { conversationId, senderId, content: trimmed, mediaUrl: safeMediaUrl },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } },
      },
    });

    // Opening the thread clears NEW_MESSAGE notifications: the list + the
    // unread badge previously NEVER cleared them (markAllRead is manual and
    // updateMany paths skip NEW_MESSAGE), so the bell badge grew forever no
    // matter how many chats you'd actually read. Read state lives off the
    // message row itself — nobody can infer when you read their DMs.
    await prisma.notification.updateMany({
      where: { recipientId: senderId, actorId: { in: otherIds }, type: 'NEW_MESSAGE' },
      data: { isRead: true },
    });
    if (otherIds.length) invalidateUnreadCount(senderId);

    // Notify other members
    const otherMembers = await prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: senderId } },
    });

    await prisma.notification.createMany({
      data: otherMembers.map((m) => ({
        recipientId: m.userId,
        actorId: senderId,
        type: 'NEW_MESSAGE' as const,
        // Deep link target: without it the "X sent you a message" row was a
        // DEAD END — the notifications page had nothing to navigate to and
        // tapping it did nothing. The conversation id is the whole payload;
        // we deliberately do NOT snapshot the message body here, or "delete
        // for everyone" would keep serving the text from notification metadata.
        metadata: { conversationId } as any,
      })),
    });
    invalidateUnreadCount(...otherMembers.map((m) => m.userId));

    // Realtime push: both the conversation room and the recipients' personal
    // rooms (covers unread badges / lists even when the thread isn't open).
    publish('message:new', { conversationId, message, recipientIds: otherMembers.map((m) => m.userId) });

    return message;
  }
}
