import { prisma } from '../config/prisma';

/** What the viewer's relationship to this profile is — powers the action buttons. */
export interface RelationshipContext {
  isOwn: boolean;
  isMatched: boolean;
  matchId: string | null;
  hasConversation: boolean;
  conversationId: string | null;
  iLikedThem: boolean;
  theyLikedMe: boolean;
  iBlockedThem: boolean;
  theyBlockedMe: boolean;
  canMessage: boolean;
  canLike: boolean;
}

export class UserService {
  /** Profile fields visible to anyone. */
  private publicUserSelect = {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    avatarColor: true,
    bio: true,
    college: true,
    course: true,
    year: true,
    gender: true,
    dateOfBirth: true,
    isVerified: true,
    createdAt: true,
    interests: { include: { interest: true } },
  } as const;

  private ageOf(dob: Date | null): number | null {
    if (!dob) return null;
    return Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
  }

  /**
   * Public profile + relationship context + stats.
   * Blocked profiles (either direction) return { blocked: true } — same as before.
   */
  async getPublicProfile(username: string, viewerId: string, viewerCollegeId?: string | null) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        college: true,
        interests: { include: { interest: true } },
        _count: {
          select: {
            posts: { where: { deletedAt: null } },
            postLikes: true,
            matchesA: { where: { status: 'ACTIVE' } },
            matchesB: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (!user || !user.isActive) return null;

    // PRODUCT RULE: college-only. Other colleges' students are simply invisible —
    // same response as a nonexistent user, so nothing about them is even confirmable.
    if (viewerCollegeId && user.collegeId !== viewerCollegeId) return null;

    const [iBlock, theyBlock] = await Promise.all([
      prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: viewerId, blockedId: user.id } } }),
      prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: viewerId } } }),
    ]);

    if (iBlock || theyBlock) return { blocked: true };

    const isOwn = viewerId === user.id;

    const [match, conversation, myLike, theirLike] = await Promise.all([
      prisma.match.findFirst({
        where: {
          status: 'ACTIVE',
          OR: [
            { userA: viewerId, userB: user.id },
            { userA: user.id, userB: viewerId },
          ],
        },
      }),
      prisma.conversationMember.findFirst({
        where: {
          userId: viewerId,
          conversation: { members: { some: { userId: user.id } } },
        },
        select: { conversationId: true },
      }),
      prisma.matchLike.findUnique({
        where: { senderId_receiverId: { senderId: viewerId, receiverId: user.id } },
      }),
      prisma.matchLike.findUnique({
        where: { senderId_receiverId: { senderId: user.id, receiverId: viewerId } },
      }),
    ]);

    const isMatched = !!match;

    const relationship: RelationshipContext = {
      isOwn,
      isMatched,
      matchId: match?.id || null,
      hasConversation: !!conversation,
      conversationId: conversation?.conversationId || null,
      iLikedThem: myLike?.action === 'LIKE',
      theyLikedMe: theirLike?.action === 'LIKE',
      iBlockedThem: false,
      theyBlockedMe: false,
      // Real apps (Bumble/Tinder/Hinge) open chat only for matches; messaging
      // unmatched people is exactly what dating apps exist to prevent.
      canMessage: isMatched,
      // Already-liked (including from a since-unmatched pair) can't be re-liked —
      // the like is consumed until the resurface window resets it.
      canLike: !isMatched && !isOwn && myLike?.action !== 'LIKE',
    };

    const postCount = user._count.posts;
    const matchCount = user._count.matchesA + user._count.matchesB;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
      bio: user.bio,
      college: user.college,
      course: user.course,
      year: user.year,
      // Age is public on dating profiles; exact DOB never leaves the server.
      age: this.ageOf(user.dateOfBirth),
      gender: user.gender,
      isVerified: user.isVerified,
      joinedAt: user.createdAt,
      interests: user.interests.map((ui) => ui.interest),
      stats: {
        posts: postCount,
        likesReceived: user._count.postLikes,
        matches: isOwn ? matchCount : undefined, // matches are private to the owner
      },
      relationship,
    };
  }

  async getUserPosts(username: string, viewerId: string, limit = 20, cursor?: string, viewerCollegeId?: string | null) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('User not found');

    // PRODUCT RULE: college-only grids
    if (viewerCollegeId && user.collegeId !== viewerCollegeId) {
      return { posts: [], nextCursor: null };
    }

    // Respect blocks on the posts feed too
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: user.id },
          { blockerId: user.id, blockedId: viewerId },
        ],
      },
    });
    if (block) return { posts: [], nextCursor: null };

    const posts = await prisma.post.findMany({
      // Anonymous posts stay anonymous: on someone's profile we show them in the
      // count, but their content belongs to the anonymous feed, not the identity.
      where: { authorId: user.id, deletedAt: null, isAnonymous: false },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
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
