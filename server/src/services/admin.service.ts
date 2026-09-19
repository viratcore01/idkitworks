import { prisma } from '../config/prisma';
import { invalidateUser } from '../utils/user-cache';

/**
 * Moderator console backend — one staffer, every college they may touch.
 *
 * SCOPING RULE (every method): a college `admin` sees ONLY their own
 * college; `super_admin` sees everything (or one college via an explicit
 * filter). A viewer with no college gets an empty scope — never the world.
 * College is always resolved from the LIVE admin row, never from params.
 */
export class AdminService {
  /** Resolve the set of college ids this viewer may moderate. */
  private async scope(viewerId: string, role: string, requestedCollegeId?: string) {
    const isSuper = role === 'super_admin';
    if (isSuper) {
      if (requestedCollegeId) {
        const exists = await prisma.college.findUnique({ where: { id: requestedCollegeId }, select: { id: true } });
        if (!exists) {
          const e: any = new Error('College not found'); e.status = 404; throw e;
        }
        return { isSuper, collegeIds: [requestedCollegeId] as string[] };
      }
      return { isSuper, collegeIds: null as string[] | null }; // null = all colleges
    }
    const me = await prisma.user.findUnique({ where: { id: viewerId }, select: { collegeId: true } });
    if (!me?.collegeId) return { isSuper, collegeIds: [] as string[] };
    return { isSuper, collegeIds: [me.collegeId] as string[] };
  }

