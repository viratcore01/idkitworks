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

export class PostService {
  async create(authorId: string, input: CreatePostInput) {
    return prisma.post.create({
      data: {
        authorId,
        content: input.content,
        mediaUrl: input.mediaUrl,
        mediaType: (input.mediaType as any) || 'NONE',
        type: (input.type as any) || 'NORMAL',
        visibility: (input.visibility as any) || 'PUBLIC',
        isAnonymous: input.isAnonymous || false,
      },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: true, likes: true } },
      },
    });
  }

  async getFeed(userId: string, query: FeedQuery) {
    const limit = Math.min(query.limit || 20, 50);
    const cursor = query.cursor;

    const where: Prisma.PostWhereInput = {
      deletedAt: null,
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
        _count: { select: { comments: true, likes: true } },
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
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, college: true, course: true, year: true },
        },
        _count: { select: { comments: true, likes: true } },
        likes: { where: { userId }, select: { userId: true } },
      },
    });

    if (!post || post.deletedAt) return null;

    return {
      ...post,
      isLikedByMe: post.likes.length > 0,
      likes: undefined,
    };
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

  async toggleLike(postId: string, userId: string) {
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

  async getComments(postId: string, userId: string, limit = 20, cursor?: string) {
    const comments = await prisma.comment.findMany({
      where: { postId, deletedAt: null, parentCommentId: null },
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
      comments: data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async createComment(postId: string, authorId: string, content: string, isAnonymous = false, parentCommentId?: string) {
    const comment = await prisma.comment.create({
      data: {
        postId,
        authorId,
        content,
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

  async deleteComment(commentId: string, userId: string, isAdmin = false) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new Error('Comment not found');
    if (!isAdmin && comment.authorId !== userId) throw new Error('Not authorized');
    return prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  }
}
