import { Response } from 'express';
import { ReportService } from '../services/report.service';
import { PostService } from '../services/post.service';
import { AdminService } from '../services/admin.service';
import { AuthRequest } from '../types';
import { prisma } from '../config/prisma';
import { sendError } from '../utils/http-error';
import { invalidateUser } from '../utils/user-cache';
import { moderationScope } from '../middleware/auth';

const reportService = new ReportService();
const postService = new PostService();
const adminService = new AdminService();

/**
 * PRODUCT RULE: college-scoped moderation.
 * role 'admin'        → only their college's content/reports/users
 * role 'super_admin'  → everything
 */
export class AdminController {
  // Reports
  async createReport(req: AuthRequest, res: Response) {
    try {
      const { report, deduped } = await reportService.createReport(req.user!.id, req.body);
      res.status(deduped ? 200 : 201).json(deduped ? { ...report, deduped: true } : report);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async getReports(req: AuthRequest, res: Response) {
    try {
      const { status, collegeId, limit } = req.query;
      const reports = await reportService.getReports(status as string, {
        collegeId: moderationScope(req.user),
        role: req.user!.role,
      }, collegeId as string, limit ? parseInt(limit as string) : undefined);
      res.json(reports);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async resolveReport(req: AuthRequest, res: Response) {
    try {
      const result = await adminService.resolveReport(
        req.user!.id, req.user!.role, req.params.id as string, String(req.body?.action || 'dismiss'),
      );
      res.json(result);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: per-college health overview (?collegeId= for super-admins). */
  async overview(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.overview(req.user!.id, req.user!.role, req.query.collegeId as string));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: searchable user directory. */
  async listUsers(req: AuthRequest, res: Response) {
    try {
      const { q, collegeId, filter, page, limit } = req.query;
      res.json(await adminService.listUsers(req.user!.id, req.user!.role, {
        q: q as string,
        collegeId: collegeId as string,
        filter: filter as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      }));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Super-admin only: promote/demote moderators. */
  async setRole(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.setRole(
        req.user!.id, req.user!.role, req.params.id as string,
        String(req.body?.role || ''), req.body?.collegeId as string,
      ));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: proactive content browser (?type=post|comment). */
  async browseContent(req: AuthRequest, res: Response) {
    try {
      const { type, q, collegeId, page, limit } = req.query;
      res.json(await adminService.browseContent(req.user!.id, req.user!.role, {
        type: type as string,
        q: q as string,
        collegeId: collegeId as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      }));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: audit trail of staff actions. */
  async activity(req: AuthRequest, res: Response) {
    try {
      const { collegeId, actorId, page, limit } = req.query;
      res.json(await adminService.activity(req.user!.id, req.user!.role, {
        collegeId: collegeId as string,
        actorId: actorId as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      }));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: per-day trend lines (?days=14). */
  async trends(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.trends(
        req.user!.id, req.user!.role,
        req.query.days ? parseInt(req.query.days as string) : undefined,
        req.query.collegeId as string,
      ));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: bulk report resolution. */
  async bulkResolve(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.bulkResolve(req.user!.id, req.user!.role, req.body?.ids, String(req.body?.action || 'dismiss')));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: campus announcement broadcast. */
  async announce(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.announce(req.user!.id, req.user!.role, {
        collegeId: req.body?.collegeId,
        title: req.body?.title,
        body: req.body?.body,
      }));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: full inspect view for one user. */
  async userDetail(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.userDetail(req.user!.id, req.user!.role, req.params.id as string));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Admin/moderator update of locked profile fields. */
  async updateUser(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.updateUser(
        req.user!.id, req.user!.role, req.params.id as string,
        req.body,
      ));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Moderator console: college directory with live stats. */
  async listColleges(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.listColleges(
        req.user!.id, req.user!.role, String(req.query.q || ''),
        req.query.limit ? parseInt(req.query.limit as string) : undefined,
      ));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Supreme only: duplicate-campus detector. */
  async duplicateColleges(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.duplicateColleges(req.user!.role));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Supreme only: fold one campus into another. */
  async mergeColleges(req: AuthRequest, res: Response) {
    try {
      res.json(await adminService.mergeColleges(
        req.user!.id, req.user!.role, String(req.body?.fromId || ''), String(req.body?.toId || ''),
      ));
    } catch (error: any) {
      sendError(res, error, error.status || 400);
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
      await adminService.log(req.user!.id, 'takedown', type.toUpperCase(), id, req.user!.collegeId);
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
      const result = await adminService.banUser(req.user!.id, req.user!.role, req.params.id as string, String(req.body?.reason || ''));
      res.json({ message: 'User banned', ...result });
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Reverse of ban — same college-scoping rules. Wrong bans must be reversible. */
  async unbanUser(req: AuthRequest, res: Response) {
    try {
      const result = await adminService.unbanUser(req.user!.id, req.user!.role, req.params.id as string);
      res.json({ message: 'User unbanned', ...result });
    } catch (error: any) {
      sendError(res, error, error.status || 400);
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
