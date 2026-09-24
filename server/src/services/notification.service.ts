import { prisma } from '../config/prisma';

// ── Unread-count fast path ──
// 60s TTL cache keyed by userId. The bell badge polls every minute, so a hit
// costs ZERO round-trips to Mumbai (each one used to add ~1-2s on Render free
// + Supabase). Freshness is preserved: EVERY code path that creates or clears
// notifications calls invalidateUnreadCount() (see below).
const UNREAD_TTL_MS = 60_000;
const unreadCache = new Map<string, { count: number; at: number }>();

export function invalidateUnreadCount(...userIds: string[]): void {
  for (const id of userIds) unreadCache.delete(id);
}

export function invalidateAllUnreadCounts(): void {
  unreadCache.clear();
}

export class NotificationService {
  /** Blocked actors never surface — either direction is a hard wall. */
  private async blockedActorIds(userId: string): Promise<string[]> {
    const { prisma: db } = await import('../config/prisma');
    const blocks = await db.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const b of blocks) {
      if (b.blockerId !== userId) ids.add(b.blockerId);
      if (b.blockedId !== userId) ids.add(b.blockedId);
    }
    return Array.from(ids);
  }

  async getNotifications(userId: string, limit = 20, cursor?: string, viewerCollegeId?: string | null) {
    const take = Math.min(Math.max(limit, 1), 50);
    const excluded = await this.blockedActorIds(userId);
    // NOTE: actorId:null (anonymous) must stay visible — SQL NULL never
    // matches NOT IN, so excluded actors are filtered via OR(null, notIn).
    const blockFilter = excluded.length
      ? { OR: [{ actorId: null }, { actorId: { notIn: excluded } }] }
      : {};
    // College filter keeps actor-less (anonymous) AND broadcast announcements
    // visible: a super-admin's college usually differs from the reader's, and
    // an announcement addressed to your campus must reach you regardless.
    const collegeFilter = viewerCollegeId
      ? [{ OR: [{ actor: { collegeId: viewerCollegeId } }, { actorId: null }, { type: 'ANNOUNCEMENT' }] }]
      : [];
    const notifications = await prisma.notification.findMany({
      where: {
        recipientId: userId,
        AND: [
          blockFilter,
          // PRODUCT RULE: college-only — never surface an actor from another college.
          // OR actorId:null keeps ANONYMOUS notifications visible: a relation
          // filter alone would silently hide every actor-less notification.
          ...collegeFilter,
        ],
      } as any,
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } },
      },
    });

    const hasMore = notifications.length > take;
    const data = hasMore ? notifications.slice(0, take) : notifications;

    // Backfill WHY-YOU-MATCHED for old MATCH rows whose metadata predates the
    // criteria snapshot (or was stored empty): the Match row is the source of
    // truth, so merge its criteria into the response. New matches already
    // carry metadata — this only touches rows that need it, in one query.
    const needsCriteria = data.filter(
      (n: any) =>
        n.type === 'MATCH' &&
        n.matchId &&
        (!n.metadata || (!((n.metadata as any)?.goals?.length) && !((n.metadata as any)?.interests?.length))),
    );
    if (needsCriteria.length) {
      const matchIds = [...new Set(needsCriteria.map((n: any) => n.matchId as string))];
      try {
        const matches = await prisma.match.findMany({
          where: { id: { in: matchIds } },
          select: { id: true, criteria: true },
        });
        const byId = new Map(matches.map((m) => [m.id, (m as any).criteria]));
        for (const n of data as any[]) {
          if (n.type === 'MATCH' && n.matchId && byId.get(n.matchId)) {
            const c: any = byId.get(n.matchId);
            if (c && (c.goals?.length || c.interests?.length)) n.metadata = c;
          }
        }
      } catch {
        // Criteria enrichment is best-effort — never fail the inbox for it.
      }
    }

    return {
      notifications: data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });
    invalidateUnreadCount(userId);
    return { message: 'All notifications marked as read' };
  }

  /**
   * Mark ONE notification read — called when the reader actually opens it.
   *
   * Before this, the only way to clear the bell was the blanket "Mark all
   * read" button, so the badge lied: you had read the match, but the count
   * stayed up until you nuked every other notification too.
   *
   * SCOPED BY recipientId, not just id: someone else's notification is a
   * silent no-op, and its existence is not confirmable — the same wall
   * philosophy as cross-college content (never 403 on a foreign id, which
   * would leak that it exists).
   */
  async markRead(userId: string, notificationId: string) {
    if (typeof notificationId !== 'string' || notificationId.length < 8 || notificationId.length > 64) {
      const e: any = new Error('Invalid notificationId');
      e.status = 400;
      throw e;
    }
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, recipientId: userId, isRead: false },
      data: { isRead: true },
    });
    // count === 0 is the normal idempotent case (already read, or a repeat tap).
    if (result.count > 0) invalidateUnreadCount(userId);
    return { ok: true, updated: result.count };
  }

  async getUnreadCount(userId: string, viewerCollegeId?: string | null) {
    // 60s TTL cache keyed by userId. The bell badge polls every minute, so a hit
    // costs ZERO round-trips to Mumbai (each one used to add ~1-2s on Render free
    // + Supabase). Freshness is preserved: EVERY code path that creates or clears
    // notifications calls invalidateUnreadCount() (see below).
    const hit = unreadCache.get(userId);
    if (hit && Date.now() - hit.at <= UNREAD_TTL_MS) return { count: hit.count };

    // ONE round-trip total: the blocked-actor filter is folded into the COUNT
    // as NOT EXISTS clauses instead of a separate block.findMany() first.
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "notifications" n
      WHERE n."recipient_id" = ${userId}
        AND n."is_read" = false
        AND (n."actor_id" IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM "blocks" b
               WHERE (b."blocker_id" = ${userId} AND b."blocked_id" = n."actor_id")
                  OR (b."blocked_id" = ${userId} AND b."blocker_id" = n."actor_id")
             ))
        AND (${viewerCollegeId ?? null}::text IS NULL
             OR n."type" = 'ANNOUNCEMENT'
             OR n."actor_id" IS NULL
             OR EXISTS (
               SELECT 1 FROM "users" u WHERE u."id" = n."actor_id" AND u."college_id" = ${viewerCollegeId ?? null}::text
             ))
    `;
    const count = Number(rows[0]?.count ?? 0);
    unreadCache.set(userId, { count, at: Date.now() });
    return { count };
  }
}
