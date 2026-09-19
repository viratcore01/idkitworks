import { prisma } from '../config/prisma';
import { publish } from '../config/bus';
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
    // College moderators rule exactly ONE campus: the one the founder assigned
    // them (moderatedCollegeId), else the campus they study in. There is no
    // third option — an unassigned, college-less admin sees nothing.
    const me = await prisma.user.findUnique({
      where: { id: viewerId },
      select: { collegeId: true, moderatedCollegeId: true },
    });
    const scope = me?.moderatedCollegeId ?? me?.collegeId;
    if (!scope) return { isSuper, collegeIds: [] as string[] };
    return { isSuper, collegeIds: [scope] as string[] };
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
    const [users, banned, pendingVerifications, posts, posts24h, pendingReports, activeMatches, staff] = await Promise.all([
      prisma.user.count({ where: { collegeId } }),
      prisma.user.count({ where: { collegeId, isActive: false } }),
      prisma.idVerification.count({ where: { status: 'PENDING', user: { collegeId } } }),
      prisma.post.count({ where: { deletedAt: null, author: { collegeId } } }),
      prisma.post.count({ where: { deletedAt: null, createdAt: { gte: dayAgo }, author: { collegeId } } }),
      prisma.report.count({ where: { status: 'PENDING', reporter: { collegeId } } }),
      prisma.match.count({ where: { status: 'ACTIVE', userAObj: { collegeId } as any } }),
      // Who runs this campus: assigned moderators + resident admins.
      prisma.user.findMany({
        where: {
          role: 'admin',
          OR: [{ moderatedCollegeId: collegeId }, { moderatedCollegeId: null, collegeId }],
        },
        select: { id: true, username: true, displayName: true, moderatedCollegeId: true },
        orderBy: { username: 'asc' },
      }),
    ]);
    return { users, banned, pendingVerifications, posts, posts24h, pendingReports, activeMatches, staff };
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
          moderatedCollegeId: true, moderatedCollege: { select: { name: true, shortName: true } },
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
   * Change a user's staff role + campus assignment. Super-admin only.
   *
   * SUPREME RULES (the founder can never be replaced or fenced):
   * - the founder's row is untouchable here (no demote, no reassign)
   * - super-admin rows are untouchable here (no parallel thrones via console)
   * - yourself is untouchable here (no lockout-by-typo)
   * - promoting to moderator REQUIRES a college: that campus — and only that
   *   campus — becomes their entire moderation world
   * - demoting clears the assignment
   */
  async setRole(viewerId: string, role: string, targetId: string, newRole: string, collegeId?: string) {
    if (role !== 'super_admin') {
      const e: any = new Error('Not authorized'); e.status = 403; throw e;
    }
    if (!['user', 'admin'].includes(newRole)) {
      const e: any = new Error('Role must be user or admin'); e.status = 400; throw e;
    }
    if (targetId === viewerId) {
      const e: any = new Error('You cannot change your own role'); e.status = 400; throw e;
    }
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, isFounder: true },
    });
    if (!target) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }
    if (target.isFounder) {
      const e: any = new Error('The founder cannot be changed'); e.status = 403; throw e;
    }
    if (target.role === 'super_admin') {
      const e: any = new Error('Super-admin roles cannot be changed here'); e.status = 403; throw e;
    }

    let moderatedCollegeId: string | null = null;
    if (newRole === 'admin') {
      // Default assignment: the campus they study in. The founder may hand
      // them a different campus explicitly instead.
      const full = await prisma.user.findUnique({ where: { id: targetId }, select: { collegeId: true } });
      moderatedCollegeId = collegeId || full?.collegeId || null;
      if (!moderatedCollegeId) {
        const e: any = new Error('Pick a college to moderate first'); e.status = 400; throw e;
      }
      const exists = await prisma.college.findUnique({ where: { id: moderatedCollegeId }, select: { id: true } });
      if (!exists) {
        const e: any = new Error('College not found'); e.status = 404; throw e;
      }
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: { role: newRole, moderatedCollegeId },
    });
    invalidateUser(targetId); // live-role auth picks it up on the next request
    await this.log(viewerId, `role:${newRole}`, 'USER', targetId, updated.collegeId, undefined, { moderatedCollegeId });
    return { id: targetId, role: newRole, moderatedCollegeId };
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
      // The report belongs to its reporter's campus; the moderator's ASSIGNED
      // campus must be that campus. Client-supplied college is never trusted.
      const me = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { collegeId: true, moderatedCollegeId: true },
      });
      const scope = me?.moderatedCollegeId ?? me?.collegeId;
      if (!scope || report.reporter.collegeId !== scope) {
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
    }).then(async (closed) => {
      await this.log(viewerId, `report:${act}`, 'REPORT', reportId, report.reporter.collegeId, undefined, { targetType: report.targetType });
      return closed;
    });
  }

  /** Append-only audit entry. Logging must never break the action it records. */
  async log(actorId: string, action: string, targetType?: string, targetId?: string, collegeId?: string | null, reason?: string, metadata?: any) {
    try {
      await prisma.moderationLog.create({
        data: { actorId, action, targetType, targetId, collegeId: collegeId || null, reason, metadata },
      });
    } catch {
      /* audit is best-effort — the moderation action already succeeded */
    }
  }

  /** Activity feed: who did what, scoped to your moderation world. */
  async activity(viewerId: string, role: string, query: { collegeId?: string; actorId?: string; page?: number; limit?: number }) {
    const { isSuper, collegeIds } = await this.scope(viewerId, role, query.collegeId);
    const take = Math.min(Math.max(query.limit || 25, 1), 100);
    const page = Math.max(query.page || 0, 0);
    const where: any = {};
    if (!isSuper) {
      if (!collegeIds.length) return { total: 0, page, hasMore: false, items: [] };
      where.collegeId = collegeIds[0];
    } else if (query.collegeId) {
      where.collegeId = query.collegeId;
    }
    if (query.actorId) where.actorId = query.actorId;
    const [total, items] = await Promise.all([
      prisma.moderationLog.count({ where }),
      prisma.moderationLog.findMany({
        where,
        include: {
          actor: { select: { id: true, username: true, displayName: true } },
          college: { select: { id: true, name: true, shortName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: page * take,
        take,
      }),
    ]);
    return { total, page, hasMore: (page + 1) * take < total, items };
  }

  /**
   * Trend lines for the dashboard: per-day signups, posts, reports, matches.
   * One raw query per series (date_trunc) — 4 queries no matter the range.
   */
  async trends(viewerId: string, role: string, days = 14, requestedCollegeId?: string) {
    const { isSuper, collegeIds } = await this.scope(viewerId, role, requestedCollegeId);
    const n = Math.min(Math.max(days || 14, 1), 31);
    if (!isSuper && !collegeIds.length) return { days: n, series: [] };
    const collegeId = !isSuper ? collegeIds[0] : requestedCollegeId || null;

    const since = new Date(Date.now() - n * 24 * 3600 * 1000);
    const [signups, posts, reports, matches] = await Promise.all([
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "created_at") AS day, COUNT(*)
        FROM "users"
        WHERE "created_at" >= ${since}
        ${collegeId ? prisma.$queryRaw`AND "college_id" = ${collegeId}` : prisma.$queryRaw``}
        GROUP BY 1 ORDER BY 1`.catch(() => []),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', p."created_at") AS day, COUNT(*)
        FROM "posts" p JOIN "users" u ON u."id" = p."author_id"
        WHERE p."created_at" >= ${since} AND p."deleted_at" IS NULL
        ${collegeId ? prisma.$queryRaw`AND u."college_id" = ${collegeId}` : prisma.$queryRaw``}
        GROUP BY 1 ORDER BY 1`.catch(() => []),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', r."created_at") AS day, COUNT(*)
        FROM "reports" r JOIN "users" u ON u."id" = r."reporter_id"
        WHERE r."created_at" >= ${since}
        ${collegeId ? prisma.$queryRaw`AND u."college_id" = ${collegeId}` : prisma.$queryRaw``}
        GROUP BY 1 ORDER BY 1`.catch(() => []),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', m."created_at") AS day, COUNT(*)
        FROM "matches" m JOIN "users" u ON u."id" = m."user_a"
        WHERE m."created_at" >= ${since}
        ${collegeId ? prisma.$queryRaw`AND u."college_id" = ${collegeId}` : prisma.$queryRaw``}
        GROUP BY 1 ORDER BY 1`.catch(() => []),
    ]);

    const key = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const map = new Map<string, { date: string; signups: number; posts: number; reports: number; matches: number }>();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      map.set(d, { date: d, signups: 0, posts: 0, reports: 0, matches: 0 });
    }
    const fill = (rows: { day: Date; count: bigint }[], field: 'signups' | 'posts' | 'reports' | 'matches') => {
      for (const r of rows) {
        const k = key(r.day);
        const row = map.get(k);
        if (row) row[field] = Number(r.count);
      }
    };
    fill(signups, 'signups'); fill(posts, 'posts'); fill(reports, 'reports'); fill(matches, 'matches');
    return { days: n, series: Array.from(map.values()) };
  }

  /** Bulk resolve: same one-click actions, many reports. Returns per-item results. */
  async bulkResolve(viewerId: string, role: string, ids: string[], action: string) {
    const list = [...new Set((ids || []).filter(Boolean))].slice(0, 50);
    if (!list.length) {
      const e: any = new Error('No reports selected'); e.status = 400; throw e;
    }
    const ok: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of list) {
      try {
        await this.resolveReport(viewerId, role, id, action);
        ok.push(id);
      } catch (e: any) {
        failed.push({ id, error: e?.message || 'Failed' });
      }
    }
    return { ok, failed };
  }

  /**
   * Campus announcement: a notification broadcast to every active user in
   * scope (maintenance windows, safety notices, event blasts). Cooldown of
   * 5 minutes per scope prevents an accidental double-tap from spamming
   * thousands of inboxes.
   */
  async announce(viewerId: string, role: string, input: { collegeId?: string; title: string; body: string }) {
    const title = String(input.title || '').trim().slice(0, 120);
    const body = String(input.body || '').trim().slice(0, 500);
    if (!title || !body) {
      const e: any = new Error('Title and body are required'); e.status = 400; throw e;
    }
    const { isSuper, collegeIds } = await this.scope(viewerId, role, input.collegeId);
    const targetCollegeId = !isSuper ? collegeIds[0] : input.collegeId || null;
    if (!isSuper && !targetCollegeId) {
      const e: any = new Error('Not authorized'); e.status = 403; throw e;
    }

    const cooldown = await prisma.moderationLog.findFirst({
      where: { action: 'announce', collegeId: targetCollegeId, createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
      select: { id: true },
    });
    if (cooldown) {
      const e: any = new Error('An announcement just went out — wait 5 minutes'); e.status = 429; throw e;
    }

    const recipients = await prisma.user.findMany({
      where: { isActive: true, ...(targetCollegeId ? { collegeId: targetCollegeId } : {}) },
      select: { id: true },
    });
    const metadata = { title, body };
    for (let i = 0; i < recipients.length; i += 500) {
      const chunk = recipients.slice(i, i + 500);
      await prisma.notification.createMany({
        data: chunk.map((r) => ({ recipientId: r.id, actorId: viewerId, type: 'ANNOUNCEMENT', metadata } as any)),
      });
    }
    publish('notification:new', { userIds: recipients.map((r) => r.id) });
    await this.log(viewerId, 'announce', 'COLLEGE', targetCollegeId || 'ALL', targetCollegeId, title, { recipients: recipients.length });
    return { recipients: recipients.length };
  }

  /**
   * Full inspect view for one user: identity, standing, recent content,
   * every report touching them, verification trail. Scoped like everything.
   */
  async userDetail(viewerId: string, role: string, targetId: string) {
    const isSuper = role === 'super_admin';
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true, email: true, username: true, displayName: true, bio: true,
        collegeId: true, college: { select: { id: true, name: true, shortName: true } },
        course: true, year: true, gender: true, role: true,
        verificationStatus: true, isVerified: true, isActive: true, createdAt: true,
        _count: { select: { posts: true, comments: true } },
      },
    });
    if (!target) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }
    if (!isSuper) {
      // Moderators inspect only their ASSIGNED campus — someone else's
      // college 404s exactly like a missing user (no existence oracle).
      const me = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { collegeId: true, moderatedCollegeId: true },
      });
      const scope = me?.moderatedCollegeId ?? me?.collegeId;
      if (!scope || target.collegeId !== scope) {
        const e: any = new Error('User not found'); e.status = 404; throw e;
      }
    }
    const [posts, reportsAgainst, reportsFiled, verifications, activeMatches] = await Promise.all([
      prisma.post.findMany({
        where: { authorId: targetId, deletedAt: null },
        select: { id: true, content: true, type: true, createdAt: true, _count: { select: { likes: true, comments: { where: { deletedAt: null } } } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.report.findMany({
        where: { targetId },
        select: { id: true, targetType: true, reason: true, status: true, createdAt: true, reporter: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.report.findMany({
        where: { reporterId: targetId },
        select: { id: true, targetType: true, targetId: true, reason: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.idVerification.findMany({
        where: { userId: targetId },
        select: { id: true, status: true, autoReason: true, decidedBy: true, createdAt: true, decidedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.match.count({ where: { status: 'ACTIVE', OR: [{ userA: targetId }, { userB: targetId }] } }),
    ]);
    return { user: target, activeMatches, posts, reportsAgainst, reportsFiled, verifications };
  }

  /** Ban + audit entry (used by the console and one-click actions share it). */
  async banUser(viewerId: string, role: string, targetId: string, reason?: string) {
    const isSuper = role === 'super_admin';
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true, collegeId: true, moderatedCollegeId: true, isFounder: true },
    });
    if (!target) {
      const e: any = new Error('User not found'); e.status = 404; throw e;
    }
    // THE SUPREME RULE: the founder cannot be banned by anyone, ever.
    // Moderators cannot ban staff either — peer discipline is supreme-only.
    if (target.isFounder) {
      const e: any = new Error('This account cannot be banned'); e.status = 403; throw e;
    }
    if (targetId === viewerId) {
      const e: any = new Error('You cannot ban yourself'); e.status = 400; throw e;
    }
    if (!isSuper) {
      if (target.role !== 'user') {
        const e: any = new Error('Only the supreme admin can moderate staff'); e.status = 403; throw e;
      }
      const me = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { collegeId: true, moderatedCollegeId: true },
      });
      const scope = me?.moderatedCollegeId ?? me?.collegeId;
      if (!scope || target.collegeId !== scope) {
        const e: any = new Error('Not authorized'); e.status = 403; throw e;
      }
    } else if (target.role === 'super_admin') {
      const e: any = new Error('Not authorized'); e.status = 403; throw e;
    }
    await prisma.user.update({ where: { id: targetId }, data: { isActive: false } });
    await prisma.refreshToken.deleteMany({ where: { userId: targetId } });
    invalidateUser(targetId);
    const collegeId = (await prisma.user.findUnique({ where: { id: targetId }, select: { collegeId: true } }))?.collegeId;
    await this.log(viewerId, 'ban', 'USER', targetId, collegeId, reason);
    return { banned: true };
  }

  async unbanUser(viewerId: string, role: string, targetId: string) {    const isSuper = role === 'super_admin';
    if (!isSuper) {
      const [me, target] = await Promise.all([
        prisma.user.findUnique({ where: { id: viewerId }, select: { collegeId: true, moderatedCollegeId: true } }),
        prisma.user.findUnique({ where: { id: targetId }, select: { collegeId: true } }),
      ]);
      const scope = me?.moderatedCollegeId ?? me?.collegeId;
      if (!scope || !target || target.collegeId !== scope) {
        const e: any = new Error('Not authorized'); e.status = 403; throw e;
      }
    }
    await prisma.user.update({ where: { id: targetId }, data: { isActive: true } });
    invalidateUser(targetId);
    const collegeId = (await prisma.user.findUnique({ where: { id: targetId }, select: { collegeId: true } }))?.collegeId;
    await this.log(viewerId, 'unban', 'USER', targetId, collegeId);
    return { unbanned: true };
  }

  /**
   * College directory browser for moderators: search with live stats
   * (students, pending IDs). Super-admins see everything; college admins
   * see only their campus card.
   */
  async listColleges(viewerId: string, role: string, q = '', limit = 20) {
    const { isSuper, collegeIds } = await this.scope(viewerId, role);
    const take = Math.min(Math.max(limit || 20, 1), 50);
    const query = q.trim().slice(0, 80);
    const where: any = {};
    if (!isSuper) {
      if (!collegeIds.length) return { total: 0, colleges: [] };
      where.id = collegeIds[0];
    } else if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { shortName: { contains: query, mode: 'insensitive' } },
        { city: { contains: query, mode: 'insensitive' } },
      ];
    }
    const colleges = await prisma.college.findMany({
      where,
      select: { id: true, name: true, shortName: true, city: true, state: true, createdAt: true },
      orderBy: { name: 'asc' },
      take: query || !isSuper ? take : 50,
    });
    const withStats = await Promise.all(
      colleges.map(async (c) => {
        const [users, pendingVerifications, banned] = await Promise.all([
          prisma.user.count({ where: { collegeId: c.id } }),
          prisma.idVerification.count({ where: { status: 'PENDING', user: { collegeId: c.id } } }),
          prisma.user.count({ where: { collegeId: c.id, isActive: false } }),
        ]);
        return { ...c, users, pendingVerifications, banned };
      }),
    );
    return { total: withStats.length, colleges: withStats };
  }

  /**
   * Duplicate detector: groups campuses whose normalized names collide
   * ("IIT" vs "IIT Delhi" don't collide; "iit delhi" vs "IIT Delhi" do).
   * Super-admin only — merging reshapes the whole directory.
   */
  async duplicateColleges(role: string) {
    if (role !== 'super_admin') {
      const e: any = new Error('Not authorized'); e.status = 403; throw e;
    }
    const { normalizeCollegeName } = await import('../config/college-directory');
    const all = await prisma.college.findMany({
      select: { id: true, name: true, shortName: true, city: true },
      orderBy: { name: 'asc' },
    });
    const counts = await prisma.user.groupBy({ by: ['collegeId'], _count: { collegeId: true } });
    const usersOf = new Map(counts.map((g) => [g.collegeId, g._count.collegeId]));
    const groups = new Map<string, typeof all>();
    for (const c of all) {
      const k = normalizeCollegeName(c.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
    const dups = [];
    for (const [, rows] of groups) {
      if (rows.length < 2) continue;
      dups.push({
        key: normalizeCollegeName(rows[0].name),
        colleges: rows.map((c) => ({ ...c, users: usersOf.get(c.id) || 0 })),
      });
    }
    // Biggest mess first.
    dups.sort((a, b) => b.colleges.length - a.colleges.length);
    return { groups: dups.slice(0, 50), totalGroups: dups.length };
  }

  /**
   * Merge one campus into another (super-admin only): every student,
   * moderator assignment and audit row moves to the surviving campus, then
   * the duplicate row is deleted. Matches/chats spanning the two campuses
   * become legacy cross-college rows — already hidden by every filter.
   */
  async mergeColleges(viewerId: string, role: string, fromId: string, toId: string) {
    if (role !== 'super_admin') {
      const e: any = new Error('Not authorized'); e.status = 403; throw e;
    }
    if (!fromId || !toId || fromId === toId) {
      const e: any = new Error('Pick two different colleges'); e.status = 400; throw e;
    }
    const [from, to] = await Promise.all([
      prisma.college.findUnique({ where: { id: fromId }, select: { id: true, name: true } }),
      prisma.college.findUnique({ where: { id: toId }, select: { id: true, name: true } }),
    ]);
    if (!from || !to) {
      const e: any = new Error('College not found'); e.status = 404; throw e;
    }
    const moved = await prisma.$transaction(async (tx) => {
      const users = await tx.user.updateMany({ where: { collegeId: fromId }, data: { collegeId: toId } });
      const mods = await tx.user.updateMany({ where: { moderatedCollegeId: fromId }, data: { moderatedCollegeId: toId } });
      await tx.moderationLog.updateMany({ where: { collegeId: fromId }, data: { collegeId: toId } });
      await tx.college.delete({ where: { id: fromId } });
      return { users: users.count, moderators: mods.count };
    });
    // Everyone who moved campus gets re-scoped on their next request.
    const movedUsers = await prisma.user.findMany({ where: { collegeId: toId }, select: { id: true }, take: 5000 });
    for (const u of movedUsers) invalidateUser(u.id);
    await this.log(viewerId, 'college:merge', 'COLLEGE', fromId, toId, `${from.name} → ${to.name}`, moved);
    return { merged: true, from: { id: fromId, name: from.name }, to: { id: toId, name: to.name }, ...moved };
  }
}
