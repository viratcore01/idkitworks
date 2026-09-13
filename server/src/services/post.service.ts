import { prisma } from '../config/prisma';
import { publish } from '../config/bus';
import { Prisma } from '@prisma/client';

interface CreatePostInput {
  content: string;
  mediaUrl?: string;
  mediaType?: 'IMAGE' | 'VIDEO' | 'NONE';
  type?: 'NORMAL' | 'CONFESSION' | 'POLL' | 'QUESTION';
  visibility?: 'PUBLIC' | 'COLLEGE_ONLY';
  isAnonymous?: boolean;
}

interface FeedQuery {
  limit?: number;
  cursor?: string;
  type?: string;
}

const COMMENT_MAX = 2000;
const POST_MAX = 5000;

/**
 * The public face of anonymity. Anonymous content must NEVER carry the real
 * author across the wire — not even to the client that masks it in the UI,
 * because anyone with curl could read the JSON and de-anonymize every
 * confession on campus. Same persona the search service already uses.
 */
const ANON_AUTHOR = {
  id: 'anonymous',
  username: 'anonymous',
  displayName: 'Anonymous Student',
  avatarUrl: null as string | null,
  avatarPhotoId: null as string | null,
};

function anonymizeComment<T extends { isAnonymous: boolean; author: unknown }>(c: T): T {
  return c.isAnonymous
    ? ({ ...c, author: { ...ANON_AUTHOR }, authorId: ANON_AUTHOR.id } as T)
    : c;
}

export class PostService {
  async create(authorId: string, input: CreatePostInput) {
    const content = String(input.content || '').trim();
    if (!content) throw new Error('Post cannot be empty');
    if (content.length > POST_MAX) throw new Error(`Post must be under ${POST_MAX} characters`);
    const mediaUrl = input.mediaUrl ? String(input.mediaUrl) : undefined;
    if (mediaUrl && !/^https:\/\//.test(mediaUrl)) throw new Error('Media URL must be https');

    // PRODUCT RULE: college-only. The author's college IS the post's college —
    // an author can never choose to publish outside (or without) their college.
    const author = await prisma.user.findUnique({ where: { id: authorId }, select: { collegeId: true } });
    if (!author?.collegeId) {
      const e: any = new Error('Join your college before posting'); e.status = 403; throw e;
    }

    return prisma.post.create({
      data: {
        authorId,
        content,
        mediaUrl,
        mediaType: (input.mediaType as any) || 'NONE',
        type: (input.type as any) || 'NORMAL',
        visibility: (input.visibility as any) || 'PUBLIC',
        isAnonymous: input.isAnonymous || false,
      },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
      },
    });
  }

  async getFeed(userId: string, query: FeedQuery) {
    const limit = Math.min(query.limit || 20, 50);
    const cursor = query.cursor;

    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!viewer?.collegeId) {
      // College-only product: no college → no feed.
      return { posts: [], nextCursor: null };
    }

