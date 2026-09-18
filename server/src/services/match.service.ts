import { prisma } from '../config/prisma';
import { publish } from '../config/bus';

/**
 * Loop-chain deck: fresh profiles come first (newest first). Once they run
 * out, previously-passed profiles re-enter AFTER them, ordered by oldest
 * pass first — so ✗ sends a profile to the BACK of the chain and the deck
 * cycles forever. New profiles join the FRONT; the cycle just keeps going.
 * (LIKEd profiles stay hidden until unmatched; blocked/inactive never show.)
 */

/** True when the user has no photos at all — deck & swipes are locked. */
async function needsPhotoGate(userId: string): Promise<boolean> {
  const count = await prisma.userPhoto.count({ where: { userId } });
  return count === 0;
}
/** Deck page size: swipe through ~a page, then fetch the next. */
const DECK_PAGE_SIZE = 20;
/** Like cap per rolling window — spam/scraper protection (Tinder-style). */
const LIKE_CAP = 100;
const LIKE_WINDOW_HOURS = 12;

/** Real-app requirement (Tinder/Bumble/Hinge): no photo, no dating pool. */
function photoGateResponse(page: number) {
  return {
    gated: true,
    code: 'PROFILE_PHOTO_REQUIRED',
    reason: 'Add a profile photo to start matching — real people only.',
    users: [],
    page,
    hasMore: false,
    totalRemaining: 0,
  };
}

