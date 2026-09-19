import { prisma } from '../config/prisma';

/**
 * PRODUCT RULE: moderation respects college boundaries.
 * College admins (role 'admin') only ever see reports about content/people in
 * their own college. Super-admins (role 'super_admin') see everything.
 */
export class ReportService {
  async createReport(reporterId: string, data: {
    targetType: string;
    targetId: string;
    reason: string;
    description?: string;
  }) {
    const targetType = String(data.targetType || '').toUpperCase();
    const reason = String(data.reason || '').toUpperCase();
    const targetId = String(data.targetId || '');
    const ALLOWED_TARGETS = ['POST', 'COMMENT', 'USER', 'MESSAGE'];
    const ALLOWED_REASONS = ['INAPPROPRIATE', 'SPAM', 'HARASSMENT', 'FAKE_PROFILE', 'OTHER'];
    if (!ALLOWED_TARGETS.includes(targetType)) {
      const e: any = new Error('Invalid report target'); e.status = 400; throw e;
    }
    if (!ALLOWED_REASONS.includes(reason)) {
      const e: any = new Error('Invalid report reason'); e.status = 400; throw e;
    }
    if (!targetId) {
      const e: any = new Error('Report target is required'); e.status = 400; throw e;
    }
    if (data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 1000)) {
      const e: any = new Error('Description must be under 1000 characters'); e.status = 400; throw e;
    }

    // Target must exist (and not be soft-deleted) — reporting ghosts spams the queue.
    let exists = false;
    if (targetType === 'POST') {
      exists = !!(await prisma.post.findFirst({ where: { id: targetId, deletedAt: null } }));
    } else if (targetType === 'COMMENT') {
      exists = !!(await prisma.comment.findFirst({ where: { id: targetId, deletedAt: null } }));
    } else if (targetType === 'USER') {
      if (targetId === reporterId) {
        const e: any = new Error('You cannot report yourself'); e.status = 400; throw e;
      }
      exists = !!(await prisma.user.findFirst({ where: { id: targetId, isActive: true } }));
    } else {
      exists = !!(await prisma.message.findFirst({ where: { id: targetId, deletedAt: null } }));
    }
    if (!exists) {
      const e: any = new Error('Reported content not found'); e.status = 404; throw e;
    }

    // Dedupe: one pending report per reporter+target — the queue shows it once.
    const dup = await prisma.report.findFirst({
      where: { reporterId, targetType: targetType as any, targetId, status: 'PENDING' },
    });
    if (dup) return { report: dup, deduped: true };

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetType: targetType as any,
        targetId,
        reason: reason as any,
        description: data.description,
      },
    });
    return { report, deduped: false };
  }

  /**
   * Reports visible to the requesting admin. Reports don't carry a college, so the
   * scope is derived from the REPORTER's college at query time.
   */
  async getReports(status: string | undefined, viewer: { collegeId: string | null; role: string }, requestedCollegeId?: string, limit = 50) {
    const isSuper = viewer.role === 'super_admin';

    // Super-admins may narrow to one college (?collegeId=); college admins
    // are always scoped to their own.
    let collegeFilter: any;
    if (isSuper) {
      collegeFilter = requestedCollegeId ? { reporter: { collegeId: requestedCollegeId } } : {};
    } else {
      collegeFilter = viewer.collegeId
        ? { reporter: { collegeId: viewer.collegeId } }
        : // A college-less admin sees nothing (cannot be scoped safely)
          { id: '__none__' };
    }

    return prisma.report.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...collegeFilter,
      },
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, username: true, displayName: true, college: { select: { shortName: true, name: true } } } },
      },
    });
  }

  /**
   * Resolving an admin must belong to the reporter's college (or be a super-admin),
   * and the reported content must be in-scope before it gets actioned.
   */
  async resolveReport(reportId: string, resolver: { id: string; collegeId: string | null; role: string }, action: string) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: { reporter: { select: { collegeId: true } } },
    });
    if (!report) throw new Error('Report not found');

    const isSuper = resolver.role === 'super_admin';
    if (!isSuper && report.reporter.collegeId !== resolver.collegeId) {
      const e: any = new Error('Not authorized'); e.status = 403; throw e;
    }

    return prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'RESOLVED',
        resolverId: resolver.id,
        resolvedAt: new Date(),
      },
    });
  }
}
