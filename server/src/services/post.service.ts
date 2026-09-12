import { prisma } from '../config/prisma';
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
          select: { id: true, username: true, displayName: true, avatarUrl: true, college: true, course: true, year: true },
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
          select: { id: true, username: true, displayName: true, avatarUrl: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
        likes: { where: { userId }, select: { userId: true } },
        comments: {
          where: { deletedAt: null, parentCommentId: null },
          take: 3,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            isAnonymous: true,
            createdAt: true,
            author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          },
        },
      },
    });

    const hasMore = posts.length > limit;
    const data = hasMore ? posts.slice(0, limit) : posts;

    return {
      posts: data.map((post) => ({
        ...post,
        isLikedByMe: post.likes.length > 0,
        likes: undefined,
        topComments: post.comments,
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
      isLikedByMe: post.likes.length > 0,
      likes: undefined,
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
  }

  async update(postId: string, authorId: string, data: { content?: string }) {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.authorId !== authorId) throw new Error('Not authorized');
    return prisma.post.update({ where: { id: postId }, data });
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
      return { liked: false };
    } else {
      await prisma.postLike.create({ data: { userId, postId } });
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
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        _count: { select: { replies: true } },
      },
    });

    const hasMore = comments.length > limit;
    const data = hasMore ? comments.slice(0, limit) : comments;

    return {
      comments: data.map((c) => ({
        ...c,
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
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    // Notify post author
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (post && post.authorId !== authorId) {
      await prisma.notification.create({
        data: {
          recipientId: post.authorId,
          actorId: authorId,
          type: parentCommentId ? 'COMMENT_REPLY' : 'COMMENT',
          postId,
          commentId: comment.id,
        },
      });
    }

    return comment;
  }

  /** Edit own comment. Social apps (Reddit/Instagram style) allow this anytime; shows an "Edited" tag. */
  async editComment(commentId: string, userId: string, content: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw new Error('Comment not found');
    if (comment.authorId !== userId) throw new Error('You can only edit your own comments');
    if (!content.trim()) throw new Error('Comment cannot be empty');

    return prisma.comment.update({
      where: { id: commentId },
      data: { content, editedAt: new Date() },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async deleteComment(commentId: string, userId: string, isAdmin = false) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new Error('Comment not found');
    if (!isAdmin && comment.authorId !== userId) throw new Error('Not authorized');
    return prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  }
}