/** Shared select-clause for deck cards (fresh + recycled). */
const DECK_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  course: true,
  year: true,
  gender: true,
  dateOfBirth: true,      college: { select: { id: true, name: true, shortName: true } },
      interests: { include: { interest: true } },
      photos: { select: { id: true, slot: true }, orderBy: { slot: 'asc' as const } },
      isVerified: true,
      relationshipGoal: true,
};

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

    // PHOTO GATE: without at least one photo the deck stays locked —
    // matching is for real people, not empty circles.
    const viewerPhotoCount = await prisma.userPhoto.count({ where: { userId } });
    if (viewerPhotoCount === 0) {
      return photoGateResponse(page);
    }

    const pref = viewer.matchPreference;

    // Viewer's own interests power the shared-interest dealbreaker.
    const viewerInterestIds = new Set(
      (await prisma.userInterest.findMany({ where: { userId }, select: { interestId: true } })).map((ui) => ui.interestId),
    );
    // the deck permanently (pending the other person's answer); passes only
    // shape ORDER (they re-enter at the back of the chain), never visibility.
    const actioned = await prisma.matchLike.findMany({
      where: { senderId: userId },
      select: { receiverId: true, action: true, createdAt: true },
    });
    const likedIds = actioned.filter((a) => a.action === 'LIKE').map((a) => a.receiverId);
    // oldest pass first — the back of the loop chain
    const passedIds = actioned
      .filter((a) => a.action === 'PASS')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((a) => a.receiverId);

    // Blocks are bidirectional
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });

    const excludeIds = new Set<string>([userId, ...likedIds, ...passedIds]);
    for (const b of blocks) {
      excludeIds.add(b.blockerId);
      excludeIds.add(b.blockedId);
    }

    // Apply the viewer's preferences (with sane fallbacks so the deck is never empty by default).
    // Floor is the app's minimum age (16) — otherwise 16-17 year olds get an empty deck AND become invisible.
    const ageMin = pref?.ageRangeMin ?? 16;
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
      // Only show people who have at least one photo — a photo-less card is
      // useless in a swipe deck (and every real app hides them).
      photos: { some: {} },
    };

    const wantedGender = pref?.genderPreference || 'EVERYONE';
    if (wantedGender !== 'EVERYONE') {
      where.gender = wantedGender;
    }

    // ── DEALBREAKERS (each opted-in by the viewer; off by default) ──
    // Verified-only: just isVerified.
    if (pref?.onlyVerified) {
      where.isVerified = true;
    }
    // Minimum year (seniors-only etc.). Users with no year set can't prove it — excluded.
    if (pref?.minYear != null) {
      where.year = { gte: pref.minYear };
    }
    // Intent matching: restrict to profiles whose relationship goal is one
    // the viewer is open to. Users who never set a goal always remain
    // visible (undisclosed intent must not silently exclude anyone); a
    // disclosed goal that isn't in the viewer's list is filtered out.
    if (pref?.openToGoals?.length) {
      where.OR = [{ relationshipGoal: null }, { relationshipGoal: { in: pref.openToGoals } }];
    }
    // Shared-interest minimum: need N common interests with the viewer.
    // SELF-GUARD: a viewer with zero interests can share none with anyone —
    // the filter would permanently empty their own deck, so it skips itself.
    if ((pref?.sharedInterestMin ?? 0) > 0 && viewerInterestIds.size > 0) {
      where.interests = {
        some: { interestId: { in: Array.from(viewerInterestIds) } },
      };
    }

    const total = await prisma.user.count({ where });

    // ── The loop chain ──
    // Page space = fresh profiles first (orderBy createdAt desc), then the
    // passed profiles stitched after them, oldest pass first. A pagination
    // page may therefore mix fresh + recycled; the client only ever shows
    // the top card, which is exactly the queue front.
    const fresh = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: DECK_SELECT,
    });

    // Recycled: passed profiles only (fresh already excludes them — the two
    // lists are disjoint, so the chain can never duplicate a card).
    const recycledExclude = new Set<string>([userId, ...likedIds]);
    for (const b of blocks) {
      recycledExclude.add(b.blockerId);
      recycledExclude.add(b.blockedId);
    }
    const recycledWhere = { ...where, id: { notIn: Array.from(recycledExclude) } };
    const recycledAll = passedIds.length
      ? await prisma.user.findMany({
          where: recycledWhere,
          orderBy: { createdAt: 'desc' },
          select: DECK_SELECT,
        })
      : [];
    const recycled = passedIds
      .map((pid) => recycledAll.find((u) => u.id === pid))
      .filter(Boolean as any);

    const chain = [...fresh, ...recycled];

    // "LIKES YOU" priority (Hinge/Tinder Gold pattern, free for everyone):
    // people who already liked you surface at the FRONT of the chain, newest
    // like first — like back = instant match. They keep their fresh/recycled
    // badge state; the client adds a 'likes you' badge from the flag.
    const likedMeRows = await prisma.matchLike.findMany({
      where: { receiverId: userId, action: 'LIKE' },
      select: { senderId: true },
      orderBy: { createdAt: 'desc' },
    });
    const likedMeSet = new Set(likedMeRows.map((r) => r.senderId));
    const likedMeFront = chain.filter((u: any) => likedMeSet.has(u.id));
    const rest = chain.filter((u: any) => !likedMeSet.has(u.id));
    const ordered = [...likedMeFront, ...rest];

    const pageSlice = ordered.slice(page * take, page * take + take);
    const passedSet = new Set(passedIds);

    return {
      users: pageSlice.map((u: any) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        photos: u.photos.map((p: any) => ({ id: p.id, slot: p.slot })),
        bio: u.bio,
        course: u.course,
        year: u.year,
        age: ageFrom(u.dateOfBirth),
        college: u.college,
        interests: u.interests.map((ui: any) => ui.interest),
        isVerified: u.isVerified,
        relationshipGoal: u.relationshipGoal,
        theyLikedMe: likedMeSet.has(u.id),
        sharedInterests: (pref?.sharedInterestMin ?? 0) > 0
          ? u.interests.filter((ui: any) => viewerInterestIds.has(ui.interestId)).length
          : undefined,
        // true when this card came from the passed tail of the chain
        recycled: passedSet.has(u.id),
      })),
      page,
      // the chain is closed: "hasMore" wraps via the client resetting to page 0
      hasMore: (page + 1) * take < chain.length,
      totalRemaining: Math.max(chain.length - page * take, 0),
      totalFresh: fresh.length,
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

    // PHOTO GATE: swiping requires your own photo — same rule as the deck.
    if (await needsPhotoGate(senderId)) {
      const e: any = new Error('Add a profile photo before matching — real people only.');
      e.status = 403;
      e.code = 'PROFILE_PHOTO_REQUIRED';
      throw e;
    }

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

        // Realtime: let both users know instantly (badges, match modals)
        publish('match:new', { matchId: match.id, userIds: [senderId, receiverId] });
        publish('notification:new', { userIds: [senderId, receiverId] });

        return { matched: true, match };
      }

      // One-sided like → notify the receiver (Hinge-style: likes are free to
      // see). Deduped: only on the FIRST like, never on action updates.
      // Fire-and-forget after the swipe transaction so a notification hiccup
      // can never fail the like itself.
      if (!mutual) {
        prisma.notification.create({
          data: { recipientId: receiverId, actorId: senderId, type: 'LIKE' } as any,
        }).then(() => publish('notification:new', { userIds: [receiverId] })).catch(() => {});
      }

      // Same-action re-swipe that didn't (re)match: report it as a duplicate
      // so clients can show "already actioned" instead of counting it as new.
      return { matched: false, duplicate: existing?.action === action };
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
        userAObj: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarColor: true, avatarPhotoId: true, bio: true } },
        userBObj: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarColor: true, avatarPhotoId: true, bio: true } },
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

  /** How many waiting likes the viewer hasn't acted on — powers the deck chip. */
  async likesYouCount(userId: string) {
    const count = await prisma.matchLike.count({ where: { receiverId: userId, action: 'LIKE' } });
    return { likesYou: count };
  }

  /**
   * REWIND (Tinder's signature): undo the last PASS so a mis-swipe doesn't
   * lock the person away for the resurface window. Only the most recent
   * action is undoable, only PASS (a like that matched already created real
   * notifications), and only within 10 minutes (accident window).
   * The like cap is not refunded — rewinding doesn't erase that you acted.
   */
  async rewindLastPass(userId: string) {
    const last = await prisma.matchLike.findFirst({
      where: { senderId: userId, action: 'PASS' },
      orderBy: { createdAt: 'desc' },
      select: { receiverId: true, createdAt: true },
    });
    if (!last) {
      const e: any = new Error('Nothing to rewind'); e.status = 404; throw e;
    }
    if (Date.now() - last.createdAt.getTime() > 10 * 60 * 1000) {
      const e: any = new Error('The rewind window (10 minutes) has passed'); e.status = 410; throw e;
    }
    await prisma.matchLike.delete({
      where: { senderId_receiverId: { senderId: userId, receiverId: last.receiverId } },
    });
    return { rewound: true, userId: last.receiverId };
  }

  async updatePreference(userId: string, data: {
    lookingFor?: string;
    ageRangeMin?: number;
    ageRangeMax?: number;
    genderPreference?: string;
    openToGoals?: string[];
    onlyVerified?: boolean;
    minYear?: number | null;
    sharedInterestMin?: number;
    collegePreference?: string;
  }) {
    // Clamp inputs — server is the source of truth (floor 16 = app minimum age)
    const ageMin = data.ageRangeMin != null ? Math.min(Math.max(Math.round(data.ageRangeMin), 16), 99) : undefined;
    const ageMax = data.ageRangeMax != null ? Math.min(Math.max(Math.round(data.ageRangeMax), 16), 99) : undefined;
    const lookingFor = ['DATING', 'FRIENDS', 'BOTH'].includes(data.lookingFor || '') ? data.lookingFor : undefined;
    const genderPref = ['EVERYONE', 'MALE', 'FEMALE', 'OTHER'].includes(data.genderPreference || '') ? data.genderPreference : undefined;
    // PRODUCT RULE: college isolation is not a preference — ignore any client value.
    const collegePref: string | undefined = undefined;

    // Intent matching: keep only known goals, dedupe, cap the list.
    const VALID_GOALS = ['DATING', 'RELATIONSHIP', 'FRIENDS', 'CASUAL', 'NOT_SURE'];
    const openToGoals = Array.isArray(data.openToGoals)
      ? [...new Set(data.openToGoals.filter((g) => VALID_GOALS.includes(g)))].slice(0, VALID_GOALS.length)
      : undefined;
    // Dealbreakers
    const onlyVerified = typeof data.onlyVerified === 'boolean' ? data.onlyVerified : undefined;
    const minYear = data.minYear === null || data.minYear === undefined
      ? null
      : [1, 2, 3, 4, 5].includes(Number(data.minYear)) ? Number(data.minYear) : undefined;
    const sharedInterestMin = data.sharedInterestMin != null
      ? Math.min(Math.max(Math.round(Number(data.sharedInterestMin)), 0), 10)
      : undefined;

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
        openToGoals: openToGoals || [],
        ...(onlyVerified !== undefined && { onlyVerified }),
        ...(minYear !== undefined && { minYear }),
        ...(sharedInterestMin !== undefined && { sharedInterestMin }),
        collegePreference: collegePref, // always null — college scope is not optional
      },
      update: {
        ...(lookingFor && { lookingFor: lookingFor as any }),
        ...(finalMin !== undefined && { ageRangeMin: finalMin }),
        ...(finalMax !== undefined && { ageRangeMax: finalMax }),
        ...(genderPref && { genderPreference: genderPref as any }),
        ...(openToGoals !== undefined && { openToGoals }),
        ...(onlyVerified !== undefined && { onlyVerified }),
        ...(minYear !== undefined && { minYear }),
        ...(sharedInterestMin !== undefined && { sharedInterestMin }),
        // Force any legacy cross-college preference back to null
        collegePreference: null,
      },
    });
  }

  async getPreference(userId: string) {
    const pref = await prisma.matchPreference.findUnique({ where: { userId } });
    return pref || { lookingFor: 'DATING', ageRangeMin: null, ageRangeMax: null, genderPreference: 'EVERYONE', openToGoals: [], onlyVerified: false, minYear: null, sharedInterestMin: 0, collegePreference: null, visibility: true };
  }
}
