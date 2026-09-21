import { prisma } from '../config/prisma';
import { publish } from '../config/bus';
import { invalidateUnreadCount } from './notification.service';
import {
  get as cacheGet,
  set as cacheSet,
  fingerprint,
  deckTag,
  invalidateDeckForUser,
  DECK_TTL_SEC,
} from '../config/cache';

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
      relationshipGoals: true,
};

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

/**
 * The waiting-list sender filter, shared by likesYou() and likesYouCount():
 * same-college, active, unblocked in both directions, no ACTIVE match with the
 * viewer, and no answer from the viewer yet (no LIKE *or* PASS row back).
 * Enforced in the DB so the count and the list can never disagree.
 */
function waitingSenderFilter(userId: string, collegeId: string) {
  return {
    isActive: true,
    collegeId,
    // Viewer hasn't answered this sender either way.
    receivedLikes: { none: { senderId: userId } },
    // No ACTIVE match between viewer and sender.
    matchesA: { none: { userB: userId, status: 'ACTIVE' } },
    matchesB: { none: { userA: userId, status: 'ACTIVE' } },
    // No block wall either direction.
    blockedUsers: { none: { blockedId: userId } },
    blockedBy: { none: { blockerId: userId } },
  };
}

/**
 * The ONE source of truth for "Looking for" (intent matching): the user's own
 * profile goals (User.relationshipGoals). Discovery filters, the deck and the
 * match-criteria snapshot all read it — there is no separate hidden preference.
 */