  /**
   * Overview: what a moderator needs at 9am. Single-college view (college
   * admins, or super-admins with ?collegeId=) returns the full health card.
   * Super-admin "all colleges" returns global totals + the live attention
   * queues (pending IDs/reports with college labels) + biggest colleges —
   * computing 7 count queries × 400+ colleges on every load would melt the
   * free-tier DB, so the all-view aggregates instead of scanning.
   */
  async overview(viewerId: string, role: string, requestedCollegeId?: string) {
    const { isSuper, collegeIds } = await this.scope(viewerId, role, requestedCollegeId);

    // Single-college card (the common case).
    if (collegeIds !== null && collegeIds.length === 1) {
      const c = await prisma.college.findUnique({
        where: { id: collegeIds[0] },
        select: { id: true, name: true, shortName: true, city: true },
      });
      if (!c) {
        const e: any = new Error('College not found'); e.status = 404; throw e;
      }
      const card = await this.collegeCard(c.id);
      const full = { ...c, ...card, needsAttention: card.pendingVerifications + card.pendingReports };
      return { isSuper, totals: { ...full, colleges: 1 }, colleges: [full], attention: [], biggest: [] };
    }
    if (collegeIds !== null && collegeIds.length === 0) {
      return { isSuper, totals: { colleges: 0, users: 0, banned: 0, pendingVerifications: 0, posts: 0, posts24h: 0, pendingReports: 0, activeMatches: 0 }, colleges: [], attention: [], biggest: [] };
    }

    // Super-admin, all colleges: totals + attention queues + biggest colleges.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const [users, banned, posts, posts24h, activeMatches, pendingIds, pendingReports, perCollegeUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: false } }),
      prisma.post.count({ where: { deletedAt: null } }),
      prisma.post.count({ where: { deletedAt: null, createdAt: { gte: dayAgo } } }),
      prisma.match.count({ where: { status: 'ACTIVE' } }),
      prisma.idVerification.findMany({
        where: { status: 'PENDING' },
        select: { id: true, createdAt: true, user: { select: { id: true, username: true, displayName: true, college: { select: { id: true, name: true, shortName: true } } } } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      prisma.report.findMany({
        where: { status: 'PENDING' },
        select: { id: true, targetType: true, reason: true, createdAt: true, reporter: { select: { username: true, college: { select: { id: true, name: true, shortName: true } } } } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      prisma.user.groupBy({ by: ['collegeId'], _count: { collegeId: true }, orderBy: { _count: { collegeId: 'desc' } }, take: 20 }),
    ]);

    const collegeIdsTop = perCollegeUsers.map((g) => g.collegeId).filter(Boolean) as string[];
    const collegeRows = collegeIdsTop.length
      ? await prisma.college.findMany({ where: { id: { in: collegeIdsTop } }, select: { id: true, name: true, shortName: true } })
      : [];
    const nameOf = new Map(collegeRows.map((c) => [c.id, c]));
    const biggest = perCollegeUsers.map((g) => {
      const meta = nameOf.get(g.collegeId || '');
      return {
        id: g.collegeId, users: g._count.collegeId,
        name: meta?.name || 'No college', shortName: meta?.shortName || null,
      };
    });

    const totals = {
      colleges: await prisma.college.count(),
      users, banned, posts, posts24h, activeMatches,
      pendingVerifications: pendingIds.length, pendingReports: pendingReports.length,
    };
    return { isSuper, totals, colleges: [], attention: { verifications: pendingIds, reports: pendingReports }, biggest };
  }

  private async collegeCard(collegeId: string) {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const [users, banned, pendingVerifications, posts, posts24h, pendingReports, activeMatches] = await Promise.all([
      prisma.user.count({ where: { collegeId } }),
      prisma.user.count({ where: { collegeId, isActive: false } }),
      prisma.idVerification.count({ where: { status: 'PENDING', user: { collegeId } } }),
      prisma.post.count({ where: { deletedAt: null, author: { collegeId } } }),
      prisma.post.count({ where: { deletedAt: null, createdAt: { gte: dayAgo }, author: { collegeId } } }),
      prisma.report.count({ where: { status: 'PENDING', reporter: { collegeId } } }),
      prisma.match.count({ where: { status: 'ACTIVE', userAObj: { collegeId } as any } }),
    ]);
    return { users, banned, pendingVerifications, posts, posts24h, pendingReports, activeMatches };
  }

  /**
   * User directory: search + filter the people you moderate. Never returns
   * password hashes, DOB, or tokens — the console needs identity, not secrets.
   */
  async listUsers(viewerId: string, role: string, query: {
    q?: string; collegeId?: string; filter?: string; page?: number; limit?: number;
  }) {
    const { collegeIds } = await this.scope(viewerId, role, query.collegeId);
    const take = Math.min(Math.max(query.limit || 20, 1), 50);
    const page = Math.max(query.page || 0, 0);
    const q = (query.q || '').trim().slice(0, 80);

    const where: any = {};
    if (collegeIds !== null) where.collegeId = collegeIds.length === 1 ? collegeIds[0] : { in: collegeIds };
    if (q) {
      where.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (query.filter === 'banned') where.isActive = false;
    else if (query.filter === 'unverified') where.verificationStatus = { not: 'VERIFIED' };
    else if (query.filter === 'admins') where.role = { in: ['admin', 'super_admin'] };
    else if (query.filter === 'pending') where.verificationStatus = 'PENDING';

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true, username: true, displayName: true, email: true,
          collegeId: true, college: { select: { name: true, shortName: true } },
          role: true, verificationStatus: true, isVerified: true, isActive: true,
          createdAt: true,
          _count: { select: { posts: true, reports: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: page * take,
        take,
      }),
    ]);
    return { total, page, hasMore: (page + 1) * take < total, users };
  }

  /**
   * Change a user's staff role. Super-admin only; cannot touch other
   * super-admins and cannot demote yourself (no lockout-by-typo).
   */
  async setRole(viewerId: string, role: string, targetId: string, newRole: string) {
    if (role !== 'super_admin') {
      const e: any = new Error('Not authorized'); e.status = 403; throw e;
    }
    if (!['user', 'admin'].includes(newRole)) {
      const e: any = new Error('Role must be user or admin'); e.status = 400; throw e;
    }
    if (targetId === viewerId) {
      const e: any = new Error('You cannot change your own role'); e.status = 400; throw e;
    }
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } });
    if (!target) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }
    if (target.role === 'super_admin') {
      const e: any = new Error('Super-admin roles cannot be changed here'); e.status = 403; throw e;
    }
    await prisma.user.update({ where: { id: targetId }, data: { role: newRole } });
    invalidateUser(targetId); // live-role auth picks it up on the next request
    return { id: targetId, role: newRole };
  }

  /**
   * Proactive content browser: the newest posts/comments in scope, so mods
   * don't have to wait for reports. Query param `q` matches content text.
   */
  async browseContent(viewerId: string, role: string, query: {
    type?: string; q?: string; collegeId?: string; page?: number; limit?: number;
  }) {
    const { collegeIds } = await this.scope(viewerId, role, query.collegeId);
    const take = Math.min(Math.max(query.limit || 20, 1), 50);
    const page = Math.max(query.page || 0, 0);
    const q = (query.q || '').trim().slice(0, 200);
    const scopeCollege: any = collegeIds === null ? {} : { collegeId: collegeIds.length === 1 ? collegeIds[0] : { in: collegeIds } };

    if ((query.type || 'post') === 'comment') {
      const where: any = {
        deletedAt: null,
        ...(q && { content: { contains: q, mode: 'insensitive' } }),
        author: { isActive: true, ...scopeCollege },
      };
      const [total, comments] = await Promise.all([
        prisma.comment.count({ where }),
        prisma.comment.findMany({
          where,
          include: {
            author: { select: { id: true, username: true, displayName: true, college: { select: { shortName: true, name: true } } } },
            post: { select: { id: true, content: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: page * take,
          take,
        }),
      ]);
      return { type: 'comment', total, page, hasMore: (page + 1) * take < total, items: comments };
    }

    const where: any = {
      deletedAt: null,
      ...(q && { content: { contains: q, mode: 'insensitive' } }),
      author: { isActive: true, ...scopeCollege },
    };
    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        include: {
          author: { select: { id: true, username: true, displayName: true, college: { select: { shortName: true, name: true } } } },
          _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: page * take,
        take,
      }),
    ]);
    return { type: 'post', total, page, hasMore: (page + 1) * take < total, items: posts };
  }

  /**
   * One-click report resolution. `action`:
   * - dismiss: report was noise, just close it
   * - delete_content: take down the reported post/comment, then close
   * - ban_user: ban the reported user (USER reports) or the content author,
   *   then close. Bans are reversible from the Users tab.
   */
  async resolveReport(viewerId: string, role: string, reportId: string, action: string) {
    const isSuper = role === 'super_admin';
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: { reporter: { select: { id: true, collegeId: true } } },
    });
    if (!report) {
      const e: any = new Error('Report not found'); e.status = 404; throw e;
    }
    if (!isSuper) {
      const me = await prisma.user.findUnique({ where: { id: viewerId }, select: { collegeId: true } });
      if (!me?.collegeId || report.reporter.collegeId !== me.collegeId) {
        const e: any = new Error('Not authorized'); e.status = 403; throw e;
      }
    }
    if (report.status !== 'PENDING') {
      const e: any = new Error('Report already resolved'); e.status = 400; throw e;
    }

    const act = ['dismiss', 'delete_content', 'ban_user'].includes(action) ? action : 'dismiss';

    if (act === 'delete_content' || act === 'ban_user') {
      // Resolve WHO the action hits, scoped to the moderator's world.
      let authorId: string | null = null;
      if (report.targetType === 'POST') {
        const p = await prisma.post.findUnique({ where: { id: report.targetId }, select: { authorId: true, author: { select: { collegeId: true } } } });
        if (p && (isSuper || p.author.collegeId === report.reporter.collegeId)) authorId = p.authorId;
      } else if (report.targetType === 'COMMENT') {
        const c = await prisma.comment.findUnique({ where: { id: report.targetId }, select: { authorId: true, author: { select: { collegeId: true } } } });
        if (c && (isSuper || c.author.collegeId === report.reporter.collegeId)) authorId = c.authorId;
      } else if (report.targetType === 'USER') {
        const u = await prisma.user.findUnique({ where: { id: report.targetId }, select: { id: true, collegeId: true, role: true } });
        if (u && u.role !== 'super_admin' && (isSuper || u.collegeId === report.reporter.collegeId)) authorId = u.id;
      } else if (report.targetType === 'MESSAGE') {
        const m = await prisma.message.findUnique({ where: { id: report.targetId }, select: { senderId: true, sender: { select: { collegeId: true } } } });
        if (m && (isSuper || m.sender.collegeId === report.reporter.collegeId)) authorId = m.senderId;
      }

      if (act === 'delete_content' && (report.targetType === 'POST' || report.targetType === 'COMMENT')) {
        if (!authorId) {
          const e: any = new Error('Content not found or out of scope'); e.status = 404; throw e;
        }
        if (report.targetType === 'POST') await prisma.post.updateMany({ where: { id: report.targetId, deletedAt: null }, data: { deletedAt: new Date() } });
        else await prisma.comment.updateMany({ where: { id: report.targetId, deletedAt: null }, data: { deletedAt: new Date() } });
      }

      if (act === 'ban_user') {
        if (!authorId || authorId === viewerId) {
          const e: any = new Error('Cannot ban this user'); e.status = 400; throw e;
        }
        const target = await prisma.user.findUnique({ where: { id: authorId }, select: { role: true } });
        if (target?.role === 'super_admin') {
          const e: any = new Error('Cannot ban this user'); e.status = 403; throw e;
        }
        await prisma.user.update({ where: { id: authorId }, data: { isActive: false } });
        await prisma.refreshToken.deleteMany({ where: { userId: authorId } });
        invalidateUser(authorId);
      }
    }

    return prisma.report.update({
      where: { id: reportId },
      data: { status: 'RESOLVED', resolverId: viewerId, resolvedAt: new Date() },
    });
  }
}
