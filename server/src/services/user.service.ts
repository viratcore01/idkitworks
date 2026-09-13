import { prisma } from '../config/prisma';

/**
 * The masked persona for anonymous posts (same shape post.service uses).
 * Anonymous content never carries the real author over the wire — not even
 * to the author themselves on their own profile.
 */
const ANON_AUTHOR = {
  id: 'anonymous',
  username: 'anonymous',
  displayName: 'Anonymous Student',
  avatarUrl: null as string | null,
  avatarPhotoId: null as string | null,
};

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
    verificationStatus: true,
    createdAt: true,
    photos: { select: { id: true, slot: true }, orderBy: { slot: 'asc' } },
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
        photos: { select: { id: true, slot: true }, orderBy: { slot: 'asc' } },
        _count: {
          select: {
            // PRIVACY: the Posts stat counts only attributed posts. Anonymous
            // posts are counted separately (and returned ONLY to the owner) —
            // a public "9 posts, 3 of them hidden confessions" badge would let
            // anyone correlate new confessions with a person's profile.
            posts: { where: { deletedAt: null, isAnonymous: false } },
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

    // The anonymous count is the owner's private data — strangers get nothing,
    // not even the number. Queried only when the viewer owns the profile.
    let anonymousCount: number | undefined;
    if (isOwn) {
      anonymousCount = await prisma.post.count({
        where: { authorId: user.id, deletedAt: null, isAnonymous: true },
      });
    }

    const stats: {
      posts: number;
      likesReceived: number;
      matches?: number;
      anonymousPosts?: number;
    } = {
      posts: postCount,
      likesReceived: user._count.postLikes,
    };
    if (isOwn) {
      stats.matches = matchCount;
      stats.anonymousPosts = anonymousCount;
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
      photos: user.photos.map((p) => ({ id: p.id, slot: p.slot })),
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
      stats,
      relationship,
    };
  }

  /**
   * Posts on a profile grid.
   *
   * PRIVACY MODEL: anonymous posts appear here ONLY when the viewer is the
   * profile owner (anonymousOnly=true) — the server checks ownership itself,
   * so a forged request from anyone else gets an empty list. Even the author
   * receives their own anonymous posts behind the masked ANON persona, so the
   * real authorId never travels over the wire from this endpoint.
   */
  async getUserPosts(
    username: string,
    viewerId: string,
    limit = 20,
    cursor?: string,
    viewerCollegeId?: string | null,
    anonymousOnly = false,
  ) {
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

    // The request is only honored when the viewer IS the profile owner.
    if (anonymousOnly && user.id !== viewerId) {
      return { posts: [], nextCursor: null };
    }

    const posts = await prisma.post.findMany({
      // Anonymous posts stay anonymous: on someone else's profile grid they
      // never appear, and their content belongs to the anonymous feed, not
      // the identity. Only the owner (anonymousOnly) can list them.
      where: {
        authorId: user.id,
        deletedAt: null,
        isAnonymous: anonymousOnly,
      },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
        likes: { where: { userId: viewerId }, select: { userId: true } },
        saves: { where: { userId: viewerId }, select: { userId: true } },
      },
    });

    const hasMore = posts.length > limit;
    const data = hasMore ? posts.slice(0, limit) : posts;

    return {
      posts: data.map((p) => ({
        ...p,
        // Ownership is computed BEFORE anonymous masking — the real authorId
        // of an anonymous post never leaves the server, only this boolean does.
        isMine: p.authorId === viewerId,
        // PRIVACY: even in the owner's private list, the author is the masked
        // persona — the same shape every other list returns.
        author: p.isAnonymous
          ? { ...ANON_AUTHOR, college: null, course: null, year: null }
          : p.author,
        // PRIVACY: same authorId masking as every other post list.
        authorId: p.isAnonymous ? ANON_AUTHOR.id : p.authorId,
        isLikedByMe: p.likes.length > 0,
        isSavedByMe: p.saves.length > 0,
        likes: undefined,
        saves: undefined,
      })),
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
        blocked: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } },
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
