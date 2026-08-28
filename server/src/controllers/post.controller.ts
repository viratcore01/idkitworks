import { Response } from 'express';
import { PostService } from '../services/post.service';
import { AuthRequest } from '../types';

const postService = new PostService();

export class PostController {
  async create(req: AuthRequest, res: Response) {
    try {
      const post = await postService.create(req.user!.id, req.body);
      res.status(201).json(post);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getFeed(req: AuthRequest, res: Response) {
    try {
      const { limit, cursor, type } = req.query;
      const result = await postService.getFeed(req.user!.id, {
        limit: limit ? parseInt(limit as string) : undefined,
        cursor: cursor as string,
        type: type as string,
      });
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getById(req: AuthRequest, res: Response) {
    try {
      const post = await postService.getById(req.params.id as string, req.user!.id);
      if (!post) return res.status(404).json({ error: 'Post not found' });
      res.json(post);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async update(req: AuthRequest, res: Response) {
    try {
      const post = await postService.update(req.params.id as string, req.user!.id, req.body);
      res.json(post);
    } catch (error: any) {
      res.status(error.message.includes('Not authorized') ? 403 : 400).json({ error: error.message });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    try {
      await postService.delete(req.params.id as string, req.user!.id);
      res.json({ message: 'Post deleted' });
    } catch (error: any) {
      res.status(error.message.includes('Not authorized') ? 403 : 400).json({ error: error.message });
    }
  }

  async toggleLike(req: AuthRequest, res: Response) {
    try {
      const result = await postService.toggleLike(req.params.postId as string, req.user!.id);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getComments(req: AuthRequest, res: Response) {
    try {
      const { limit, cursor } = req.query;
      const result = await postService.getComments(
        req.params.postId as string,
        req.user!.id,
        limit ? parseInt(limit as string) : undefined,
        cursor as string,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async createComment(req: AuthRequest, res: Response) {
    try {
      const { content, isAnonymous, parentCommentId } = req.body;
      const comment = await postService.createComment(
        (req.params.postId as string) || req.body.postId,
        req.user!.id,
        content,
        isAnonymous,
        parentCommentId,
      );
      res.status(201).json(comment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async deleteComment(req: AuthRequest, res: Response) {
    try {
      await postService.deleteComment(req.params.id as string, req.user!.id);
      res.json({ message: 'Comment deleted' });
    } catch (error: any) {
      res.status(error.message.includes('Not authorized') ? 403 : 400).json({ error: error.message });
    }
  }
}
