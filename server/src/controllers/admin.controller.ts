import { Response } from 'express';
import { ReportService } from '../services/report.service';
import { PostService } from '../services/post.service';
import { AuthRequest } from '../types';
import { prisma } from '../config/prisma';

const reportService = new ReportService();
const postService = new PostService();

export class AdminController {
  // Reports
  async createReport(req: AuthRequest, res: Response) {
    try {
      const report = await reportService.createReport(req.user!.id, req.body);
      res.status(201).json(report);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getReports(req: AuthRequest, res: Response) {
    try {
      const { status } = req.query;
      const reports = await reportService.getReports(status as string);
      res.json(reports);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async resolveReport(req: AuthRequest, res: Response) {
    try {
      const result = await reportService.resolveReport(req.params.id as string, req.user!.id, req.body.action);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  // Admin actions
  async deleteContent(req: AuthRequest, res: Response) {
    try {
      const type = req.params.type as string;
      const id = req.params.id as string;
      if (type === 'post') {
        await postService.delete(id, req.user!.id, true);
      } else if (type === 'comment') {
        await postService.deleteComment(id, req.user!.id, true);
      }
      res.json({ message: 'Content deleted' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async banUser(req: AuthRequest, res: Response) {
    try {
      await prisma.user.update({
        where: { id: req.params.id as string },
        data: { isActive: false },
      });
      res.json({ message: 'User banned' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getStats(_req: AuthRequest, res: Response) {
    try {
      const [userCount, postCount, reportCount, matchCount] = await Promise.all([
        prisma.user.count(),
        prisma.post.count({ where: { deletedAt: null } }),
        prisma.report.count({ where: { status: 'PENDING' } }),
        prisma.match.count(),
      ]);
      res.json({ users: userCount, posts: postCount, pendingReports: reportCount, matches: matchCount });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
