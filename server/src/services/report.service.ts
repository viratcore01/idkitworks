import { prisma } from '../config/prisma';

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

  async getReports(status?: string, limit = 50) {
    return prisma.report.findMany({
      where: status ? { status: status as any } : undefined,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, username: true, displayName: true } },
      },
    });
  }

  async resolveReport(reportId: string, resolverId: string, action: string) {
    return prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'RESOLVED',
        resolverId,
        resolvedAt: new Date(),
      },
    });
  }
}