    // Blocks remove people from your feed entirely — both directions.
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = Array.from(
      new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== userId)),
    );

    const where: Prisma.PostWhereInput = {
      deletedAt: null,
      // PRODUCT RULE: hyperlocal — only your college's posts, ever.
      author: { collegeId: viewer.collegeId, isActive: true },
      ...(blockedIds.length && { authorId: { notIn: blockedIds } }),
      ...(query.type && { type: query.type as any }),
    };

    const posts = await prisma.post.findMany({
      where,
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
        likes: { where: { userId }, select: { userId: true } },
        saves: { where: { userId }, select: { userId: true } },
        comments: {
          where: { deletedAt: null, parentCommentId: null },
          take: 3,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            isAnonymous: true,
            createdAt: true,
            author: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } },
          },
        },
      },
    });

    const hasMore = posts.length > limit;
    const data = hasMore ? posts.slice(0, limit) : posts;

    return {
      posts: data.map((post) => ({
        ...post,
        // Ownership is computed BEFORE anonymous masking — the real authorId
        // of an anonymous post never leaves the server, only this boolean does.
        isMine: post.authorId === userId,
        // PRIVACY: anonymous posts never carry the real author in any list.
        author: post.isAnonymous
          ? { ...ANON_AUTHOR, college: null, course: null, year: null }
          : post.author,
        // PRIVACY: the raw authorId is a de-anonymization oracle (it equals the
        // profile id) — mask it along with the author object.
        authorId: post.isAnonymous ? ANON_AUTHOR.id : post.authorId,
        isLikedByMe: post.likes.length > 0,
        isSavedByMe: post.saves.length > 0,
        likes: undefined,
        saves: undefined,
        // PRIVACY: anonymous comment previews never carry the real author.
        topComments: post.comments.map(anonymizeComment),
      })),
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async getById(postId: string, userId: string) {
    // Deleted posts 404 for everyone; no ghost content resurrectable by direct URL.
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, college: true, course: true, year: true, collegeId: true, isActive: true },
        },
        _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
        likes: { where: { userId }, select: { userId: true } },
        saves: { where: { userId }, select: { userId: true } },
      },
    });

    if (!post || post.deletedAt) return null;

    // PRODUCT RULE: college-only. A post from another college 404s — same as
    // a deleted one, so its existence is not even confirmable across colleges.
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!viewer?.collegeId || !post.author.collegeId || post.author.collegeId !== viewer.collegeId) {
      return null;
    }

    return {
      ...post,
      // Ownership computed BEFORE anonymous masking — see getFeed.
      isMine: post.authorId === userId,
      // PRIVACY: the real author of an anonymous post never leaves the server.
      author: post.isAnonymous
        ? { ...ANON_AUTHOR, college: null, course: null, year: null, collegeId: null, isActive: true }
        : post.author,
      // PRIVACY: same authorId masking as the feed — see getFeed.
      authorId: post.isAnonymous ? ANON_AUTHOR.id : post.authorId,
      isLikedByMe: post.likes.length > 0,
      isSavedByMe: post.saves.length > 0,
      likes: undefined,
      saves: undefined,
    };
  }

  /** Guard used by likes/comments: live post AND same college as the actor. */
  private async assertLivePost(postId: string, actorCollegeId?: string | null) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { deletedAt: true, authorId: true, author: { select: { collegeId: true, isActive: true } } },
    });
    if (!post || post.deletedAt) throw new Error('Post not found');
    if (actorCollegeId && post.author.collegeId !== actorCollegeId) throw new Error('Post not found');
    return post;
  }  /**
   * Edit own post. STRICT WHITELIST: only content is editable from the API —
   * the old version updated whatever the request body contained, so a crafted
   * PATCH could reassign authorId (frame another student), flip isAnonymous,
   * or resurrect deletedAt. Author/admin deletion paths are separate.
   */
  async update(postId: string, authorId: string, data: { content?: string }) {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.authorId !== authorId) throw new Error('Not authorized');

    const update: { content?: string } = {};
    if (data.content !== undefined) {
      const content = String(data.content || '').trim();
      if (!content) throw new Error('Post cannot be empty');
      if (content.length > POST_MAX) throw new Error(`Post must be under ${POST_MAX} characters`);
      update.content = content;
    }
    if (!Object.keys(update).length) throw new Error('Nothing to update');

    return prisma.post.update({ where: { id: postId }, data: update });
  }
  async delete(postId: string, userId: string, isAdmin = false) {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new Error('Post not found');
    if (!isAdmin && post.authorId !== userId) throw new Error('Not authorized');
    return prisma.post.update({ where: { id: postId }, data: { deletedAt: new Date() } });
  }

  async toggleLike(postId: string, userId: string, actorCollegeId?: string | null) {
    await this.assertLivePost(postId, actorCollegeId);

    const existing = await prisma.postLike.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await prisma.postLike.delete({ where: { userId_postId: { userId, postId } } });
      // Unlike withdraws the like notification too (Instagram-style): a like
      // that was spam-toggled 50 times must not leave 50 unread badges.
      await prisma.notification.deleteMany({ where: { actorId: userId, postId, type: 'LIKE' } });
      return { liked: false };
    } else {
      try {
        await prisma.postLike.create({ data: { userId, postId } });
      } catch (err: any) {
        // Double-tap race: two requests both saw "no like" — the unique pair
        // index means exactly one create wins. Treat the loser as liked, not a 500.
        if (err?.code !== 'P2002') throw err;
      }
      // Create notification
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (post && post.authorId !== userId) {
        await prisma.notification.create({
          data: {
            recipientId: post.authorId,
            actorId: userId,
            type: 'LIKE',
            postId,
          },
        });
        publish('notification:new', { userIds: [post.authorId] });
      }
      return { liked: true };
    }
  }

  /** Flat list of all live comments (top-level + replies); client nests them. */
  async getComments(postId: string, userId: string, limit = 20, cursor?: string, viewerCollegeId?: string | null) {
    await this.assertLivePost(postId, viewerCollegeId);

    const comments = await prisma.comment.findMany({
      // Deleted comments stay as tombstones when they have replies (Reddit-style);
      // childless deleted ones are filtered out entirely.
      where: {
        postId,
        OR: [{ deletedAt: null }, { replies: { some: { deletedAt: null } } }],
      },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true },
        },
        _count: { select: { replies: true } },
      },
    });

    const hasMore = comments.length > limit;
    const data = hasMore ? comments.slice(0, limit) : comments;

    return {
      comments: data.map((c) => ({
        ...anonymizeComment(c),
        // Computed BEFORE masking (real authorId still present above) — lets the
        // author manage their own anonymous comments without unmasking them.
        isMine: c.authorId === userId,
        content: c.deletedAt ? '' : c.content,
        isDeleted: !!c.deletedAt,
      })),
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async createComment(postId: string, authorId: string, content: string, isAnonymous = false, parentCommentId?: string, actorCollegeId?: string | null) {
    await this.assertLivePost(postId, actorCollegeId);

    const trimmed = String(content || '').trim();
    if (!trimmed) throw new Error('Comment cannot be empty');
    if (trimmed.length > COMMENT_MAX) throw new Error(`Comment must be under ${COMMENT_MAX} characters`);

    // Replies must point at a live comment on the SAME post
    if (parentCommentId) {
      const parent = await prisma.comment.findUnique({ where: { id: parentCommentId } });
      if (!parent || parent.deletedAt || parent.postId !== postId) {
        throw new Error('Parent comment not found');
      }
    }

    const comment = await prisma.comment.create({
      data: {
        postId,
        authorId,
        content: trimmed,
        isAnonymous,
        parentCommentId,
      },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true },
        },
      },
    });

    // Notify post author (or the parent comment's author when replying —
    // exactly one notify target, and never yourself).
    const post = await prisma.post.findUnique({ where: { id: postId } });
    let notifyUserId: string | null = null;
    if (parentCommentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentCommentId },
        select: { authorId: true },
      });
      if (parent && parent.authorId !== authorId) notifyUserId = parent.authorId;
    } else if (post && post.authorId !== authorId) {
      notifyUserId = post.authorId;
    }
    if (notifyUserId) {
      await prisma.notification.create({
        data: {
          recipientId: notifyUserId,
          // PRIVACY: an anonymous comment notifies WITHOUT an actor — the
          // recipient sees "Someone commented on your post", never the name.
          actorId: isAnonymous ? null : authorId,
          type: parentCommentId ? 'COMMENT_REPLY' : 'COMMENT',
          postId,
          commentId: comment.id,
        },
      });
      publish('notification:new', { userIds: [notifyUserId] });
    }

    // PRIVACY: an anonymous reply must not de-anonymize itself in its own response.
    return { ...anonymizeComment(comment), isMine: true };
  }

  /** Edit own comment. Social apps (Reddit/Instagram style) allow this anytime; shows an "Edited" tag. */
  async editComment(commentId: string, userId: string, content: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw new Error('Comment not found');
    if (comment.authorId !== userId) throw new Error('You can only edit your own comments');
    const trimmed = String(content || '').trim();
    if (!trimmed) throw new Error('Comment cannot be empty');
    if (trimmed.length > COMMENT_MAX) throw new Error(`Comment must be under ${COMMENT_MAX} characters`);

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { content: trimmed, editedAt: new Date() },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true },
        },
      },
    });

    // You are the author, but keep the response shape identical to reads.
    return { ...anonymizeComment(updated), isMine: true };
  }

  async deleteComment(commentId: string, userId: string, isAdmin = false) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new Error('Comment not found');
    if (!isAdmin && comment.authorId !== userId) throw new Error('Not authorized');
    return prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  }

  /**
   * Bookmark a post (Reddit/Instagram "Save"). Idempotent under double-taps
   * via the unique (userId, postId) pair — the losing create is a no-op.
   */
  async toggleSave(postId: string, userId: string, actorCollegeId?: string | null) {
    await this.assertLivePost(postId, actorCollegeId);
    const existing = await prisma.savedPost.findUnique({
      where: { userId_postId: { userId, postId } },
    });
    if (existing) {
      await prisma.savedPost.delete({ where: { userId_postId: { userId, postId } } });
      return { saved: false };
    }
    try {
      await prisma.savedPost.create({ data: { userId, postId } });
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
    }
    return { saved: true };
  }

  /** The user's bookmarks, newest first. Only live, in-college posts surface. */
  async getSaved(userId: string, query: { limit?: number; cursor?: string }) {
    const limit = Math.min(query.limit || 20, 50);
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!viewer?.collegeId) return { posts: [], nextCursor: null };

    const rows = await prisma.savedPost.findMany({
      where: { userId, post: { deletedAt: null, author: { collegeId: viewer.collegeId, isActive: true } } },
      take: limit + 1,
      // Keyset pagination on the compound unique (user rows are single-user,
      // so the postId half orders the scan; createdAt ties break naturally).
      ...(query.cursor && {
        cursor: { userId_postId: { userId, postId: query.cursor } },
        skip: 1,
      }),
      orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
      include: {
        post: {
          include: {
            author: {
              select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true, college: true, course: true, year: true },
            },
            _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
            likes: { where: { userId }, select: { userId: true } },
            saves: { where: { userId }, select: { userId: true } },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    return {
      posts: data.map((r) => ({
        ...r.post,
        author: r.post.isAnonymous ? { ...ANON_AUTHOR, college: null, course: null, year: null } : r.post.author,
        // PRIVACY: same authorId masking as the feed — see getFeed.
        authorId: r.post.isAnonymous ? ANON_AUTHOR.id : r.post.authorId,
        isLikedByMe: r.post.likes.length > 0,
        isSavedByMe: true,
        likes: undefined,
        saves: undefined,
      })),
      nextCursor: hasMore ? data[data.length - 1].postId : null,
    };
  }
}
