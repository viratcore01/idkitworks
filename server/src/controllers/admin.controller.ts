import { Response } from 'express';
import { ReportService } from '../services/report.service';
import { PostService } from '../services/post.service';
import { AuthRequest } from '../types';
import { prisma } from '../config/prisma';
import { sendError } from '../utils/http-error';

const reportService = new ReportService();
const postService = new PostService();

/**
 * PRODUCT RULE: college-scoped moderation.
 * role 'admin'        → only their college's content/reports/users
 * role 'super_admin'  → everything
 */
export class AdminController {
  // Reports
  async createReport(req: AuthRequest, res: Response) {
    try {
      const report = await reportService.createReport(req.user!.id, req.body);
      res.status(201).json(report);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async getReports(req: AuthRequest, res: Response) {
    try {
      const { status } = req.query;
      const reports = await reportService.getReports(status as string, {
        collegeId: req.user!.collegeId,
        role: req.user!.role,
      });
      res.json(reports);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async resolveReport(req: AuthRequest, res: Response) {
    try {
      const result = await reportService.resolveReport(req.params.id as string, {
        id: req.user!.id,
        collegeId: req.user!.collegeId,
        role: req.user!.role,
      }, req.body.action);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  // Admin actions
  async deleteContent(req: AuthRequest, res: Response) {
    try {
      const type = req.params.type as string;
      const id = req.params.id as string;
      const isSuper = req.user!.role === 'super_admin';

      if (type === 'post') {
        if (!isSuper && !(await this.postInScope(id, req.user!.collegeId))) {
          return res.status(403).json({ error: 'Not authorized' });
        }
        await postService.delete(id, req.user!.id, true);
      } else if (type === 'comment') {
        if (!isSuper && !(await this.commentInScope(id, req.user!.collegeId))) {
          return res.status(403).json({ error: 'Not authorized' });
        }
        await postService.deleteComment(id, req.user!.id, true);
      }
      res.json({ message: 'Content deleted' });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  private async postInScope(postId: string, collegeId: string | null): Promise<boolean> {
    if (!collegeId) return false;
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { author: { select: { collegeId: true } } },
    });
    return post?.author.collegeId === collegeId;
  }

  private async commentInScope(commentId: string, collegeId: string | null): Promise<boolean> {
    if (!collegeId) return false;
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { author: { select: { collegeId: true } } },
    });
    return comment?.author.collegeId === collegeId;
  }

  async banUser(req: AuthRequest, res: Response) {
    try {
      const isSuper = req.user!.role === 'super_admin';
      if (!isSuper) {
        if (!req.user!.collegeId) return res.status(403).json({ error: 'Not authorized' });
        const target = await prisma.user.findUnique({
          where: { id: req.params.id as string },
          select: { collegeId: true },
        });
        if (!target || target.collegeId !== req.user!.collegeId) {
          return res.status(403).json({ error: 'Not authorized' });
        }
      }
      await prisma.user.update({
        where: { id: req.params.id as string },
        data: { isActive: false },
      });
      res.json({ message: 'User banned' });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  /** Reverse of ban — same college-scoping rules. Wrong bans must be reversible. */
  async unbanUser(req: AuthRequest, res: Response) {
    try {
      const isSuper = req.user!.role === 'super_admin';
      if (!isSuper) {
        if (!req.user!.collegeId) return res.status(403).json({ error: 'Not authorized' });
        const target = await prisma.user.findUnique({
          where: { id: req.params.id as string },
          select: { collegeId: true },
        });
        if (!target || target.collegeId !== req.user!.collegeId) {
          return res.status(403).json({ error: 'Not authorized' });
        }
      }
      await prisma.user.update({
        where: { id: req.params.id as string },
        data: { isActive: true },
      });
      res.json({ message: 'User unbanned' });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async getStats(req: AuthRequest, res: Response) {
    try {
      const isSuper = req.user!.role === 'super_admin';
      const collegeId = req.user!.collegeId;
      const scope = isSuper || !collegeId ? {} : { collegeId };

      const [userCount, postCount, reportCount, matchCount] = await Promise.all([
        prisma.user.count({ where: scope }),
        prisma.post.count({ where: { deletedAt: null, ...(isSuper || !collegeId ? {} : { author: { collegeId } }) } }),
        prisma.report.count({ where: { status: 'PENDING', ...(isSuper || !collegeId ? {} : { reporter: { collegeId } }) } }),
        prisma.match.count(isSuper
          ? {}
          : collegeId
            ? { userAObj: { collegeId } as any, userBObj: { collegeId } as any }
            : { id: '__none__' } as any),
      ]);
      res.json({ users: userCount, posts: postCount, pendingReports: reportCount, matches: matchCount });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }
}
