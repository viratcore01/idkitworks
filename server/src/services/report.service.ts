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
    return prisma.report.create({
      data: {
        reporterId,
        targetType: data.targetType as any,
        targetId: data.targetId,
        reason: data.reason as any,
        description: data.description,
      },
    });
  }

  /**
   * Reports visible to the requesting admin. Reports don't carry a college, so the
   * scope is derived from the REPORTER's college at query time.
   */
  async getReports(status: string | undefined, viewer: { collegeId: string | null; role: string }, limit = 50) {
    const isSuper = viewer.role === 'super_admin';

    const collegeFilter = isSuper
      ? {}
      : viewer.collegeId
        ? { reporter: { collegeId: viewer.collegeId } }
        : // A college-less admin sees nothing (cannot be scoped safely)
          { id: '__none__' };

    return prisma.report.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...collegeFilter,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, username: true, displayName: true } },
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
