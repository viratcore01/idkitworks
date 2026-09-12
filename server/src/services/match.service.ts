import { prisma } from '../config/prisma';

/** Pass memory: passed profiles resurface after this many days (Tinder-style). */
const PASS_RESURFACE_DAYS = 30;
/** Deck page size: swipe through ~a page, then fetch the next. */
const DECK_PAGE_SIZE = 20;
/** Like cap per rolling window — spam/scraper protection (Tinder-style). */
const LIKE_CAP = 100;
const LIKE_WINDOW_HOURS = 12;

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

export class MatchService {
  /**
   * The swipe deck: one page at a time (keyset pagination via offset is fine here —
   * the pool is already small after exclusions, and each page is a single indexed query).
   * Real-world pattern (Tinder/Bumble): exclude self, already-actioned, blocked, inactive;
   * apply the viewer's preferences; order by newest first; return a page + hasMore.
   */
  async discover(userId: string, page = 0, limit = DECK_PAGE_SIZE) {
    const take = Math.min(Math.max(limit, 1), 50);

    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      include: { matchPreference: true },
    });
    if (!viewer) throw new Error('User not found');

    // PRODUCT RULE: hyperlocal, college-only. No college → empty deck, no exceptions.
    if (!viewer.collegeId) {
      return { users: [], page, hasMore: false, totalRemaining: 0 };
    }

    const pref = viewer.matchPreference;

    // Everyone this user has already LIKEd or PASSed (within the resurface window)
    const windowStart = new Date(Date.now() - PASS_RESURFACE_DAYS * 24 * 3600 * 1000);
    const actioned = await prisma.matchLike.findMany({
      where: {
        senderId: userId,
        OR: [{ action: 'LIKE' }, { action: 'PASS', createdAt: { gte: windowStart } }],
      },
      select: { receiverId: true },
    });

    // Blocks are bidirectional
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });

    const excludeIds = new Set<string>([userId]);
    for (const a of actioned) excludeIds.add(a.receiverId);
    for (const b of blocks) {
      excludeIds.add(b.blockerId);
      excludeIds.add(b.blockedId);
    }

    // Apply the viewer's preferences (with sane fallbacks so the deck is never empty by default)
    const ageMin = pref?.ageRangeMin ?? 18;
    const ageMax = pref?.ageRangeMax ?? 60;
    const today = new Date();
    const dobUpper = new Date(today.getFullYear() - ageMin, today.getMonth(), today.getDate());
    const dobLower = new Date(today.getFullYear() - ageMax - 1, today.getMonth(), today.getDate());

    const where: any = {
      isActive: true,
      id: { notIn: Array.from(excludeIds) },
      // PRODUCT RULE: the deck is ONLY the viewer's college. The old
      // collegePreference cross-college loophole is removed — it can never widen
      // the pool beyond the viewer's own college.
      collegeId: viewer.collegeId,
      dateOfBirth: { gte: dobLower, lte: dobUpper },
    };

    const wantedGender = pref?.genderPreference || 'EVERYONE';
    if (wantedGender !== 'EVERYONE') {
      where.gender = wantedGender;
    }

    const total = await prisma.user.count({ where });

    const users = await prisma.user.findMany({
      where,
      skip: page * take,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        course: true,
        year: true,
        gender: true,
        dateOfBirth: true,
        college: { select: { id: true, name: true, shortName: true } },
        interests: { include: { interest: true } },
      },
    });

    return {
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        course: u.course,
        year: u.year,
        age: ageFrom(u.dateOfBirth),
        college: u.college,
        interests: u.interests.map((ui) => ui.interest),
      })),
      page,
      hasMore: (page + 1) * take < total,
      totalRemaining: Math.max(total - page * take, 0),
    };
  }

  /**
   * Like or pass on a profile. One endpoint both ways keeps the action row
   * idempotent: re-swiping upserts instead of duplicating.
   * Returns { matched: true } when the other user already liked back — atomically,
   * inside a transaction so two users swiping simultaneously can't create double matches.
   */
  async action(senderId: string, receiverId: string, action: 'LIKE' | 'PASS') {
    if (senderId === receiverId) throw new Error("Can't act on yourself");

    const [sender, receiver] = await Promise.all([
      prisma.user.findUnique({ where: { id: senderId }, select: { collegeId: true } }),
      prisma.user.findUnique({ where: { id: receiverId }, select: { collegeId: true, isActive: true } }),
    ]);
    if (!receiver || !receiver.isActive) throw new Error('User not available');

    // PRODUCT RULE: college-only. Swiping across colleges is impossible —
    // even a guessed userId from another college gets a clean rejection.
    if (!sender?.collegeId || sender.collegeId !== receiver.collegeId) {
      const e: any = new Error('User not available'); e.status = 404; throw e;
    }

    // Blocks are a hard wall in both directions
    const blocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId },
        ],
      },
    });
    if (blocked) throw new Error('Cannot interact with this user');

    if (action === 'LIKE') {
      const windowStart = new Date(Date.now() - LIKE_WINDOW_HOURS * 3600 * 1000);
      const recentLikes = await prisma.matchLike.count({
        where: { senderId, action: 'LIKE', createdAt: { gte: windowStart } },
      });
      if (recentLikes >= LIKE_CAP) {
        const err: any = new Error(`Daily like limit reached. Try again in a few hours.`);
        err.status = 429;
        throw err;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.matchLike.findUnique({
        where: { senderId_receiverId: { senderId, receiverId } },
      });
      if (existing?.action === action) {
        // Idempotent re-swipe: same action, no-op — EXCEPT re-like after unmatch,
        // which must be able to re-activate the dormant match (Tinder/Bumble allow re-matching).
        if (action === 'LIKE') {
          const [ua, ub] = [senderId, receiverId].sort();
          const dormant = await tx.match.findUnique({ where: { userA_userB: { userA: ua, userB: ub } } });
          if (dormant?.status === 'ACTIVE') return { matched: false, duplicate: true };
          // Dormant (ENDED) or missing → fall through so the mutual check re-activates it.
        } else {
          return { matched: false, duplicate: true };
        }
      }

      await tx.matchLike.upsert({
        where: { senderId_receiverId: { senderId, receiverId } },
        create: { senderId, receiverId, action },
        update: { action, createdAt: new Date() },
      });

      if (action === 'PASS') return { matched: false };

      // Mutual like? Match, inside the same transaction.
      const mutual = await tx.matchLike.findUnique({
        where: { senderId_receiverId: { senderId: receiverId, receiverId: senderId } },
      });

      if (mutual?.action === 'LIKE') {
        const [userA, userB] = [senderId, receiverId].sort();
        const match = await tx.match.upsert({
          where: { userA_userB: { userA, userB } },
          create: { userA, userB, type: 'DATING' },
          update: { status: 'ACTIVE', endedAt: null, endedBy: null },
        });

        // No skipDuplicates on SQLite — but the idempotency guard above means this
        // only ever runs once per mutual pair.
        await tx.notification.createMany({
          data: [
            { recipientId: senderId, actorId: receiverId, type: 'MATCH', matchId: match.id },
            { recipientId: receiverId, actorId: senderId, type: 'MATCH', matchId: match.id },
          ] as any,
        });

        return { matched: true, match };
      }

      return { matched: false };
    });

    return result;
  }

  /** Like a user (compat wrapper). */
  like(senderId: string, receiverId: string) {
    return this.action(senderId, receiverId, 'LIKE');
  }

  /**
   * Pass records a PASS row so the profile leaves the deck but can resurface
   * after PASS_RESURFACE_DAYS. (Real apps do exactly this — "seen" memory.)
   */
  async pass(senderId: string, receiverId: string) {
    return this.action(senderId, receiverId, 'PASS');
  }

  async getMatches(userId: string, page = 0, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);

    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!viewer?.collegeId) return { matches: [], hasMore: false };

    const matches = await prisma.match.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ userA: userId }, { userB: userId }],
        // PRODUCT RULE: matches can only ever be same-college pairs (enforced at
        // creation); this filter also hides any legacy cross-college rows.
        userAObj: { collegeId: viewer.collegeId },
        userBObj: { collegeId: viewer.collegeId },
      },
      include: {
        userAObj: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true } },
        userBObj: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: page * take,
      take: take + 1,
    });

    const hasMore = matches.length > take;
    const data = hasMore ? matches.slice(0, take) : matches;

    return {
      matches: data.map((m) => ({
        id: m.id,
        partner: m.userA === userId ? m.userBObj : m.userAObj,
        createdAt: m.createdAt,
      })),
      hasMore,
    };
  }

  /** Unmatch: soft-ends the match (chat history preserved for safety/reporting). */
  async unmatch(userId: string, matchId: string) {
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new Error('Match not found');
    if (match.userA !== userId && match.userB !== userId) throw new Error('Not authorized');

    await prisma.match.update({
      where: { id: matchId },
      data: { status: 'ENDED', endedAt: new Date(), endedBy: userId },
    });

    // Clear the like pair so both users swipe each other fresh if they ever re-like
    // (Tinder semantics — otherwise the old LIKE rows block re-matching forever).
    await prisma.matchLike.deleteMany({
      where: {
        OR: [
          { senderId: match.userA, receiverId: match.userB },
          { senderId: match.userB, receiverId: match.userA },
        ],
      },
    });
    return { unmatched: true };
  }

  /** Small counters for the deck header: likes sent today, who liked you. */
  async getStats(userId: string) {
    const windowStart = new Date(Date.now() - LIKE_WINDOW_HOURS * 3600 * 1000);
    const [likesSent, likesReceived, totalMatches] = await Promise.all([
      prisma.matchLike.count({ where: { senderId: userId, action: 'LIKE', createdAt: { gte: windowStart } } }),
      prisma.matchLike.count({ where: { receiverId: userId, action: 'LIKE' } }),
      prisma.match.count({ where: { status: 'ACTIVE', OR: [{ userA: userId }, { userB: userId }] } }),
    ]);
    return { likesSent, likeCap: LIKE_CAP, likesReceived, totalMatches };
  }

  async updatePreference(userId: string, data: {
    lookingFor?: string;
    ageRangeMin?: number;
    ageRangeMax?: number;
    genderPreference?: string;
    collegePreference?: string;
  }) {
    // Clamp inputs — server is the source of truth
    const ageMin = data.ageRangeMin != null ? Math.min(Math.max(Math.round(data.ageRangeMin), 18), 99) : undefined;
    const ageMax = data.ageRangeMax != null ? Math.min(Math.max(Math.round(data.ageRangeMax), 18), 99) : undefined;
    const lookingFor = ['DATING', 'FRIENDS', 'BOTH'].includes(data.lookingFor || '') ? data.lookingFor : undefined;
    const genderPref = ['EVERYONE', 'MALE', 'FEMALE', 'OTHER'].includes(data.genderPreference || '') ? data.genderPreference : undefined;
    // PRODUCT RULE: college isolation is not a preference — ignore any client value.
    const collegePref: string | undefined = undefined;

    const finalMin = ageMin ?? undefined;
    const finalMax = ageMax ?? undefined;

    return prisma.matchPreference.upsert({
      where: { userId },
      create: {
        userId,
        lookingFor: (lookingFor as any) || 'DATING',
        ageRangeMin: finalMin,
        ageRangeMax: finalMax,
        genderPreference: (genderPref as any) || 'EVERYONE',
        collegePreference: collegePref, // always null — college scope is not optional
      },
      update: {
        ...(lookingFor && { lookingFor: lookingFor as any }),
        ...(finalMin !== undefined && { ageRangeMin: finalMin }),
        ...(finalMax !== undefined && { ageRangeMax: finalMax }),
        ...(genderPref && { genderPreference: genderPref as any }),
        // Force any legacy cross-college preference back to null
        collegePreference: null,
      },
    });
  }

  async getPreference(userId: string) {
    const pref = await prisma.matchPreference.findUnique({ where: { userId } });
    return pref || { lookingFor: 'DATING', ageRangeMin: null, ageRangeMax: null, genderPreference: 'EVERYONE', collegePreference: null, visibility: true };
  }
}