export class MatchService {
  /**
   * The swipe deck: DB-paginated, one page at a time.
   * Chain order = fresh profiles first (newest first), then passed profiles
   * stitched after them (oldest pass first), with people who liked the viewer
   * boosted to the front of page 0. Every window is fetched with skip/take (or
   * a bounded id-list) — the full pool is NEVER loaded into memory.
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
    // PERF: photoCount, interests, actioned likes/passes, blocks and likedMe
    // are independent — ONE parallel wave instead of five sequential
    // round-trips (at ~30ms each that alone halves deck latency).
    const [viewerPhotoCount, viewerInterestRows, actioned, blocks, likedMeRows] = await Promise.all([
      prisma.userPhoto.count({ where: { userId } }),
      prisma.userInterest.findMany({ where: { userId }, select: { interestId: true } }),
      prisma.matchLike.findMany({
        where: { senderId: userId },
        select: { receiverId: true, action: true, createdAt: true },
      }),
      prisma.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
      prisma.matchLike.findMany({
        where: { receiverId: userId, action: 'LIKE' },
        select: { senderId: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (viewerPhotoCount === 0) {
      return photoGateResponse(page);
    }

    const pref = viewer.matchPreference;

    // Viewer's own interests power the shared-interest dealbreaker.
    const viewerInterestIds = new Set(viewerInterestRows.map((ui) => ui.interestId));

    // CACHE: the key fingerprints everything that changes this viewer's deck
    // (college, prefs, goals, interests, photo count) — filter edits, goal
    // edits and photo uploads change the KEY, so they need no invalidation.
    // Like/pass/rewind/unmatch/block change exclusion sets WITHOUT changing
    // the fingerprint, so those paths call invalidateDeckForUser() explicitly.
    const myGoalsFp = [...(viewer.relationshipGoals?.length ? viewer.relationshipGoals : (pref?.openToGoals ?? []))].sort();
    const fp = fingerprint([
      viewer.collegeId,
      pref?.ageRangeMin ?? 16,
      pref?.ageRangeMax ?? 60,
      pref?.genderPreference || 'EVERYONE',
      pref?.minYear,
      pref?.sharedInterestMin ?? 0,
      myGoalsFp.join(','),
      [...viewerInterestIds].sort().join(','),
      viewerPhotoCount,
    ]);
    const deckKey = `deck:v1:${userId}:${fp}:${page}:${take}`;
    const cached = cacheGet(deckKey);
    if (cached) return cached;

    // LIKEd ids leave the deck permanently (pending the other person's answer);
    // passes only shape ORDER (they re-enter at the back), never visibility.
    const likedIds = actioned.filter((a) => a.action === 'LIKE').map((a) => a.receiverId);
    // oldest pass first — the back of the loop chain
    const passedIds = actioned
      .filter((a) => a.action === 'PASS')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((a) => a.receiverId);

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
    // Minimum year (seniors-only etc.). Users with no year set can't prove it — excluded.
    if (pref?.minYear != null) {
      where.year = { gte: pref.minYear };
    }
    // ── SYNC RULE: "Looking for" lives ON THE PROFILE (User.relationshipGoals).
    // The deck filter reads it directly — editing it in the profile or via the
    // matches preferences endpoint edits the same field. Users who never set a
    // goal always remain visible (undisclosed intent must not silently
    // exclude anyone).
    const myGoals = viewer.relationshipGoals?.length ? viewer.relationshipGoals : (pref?.openToGoals ?? []);
    if (myGoals.length) {
      // OR scope = (their goals overlap mine) OR (they listed no goal at all).
      // NOTE: Prisma's top-level `where.OR` REPLACES sibling-AND semantics —
      // the hasSome condition must live INSIDE this OR, not beside it.
      where.OR = [
        { relationshipGoals: { hasSome: myGoals } },
        { relationshipGoals: { isEmpty: true } },
      ];
    }
    // Shared-interest minimum: need N common interests with the viewer.
    // SELF-GUARD: a viewer with zero interests can share none with anyone —
    // the filter would permanently empty their own deck, so it skips itself.
    if ((pref?.sharedInterestMin ?? 0) > 0 && viewerInterestIds.size > 0) {
      where.interests = {
        some: { interestId: { in: Array.from(viewerInterestIds) } },
      };
    }

    // ── The loop chain, DB-paginated ──
    // Chain positions [0, freshCount) are fresh profiles (createdAt desc);
    // positions [freshCount, freshCount + recycledCount) are passed profiles
    // (oldest pass first). The requested window [offset, offset + take) is
    // fetched with skip/take and bounded id-lists — never the whole pool.
    // A page may mix fresh + recycled; the client only ever shows the top
    // card, which is exactly the queue front.
    const offset = page * take;
    const recycledExclude = new Set<string>([userId, ...likedIds]);
    for (const b of blocks) {
      recycledExclude.add(b.blockerId);
      recycledExclude.add(b.blockedId);
    }
    const recycledBaseWhere = { ...where, id: { notIn: Array.from(recycledExclude) } };

    // Counts are cheap indexed queries powering hasMore/totalRemaining.
    const [freshCount, recycledCount] = await Promise.all([
      prisma.user.count({ where }),
      passedIds.length
        ? prisma.user.count({ where: { ...recycledBaseWhere, id: { in: passedIds } } })
        : Promise.resolve(0),
    ]);
    const chainLength = freshCount + recycledCount;

    // One chain window [off, off + take): fresh slice + recycled slice stitched.
    const fetchWindow = async (off: number): Promise<any[]> => {
      // Fresh window: overlaps [off, off + take) with [0, freshCount).
      const freshSkip = Math.min(off, freshCount);
      const freshTake = Math.max(Math.min(off + take, freshCount) - freshSkip, 0);
      // Recycled window: overlaps [off, off + take) with [freshCount, chainLength).
      const recStart = Math.max(off - freshCount, 0);
      const recEnd = Math.max(Math.min(off + take - freshCount, recycledCount), 0);
      const recSliceIds = recEnd > recStart ? passedIds.slice(recStart, recEnd) : [];

      const [freshPage, recycledRows] = await Promise.all([
        freshTake > 0
          ? prisma.user.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              skip: freshSkip,
              take: freshTake,
              select: DECK_SELECT,
            })
          : Promise.resolve([] as never[]),
        recSliceIds.length
          ? prisma.user.findMany({
              where: { ...recycledBaseWhere, id: { in: recSliceIds } },
              select: DECK_SELECT,
            })
          : Promise.resolve([] as never[]),
      ]);
      // Restore oldest-pass-first order and drop ids filtered out since passing
      // (deactivated, blocked, photo removed, prefs changed).
      const recycledById = new Map((recycledRows as any[]).map((u) => [u.id, u]));
      const recycledPage = recSliceIds
        .map((pid) => recycledById.get(pid))
        .filter(Boolean as any);
      return [...(freshPage as any[]), ...recycledPage];
    };

    // Shared-interest minimum N>1: the DB `some` prefilter above only proves
    // ≥1 common interest (Prisma can't express "any N of a set" in one query),
    // so enforce the exact threshold here. Default users (filter off) take the
    // single-window fast path — zero behavior change for them. Strict-filter
    // users skip forward across consecutive windows (bounded: ≤6 windows) until
    // the page is full of genuinely-eligible profiles or the chain ends.
    // (totalRemaining/hasMore stay chain-based estimates under a strict filter;
    // WHO you see is always exact, which is what relevance requires.)
    const minShared = pref?.sharedInterestMin ?? 0;
    const needCountFilter = minShared > 1 && viewerInterestIds.size > 0;
    const countShared = (u: any) =>
      u.interests.filter((ui: any) => viewerInterestIds.has(ui.interestId)).length;

    let pageSlice: any[] = [];
    let consumed = offset + take;
    if (!needCountFilter) {
      pageSlice = await fetchWindow(offset);
    } else {
      let guard = 0;
      let off = offset;
      while (pageSlice.length < take && off < chainLength && guard < 6) {
        const win = await fetchWindow(off);
        for (const u of win) {
          if (pageSlice.length >= take) break;
          if (countShared(u) >= minShared) pageSlice.push(u);
        }
        off += take;
        guard++;
        if (win.length === 0) break;
      }
      consumed = off;
    }

    // "LIKES YOU" priority (Hinge/Tinder Gold pattern, free for everyone):
    // people who already liked you surface at the FRONT of page 0, newest
    // like first — like back = instant match. They keep their fresh/recycled
    // badge state; the client adds a 'likes you' badge from the flag.
    // (likedMeRows was fetched in the first parallel wave; this boost query
    // is bounded to `take` ids so it stays O(page), not O(pool).)
    const likedMeSet = new Set(likedMeRows.map((r) => r.senderId));
    if (page === 0 && likedMeSet.size > 0 && chainLength > 0) {
      const boostIds = likedMeRows.map((r) => r.senderId).slice(0, take);
      const boosted = await prisma.user.findMany({
        where: {
          ...recycledBaseWhere,
          id: { in: boostIds },
        },
        select: DECK_SELECT,
      });
      if (boosted.length) {
        const boostedById = new Map((boosted as any[]).map((u) => [u.id, u]));
        // Newest like first (likedMeRows arrived ordered by createdAt desc).
        // Under a strict shared-interest filter the boost respects it too —
        // admirers below the viewer's own threshold stay in the waiting list,
        // never jump the deck queue.
        const orderedBoost = boostIds
          .map((id) => boostedById.get(id))
          .filter(Boolean as any)
          .filter((u: any) => !needCountFilter || countShared(u) >= minShared);
        const boostedIds = new Set(orderedBoost.map((u: any) => u.id));
        pageSlice = [...orderedBoost, ...pageSlice.filter((u: any) => !boostedIds.has(u.id))].slice(
          0,
          take,
        );
      }
    } else {
      // Deeper pages keep chain order; the badge still flags who liked you.
      const likedFront = pageSlice.filter((u: any) => likedMeSet.has(u.id));
      const rest = pageSlice.filter((u: any) => !likedMeSet.has(u.id));
      pageSlice = [...likedFront, ...rest];
    }

    const passedSet = new Set(passedIds);

    const result = {
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
        // PRIVACY: goals are intent data, not display data — other people's
        // selections never leave the server. The common basis is revealed
        // AFTER a mutual match, via match.criteria.
        relationshipGoals: undefined,
        theyLikedMe: likedMeSet.has(u.id),
        // Always sent when the viewer has interests to compare against —
        // powers the "N shared interests" relevance chip on every card, not
        // just when the shared-interest dealbreaker is switched on.
        sharedInterests: viewerInterestIds.size > 0
          ? u.interests.filter((ui: any) => viewerInterestIds.has(ui.interestId)).length
          : undefined,
        // true when this card came from the passed tail of the chain
        recycled: passedSet.has(u.id),
      })),
      page,
      // the chain is closed: "hasMore" wraps via the client resetting to page 0
      hasMore: consumed < chainLength,
      totalRemaining: Math.max(chainLength - Math.min(consumed - take, chainLength), 0),
      totalFresh: freshCount,
    };
    cacheSet(deckKey, result, DECK_TTL_SEC, [deckTag(userId)]);
    return result;
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
    if (blocked) {
      const e: any = new Error('Cannot interact with this user');
      e.status = 403;
      e.code = 'BLOCKED';
      throw e;
    }

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

        // Snapshot the STRICTLY-common criteria at match time: a criterion is
        // included only if BOTH users have it identically (same goal, same
        // interest). Anything not shared by both is excluded — the notification
        // only ever says what genuinely brought these two together.
        const [uMe, uThem] = await Promise.all([
          tx.user.findUnique({
            where: { id: senderId },
            select: { relationshipGoals: true, interests: { select: { interestId: true, interest: { select: { id: true, name: true } } } } },
          }),
          tx.user.findUnique({
            where: { id: receiverId },
            select: { relationshipGoals: true, interests: { select: { interestId: true, interest: { select: { id: true, name: true } } } } },
          }),
        ]);
        // Multi-select: the match chip lists the INTERSECTION of both users'
        // goal selections ("you both listed Dating") — order follows the
        // sender's own preference order.
        const commonGoals = (uMe?.relationshipGoals ?? []).filter((g) => uThem?.relationshipGoals?.includes(g));
        const myInterests = new Map((uMe?.interests ?? []).map((ui) => [ui.interestId, ui.interest]));
        const commonInterests = (uThem?.interests ?? [])
          .filter((ui) => myInterests.has(ui.interestId))
          .map((ui) => ({ id: ui.interestId, name: ui.interest.name }));
        const criteria = { goals: commonGoals, interests: commonInterests };

        const match = await tx.match.upsert({
          where: { userA_userB: { userA, userB } },
          // Re-matching refreshes the snapshot — goals/interests may have changed
          // since the previous match.
          create: { userA, userB, type: 'DATING', criteria },
          update: { status: 'ACTIVE', endedAt: null, endedBy: null, criteria },
        });

        // No skipDuplicates on SQLite — but the idempotency guard above means this
        // only ever runs once per mutual pair.
        await tx.notification.createMany({
          data: [
            { recipientId: senderId, actorId: receiverId, type: 'MATCH', matchId: match.id, metadata: criteria },
            { recipientId: receiverId, actorId: senderId, type: 'MATCH', matchId: match.id, metadata: criteria },
          ] as any,
        });

        // Realtime: let both users know instantly (badges, match modals)
        invalidateUnreadCount(senderId, receiverId);
        publish('match:new', { matchId: match.id, userIds: [senderId, receiverId] });
        publish('notification:new', { userIds: [senderId, receiverId] });

        // RESPONSE SCOPE: only the two people IN the match ever receive the
        // criteria (this response goes to the acting sender alone; the partner
        // gets theirs via the recipient-scoped MATCH notification). Trimmed to
        // the shape the client needs — no raw Prisma row.
        return { matched: true, matchId: match.id, criteria };
      }

      // One-sided like → notify the receiver (Hinge-style: likes are free to
      // see). Deduped: only on the FIRST like, never on action updates.
      // Fire-and-forget after the swipe transaction so a notification hiccup
      // can never fail the like itself.
      if (!mutual) {
        prisma.notification.create({
          data: { recipientId: receiverId, actorId: senderId, type: 'LIKE' } as any,
        })
          .then(() => {
            invalidateUnreadCount(receiverId);
            publish('notification:new', { userIds: [receiverId] });
          })
          .catch(() => {});
      }

      // Same-action re-swipe that didn't (re)match: report it as a duplicate
      // so clients can show "already actioned" instead of counting it as new.
      return { matched: false, duplicate: existing?.action === action };
    });

    // CACHE: the exclusion set changed (new like/pass) without changing the
    // fingerprint — bust the actor's deck. On LIKE also bust the receiver's:
    // their deck gains a likes-you boost/badge for the sender.
    invalidateDeckForUser(senderId);
    if (action === 'LIKE') invalidateDeckForUser(receiverId);
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
    // Both users can swipe each other again — bust both decks.
    invalidateDeckForUser(match.userA);
    invalidateDeckForUser(match.userB);
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

  /** How many waiting likes the viewer hasn't acted on — powers the deck chip.
   * WAITING means exactly what likesYou() lists: one-sided LIKEs from
   * same-college, active, unblocked people with no ACTIVE match and no answer
   * from the viewer yet. (Counting raw inbound LIKE rows overcounted the chip
   * the moment anyone matched, answered, or got blocked.)
   * Single indexed COUNT — one round-trip, no row fetching. */
  async likesYouCount(userId: string) {
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!viewer?.collegeId) return { likesYou: 0 };
    const likesYou = await prisma.matchLike.count({
      where: { receiverId: userId, action: 'LIKE', sender: waitingSenderFilter(userId, viewer.collegeId) },
    });
    return { likesYou };
  }

  /**
   * WHO LIKES YOU (Hinge/Tinder-Gold pattern, free): the people whose LIKE is
   * still waiting for an answer — newest first. Same-college, active, unblocked
   * only; people already in an ACTIVE match live in the matches list instead.
   * Powers the "N waiting" grid; liking back from here is an instant match.
   */
  async likesYou(userId: string, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 50);
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!viewer?.collegeId) return { users: [] };

    // Waiting-list rules enforced in the DB (one indexed query, exact page —
    // no over-fetch + in-JS filtering). Same filter as likesYouCount().
    const rows = await prisma.matchLike.findMany({
      where: { receiverId: userId, action: 'LIKE', sender: waitingSenderFilter(userId, viewer.collegeId) },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        sender: {
          select: {
            ...DECK_SELECT,
            collegeId: true,
            isActive: true,
          },
        },
      },
    });

    const users = [];
    for (const r of rows) {
      const s: any = r.sender;
      if (!s?.isActive || s.collegeId !== viewer.collegeId) continue; // belt-and-braces
      users.push({
        id: s.id,
        username: s.username,
        displayName: s.displayName,
        avatarUrl: s.avatarUrl,
        photos: s.photos.map((p: any) => ({ id: p.id, slot: p.slot })),
        bio: s.bio,
        course: s.course,
        year: s.year,
        age: ageFrom(s.dateOfBirth),
        college: s.college,
        interests: s.interests.map((ui: any) => ui.interest),
        isVerified: s.isVerified,
        // PRIVACY: same rule as the deck — their goals stay on the server.
        relationshipGoals: undefined,
        likedAt: r.createdAt,
      });
    }
    return { users };
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
    // The rewound profile re-enters the chain — the cached deck no longer matches.
    invalidateDeckForUser(userId);
    return { rewound: true, userId: last.receiverId };
  }

  async updatePreference(userId: string, data: {
    lookingFor?: string;
    ageRangeMin?: number;
    ageRangeMax?: number;
    genderPreference?: string;
    openToGoals?: string[];
    minYear?: number | null;
    sharedInterestMin?: number;
    collegePreference?: string;
  }) {
    // SYNC RULE: openToGoals IS the profile's "Looking for" (multi-select).
    // Writing it here updates User.relationshipGoals, so the profile edit and
    // the discovery filter can never drift apart. (Profile edits flow through
    // auth.service.updateProfile → the same column.)
    // Clamp inputs — server is the source of truth (floor 16 = app minimum age)
    const ageMin = data.ageRangeMin != null ? Math.min(Math.max(Math.round(data.ageRangeMin), 16), 99) : undefined;
    const ageMax = data.ageRangeMax != null ? Math.min(Math.max(Math.round(data.ageRangeMax), 16), 99) : undefined;
    const lookingFor = ['DATING', 'HOOKUP', 'BOTH'].includes(data.lookingFor || '') ? data.lookingFor : undefined;
    const genderPref = ['EVERYONE', 'MALE', 'FEMALE', 'OTHER'].includes(data.genderPreference || '') ? data.genderPreference : undefined;
    // PRODUCT RULE: college isolation is not a preference — ignore any client value.
    const collegePref: string | undefined = undefined;

    // Intent matching: keep only known goals, dedupe, cap the list.
    const VALID_GOALS = ['DATING', 'RELATIONSHIP', 'HOOKUP', 'CASUAL', 'NOT_SURE'];
    const openToGoals = Array.isArray(data.openToGoals)
      ? [...new Set(data.openToGoals.filter((g) => VALID_GOALS.includes(g)))].slice(0, VALID_GOALS.length)
      : undefined;
    if (openToGoals !== undefined) {
      await prisma.user.update({ where: { id: userId }, data: { relationshipGoals: openToGoals } });
    }
    // Dealbreakers
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
        ...(minYear !== undefined && { minYear }),
        ...(sharedInterestMin !== undefined && { sharedInterestMin }),
        // Force any legacy cross-college preference back to null
        collegePreference: null,
      },
    });
  }

  async getPreference(userId: string) {
    // SYNC RULE: openToGoals is read from the profile (single source of truth).
    const [pref, user] = await Promise.all([
      prisma.matchPreference.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { relationshipGoals: true } }),
    ]);
    const goals = user?.relationshipGoals ?? [];
    return {
      lookingFor: pref?.lookingFor ?? 'DATING',
      ageRangeMin: pref?.ageRangeMin ?? null,
      ageRangeMax: pref?.ageRangeMax ?? null,
      genderPreference: pref?.genderPreference ?? 'EVERYONE',
      openToGoals: goals,
      minYear: pref?.minYear ?? null,
      sharedInterestMin: pref?.sharedInterestMin ?? 0,
      collegePreference: pref?.collegePreference ?? null,
      visibility: pref?.visibility ?? true,
    };
  }
}
