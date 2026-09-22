/* ═══════════════════════════════════════════════════════════════
   MATCHING WORST-CASE TEST SUITE — hits the real API + real DB.
   Run: cd server && npx tsx scripts/test-matching.ts [baseURL]
   Creates throwaway users (zt_a, zt_b, zt_c in IPEC), runs every
   adversarial scenario, prints PASS/FAIL per case, cleans up.
   Non-zero exit code if anything fails.
   ═══════════════════════════════════════════════════════════════ */
import bcrypt from 'bcryptjs';
// Normalized client (config/prisma.ts): pool from DATABASE_CONNECTION_LIMIT.
// A raw `new PrismaClient()` defaults to CPUs*2+1 and can single-handedly
// saturate a small pooler mid-suite (measured failure mode).
import { prisma } from '../src/config/prisma';

const BASE = process.argv[2] || 'http://localhost:5000';
const PASSWORD_HASH = bcrypt.hashSync('password123', 10);

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${detail}`); }
}

async function api(token: string, method: string, path: string, body?: any) {
  const send = () => fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let res: Response;
  try {
    res = await send();
  } catch (e: any) {
    // TRANSPORT-ONLY retries: fetch failed / ECONNRESET are node-side blips
    // (dev-server restart, OS socket churn), not server answers. Retrying a
    // network error can never double-apply a write the way retrying a 500
    // could. A bare await here once swallowed this and mislabeled two
    // unrelated checks as product failures.
    const transient = e?.cause?.code === 'ECONNRESET' || e?.cause?.code === 'ECONNREFUSED' || e?.message === 'fetch failed';
    if (!transient) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    res = await send();
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

async function loginAs(email: string) {
  const r = await api('', 'POST', '/auth/login', { email, password: 'password123' });
  return r.data.accessToken as string;
}

/** Child-first teardown so re-runs never trip FK constraints (idempotent). */
async function purgeUsers(userIds: string[]) {
  if (!userIds.length) return;
  const memRows = await prisma.conversationMember.findMany({ where: { userId: { in: userIds } }, select: { conversationId: true } });
  const convIds = [...new Set(memRows.map((m) => m.conversationId))];
  if (convIds.length) {
    await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversationMember.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  }
  await prisma.notification.deleteMany({ where: { OR: [{ recipientId: { in: userIds } }, { actorId: { in: userIds } }] } });
  await prisma.match.deleteMany({ where: { OR: [{ userA: { in: userIds } }, { userB: { in: userIds } }] } });
  await prisma.matchLike.deleteMany({ where: { OR: [{ senderId: { in: userIds } }, { receiverId: { in: userIds } }] } });
  await prisma.matchPreference.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userInterest.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  console.log('\n━━ Setting up throwaway users ━━');
  const college = await prisma.college.findFirst({ where: { shortName: 'IPEC' } });
  if (!college) throw new Error('IPEC not found');
  const otherCollege = await prisma.college.findFirst({ where: { NOT: { id: college.id } } });

  const mk = async (username: string, gender: string, withPhoto: boolean) => {
    const old = await prisma.user.findMany({ where: { email: `${username}@test.zoclo` }, select: { id: true } });
    if (old.length) await purgeUsers(old.map((u) => u.id));
    const u = await prisma.user.create({
      data: {
        email: `${username}@test.zoclo`, username, displayName: username.toUpperCase(),
        passwordHash: PASSWORD_HASH,
        collegeId: college.id, gender, dateOfBirth: new Date('2004-01-15'),
        year: 2,
        isVerified: true, verificationStatus: 'VERIFIED',
        relationshipGoals: ['DATING'],
        photos: withPhoto ? { create: { data: Buffer.from('x'), mimeType: 'image/png', slot: 0 } } : undefined,
      },
    });
    return u;
  };

  const A = await mk('zt_a', 'MALE', true);    // swiper
  const B = await mk('zt_b', 'FEMALE', true);  // likee
  const C = await mk('zt_c', 'FEMALE', false); // photo-gate test user
  const tokA = await loginAs(A.email);
  const tokB = await loginAs(B.email);
  const tokC = await loginAs(C.email);
  console.log(`  A=${A.username} B=${B.username} C=${C.username} (no photo)\n`);

  // ── 1. Idempotency ──
  console.log('━━ 1. Idempotency ━━');
  let r = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  check('first like → matched:false', r.status === 200 && r.data.matched === false, JSON.stringify(r.data));
  r = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  check('re-like is flagged as duplicate', r.status === 200 && r.data.matched === false && r.data.duplicate === true);
  const likeNotifs = await prisma.notification.count({ where: { type: 'LIKE', recipientId: B.id, actorId: A.id } });
  check('re-tap does not re-notify (exactly 1 LIKE notif)', likeNotifs === 1, `got ${likeNotifs}`);
  const likeCount = await prisma.matchLike.count({ where: { senderId: A.id, receiverId: B.id } });
  check('exactly ONE like row exists', likeCount === 1);

  // ── 2. Mutual like → match, exactly once ──
  console.log('━━ 2. Mutual match ━━');
  r = await api(tokB, 'POST', '/matches/like', { receiverId: A.id });
  // Detail matters here: this assertion used to fail with a bare ❌, so a
  // transient pooler blip (500) was indistinguishable from a broken match.
  check('B likes back → matched:true', r.status === 200 && r.data.matched === true, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  const matchCount = await prisma.match.count({ where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] } });
  check('exactly ONE match row', matchCount === 1, `got ${matchCount}`);
  r = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  check('like after match is a quiet no-op', r.status === 200 && r.data.matched === false, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  const notifs = await prisma.notification.count({ where: { type: 'MATCH', OR: [{ recipientId: A.id }, { recipientId: B.id }] } });
  check('both got MATCH notifications', notifs === 2, `got ${notifs}`);

  // ── 2b. Match-criteria snapshot (strictly-common only) ──
  console.log('━━ 2b. Match criteria ━━');
  // A & B both have goal DATING and no interests → snapshot must be exactly that
  const matchRow = await prisma.match.findFirst({ where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] } });
  const crit: any = matchRow?.criteria;
  check('criteria stored: common goal DATING only', Array.isArray(crit?.goals) && crit.goals.length === 1 && crit.goals[0] === 'DATING', JSON.stringify(crit));
  check('criteria stored: no fabricated shared interests', Array.isArray(crit?.interests) && crit.interests.length === 0);
  r = await api(tokA, 'GET', '/notifications');
  const mNotif = (r.data.notifications || []).find((n: any) => n.type === 'MATCH');
  check('MATCH notification carries criteria metadata', !!mNotif && mNotif.metadata?.goals?.[0] === 'DATING' && Array.isArray(mNotif.metadata?.interests), JSON.stringify(mNotif?.metadata));

  // ── 2c. Divergence: only the strictly-common survives ──
  console.log('━━ 2c. Criteria divergence ━━');
  const skate = await prisma.interest.upsert({ where: { name: 'skateboarding' }, update: {}, create: { name: 'skateboarding' } });
  const chess = await prisma.interest.upsert({ where: { name: 'chess' }, update: {}, create: { name: 'chess' } });
  const anime = await prisma.interest.upsert({ where: { name: 'anime' }, update: {}, create: { name: 'anime' } });
  await prisma.userInterest.createMany({ data: [
    { userId: A.id, interestId: skate.id }, { userId: A.id, interestId: chess.id },
    { userId: B.id, interestId: skate.id }, { userId: B.id, interestId: anime.id },
  ] });
  await prisma.user.update({ where: { id: B.id }, data: { relationshipGoals: ['CASUAL'] } });
  // Unmatch → re-mutual → snapshot must refresh
  const m0 = await prisma.match.findFirst({ where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] } });
  await api(tokA, 'DELETE', `/matches/${m0!.id}`);
  const l1 = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  const l2 = l1.data.matched ? null : await api(tokB, 'POST', '/matches/like', { receiverId: A.id });
  const rematch = l1.data.matched ? l1 : l2;
  check('re-mutual → re-match', !!rematch && rematch.data.matched === true);
  check('diverged goals excluded from criteria', rematch.data.criteria?.goals?.length === 0, JSON.stringify(rematch.data.criteria));
  check('only the shared interest appears', rematch.data.criteria?.interests?.length === 1 && rematch.data.criteria.interests[0].name === 'skateboarding', JSON.stringify(rematch.data.criteria?.interests));
  await prisma.user.update({ where: { id: B.id }, data: { relationshipGoals: ['DATING'] } });

  // ── 2d. Mutual-match transaction budget (regression guard) ──
  // The match happens inside ONE interactive transaction doing ~6 sequential
  // statements. Against a ~0.45s-per-round-trip DB, Prisma's DEFAULT 5s budget
  // is reachable, and blowing it is silent and total: the transaction rolls
  // back (the LIKE row is never written), the error is swallowed into
  // `500 Something went wrong`, and tapping LIKE on someone who already liked
  // you simply does nothing. That is the flagship flow.
  //
  // This loop exercises unmatch → re-like → re-match repeatedly, so the path is
  // hit many times while the pooler is warm-but-busy rather than measured once.
  console.log('━━ 2d. Match transaction budget ━━');
  let loops = 0;
  let loopFailures = 0;
  for (let i = 0; i < 3; i++) {
    const current = await prisma.match.findFirst({
      where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] },
      select: { id: true, status: true },
    });
    if (!current || current.status !== 'ACTIVE') break;
    await api(tokA, 'DELETE', `/matches/${current.id}`);
    // Both directions must be able to open the match, in either order.
    const first = await api(i % 2 === 0 ? tokA : tokB, 'POST', '/matches/like', { receiverId: i % 2 === 0 ? B.id : A.id });
    const second = first.data?.matched
      ? first
      : await api(i % 2 === 0 ? tokB : tokA, 'POST', '/matches/like', { receiverId: i % 2 === 0 ? A.id : B.id });
    loops++;
    if (second.status !== 200 || second.data?.matched !== true) {
      loopFailures++;
      console.log(`     ↳ cycle ${i + 1}: HTTP ${second.status} ${JSON.stringify(second.data)}`);
    }
  }
  check('3 unmatch → re-match cycles all matched', loops >= 2 && loopFailures === 0, `${loops} cycles, ${loopFailures} failed`);

  // ── 3. Concurrent double-like race (two simultaneous B-likes from A) ──
  console.log('━━ 3. Race: simultaneous likes ━━');
  const [r1, r2] = await Promise.all([
    api(tokA, 'POST', '/matches/pass', { receiverId: C.id }),
    api(tokA, 'POST', '/matches/pass', { receiverId: C.id }),
  ]);
  const passRows = await prisma.matchLike.count({ where: { senderId: A.id, receiverId: C.id, action: 'PASS' } });
  check('double-pass race → still 1 row', r1.status === 200 && r2.status === 200 && passRows === 1);

  // ── 4. Unmatch → re-like → re-match ──
  console.log('━━ 4. Unmatch / re-like cycle ━━');
  const match = await prisma.match.findFirst({ where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] } });
  r = await api(tokA, 'DELETE', `/matches/${match!.id}`);
  check('unmatch works', r.status === 200 && r.data.unmatched === true);
  r = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  check('re-like after unmatch accepted', r.status === 200 && r.data.matched === false);
  r = await api(tokB, 'POST', '/matches/like', { receiverId: A.id });
  check('re-mutual → re-match', r.status === 200 && r.data.matched === true);

  // ── 5. Guards: self, cross-college, blocked, missing user ──
  console.log('━━ 5. Guards ━━');
  r = await api(tokA, 'POST', '/matches/like', { receiverId: A.id });
  check("can't like yourself", r.status >= 400);
  // Idempotent: a crashed earlier run may have left zt_x behind.
  const staleX = await prisma.user.findMany({ where: { email: 'zt_x@test.zoclo' }, select: { id: true } });
  if (staleX.length) await purgeUsers(staleX.map((u) => u.id));
  const outsider = await prisma.user.create({
    data: {
      email: 'zt_x@test.zoclo', username: 'zt_x', displayName: 'X', passwordHash: PASSWORD_HASH,
      collegeId: otherCollege!.id, gender: 'FEMALE', dateOfBirth: new Date('2004-01-15'),
      isVerified: true, verificationStatus: 'VERIFIED',
      photos: { create: { data: Buffer.from('x'), mimeType: 'image/png', slot: 0 } },
    },
  });
  r = await api(tokA, 'POST', '/matches/like', { receiverId: outsider.id });
  check("cross-college like rejected", r.status >= 400);
  r = await api(tokA, 'POST', '/matches/like', { receiverId: 'nonexistent00000000000' });
  check('bogus receiverId rejected', r.status >= 400);
  await prisma.block.create({ data: { blockerId: B.id, blockedId: A.id } });
  r = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  check('blocked user cannot like blocker', r.status >= 400);
  r = await api(tokA, 'GET', '/matches/discover');
  const blockedVisible = (r.data.users || []).some((u: any) => u.id === B.id);
  check('blocker hidden from blocker’s deck (bidirectional)', !blockedVisible);
  await prisma.block.deleteMany({ where: { blockerId: B.id, blockedId: A.id } });

  // Block wall in the matches list (match stays ACTIVE underneath).
  await prisma.block.create({ data: { blockerId: B.id, blockedId: A.id } });
  r = await api(tokA, 'GET', '/matches?limit=50');
  check('blocked ex hidden from matches list', r.status === 200 && !(r.data.matches || []).some((m: any) => m.partner.id === B.id));
  await prisma.block.deleteMany({ where: { blockerId: B.id, blockedId: A.id } });
  r = await api(tokA, 'GET', '/matches?limit=50');
  check('unblocked ex returns to matches list', r.status === 200 && (r.data.matches || []).some((m: any) => m.partner.id === B.id));

  // Block wall in the CHAT list too — A↔B have a conversation (matched
  // earlier). While blocked, the thread must vanish from /conversations;
  // unblock must restore it (history preserved underneath).
  r = await api(tokA, 'POST', '/messages/conversation', { userId: B.id });
  check('conversation opens between matched pair', r.status === 200 || r.status === 201);
  const convId = r.data?.id as string | undefined;
  const convosOf = (resp: any): any[] => (Array.isArray(resp.data) ? resp.data : resp.data.conversations || []);
  await prisma.block.create({ data: { blockerId: B.id, blockedId: A.id } });
  r = await api(tokA, 'GET', '/messages/conversations');
  check('blocked ex conversation hidden from chat list', r.status === 200 && !convosOf(r).some((c: any) => c.otherUser?.id === B.id));
  await prisma.block.deleteMany({ where: { blockerId: B.id, blockedId: A.id } });
  r = await api(tokA, 'GET', '/messages/conversations');
  check('unblocked ex conversation returns to chat list', r.status === 200 && convosOf(r).some((c: any) => c.otherUser?.id === B.id));

  // ── 5c. DM notification lifecycle ──
  // The bell badge used to grow forever: nothing ever cleared NEW_MESSAGE
  // pings. Reading the thread must clear them; unmatch must silence sends.
  if (convId) {
    const unreadPings = () => prisma.notification.count({ where: { recipientId: B.id, actorId: A.id, type: 'NEW_MESSAGE', isRead: false } });
    r = await api(tokA, 'POST', `/messages/${convId}`, { content: 'ping' });
    check('DM sends between matched pair', r.status === 200 || r.status === 201, `status=${r.status} body=${JSON.stringify(r.data)}`);
    check('send pings recipient (exactly 1 unread NEW_MESSAGE)', await unreadPings() === 1);
    const matchNotifsBefore = await prisma.notification.count({ where: { recipientId: B.id, type: 'MATCH', isRead: false } });
    r = await api(tokB, 'GET', `/messages/${convId}`);
    check('reading the thread works', r.status === 200);
    check('reading clears DM pings', await unreadPings() === 0);
    check('reading does NOT touch other notification types', await prisma.notification.count({ where: { recipientId: B.id, type: 'MATCH', isRead: false } }) === matchNotifsBefore);
    r = await api(tokB, 'GET', '/notifications/unread-count');
    check('unread-count endpoint answers with a number', r.status === 200 && typeof r.data.count === 'number');

    // Unmatch via the real API — sending must die, reading must survive.
    const matchRow = await prisma.match.findFirst({ where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }], status: 'ACTIVE' } });
    if (matchRow) {
      r = await api(tokA, 'DELETE', `/matches/${matchRow.id}`);
      check('unmatch works (pre-DM-silence setup)', r.status === 200 && r.data.unmatched === true);
      r = await api(tokA, 'POST', `/messages/${convId}`, { content: 'still here?' });
      check('unmatched ex CANNOT send new DMs', r.status === 403);
      check('rejection is MATCH_REQUIRED, not a crash', r.data.code === 'MATCH_REQUIRED' || r.data.error?.includes('Match'));
      r = await api(tokB, 'GET', `/messages/${convId}`);
      check('unmatched ex can still READ history', r.status === 200);
      // Re-match through the real flow — sending must come back.
      await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
      r = await api(tokB, 'POST', '/matches/like', { receiverId: A.id });
      check('re-match restores sending', r.status === 200 && r.data.matched === true);
      r = await api(tokA, 'POST', `/messages/${convId}`, { content: "we're back" });
      check('DMs flow again after re-match', r.status === 200 || r.status === 201, `status=${r.status} body=${JSON.stringify(r.data)}`);
    }
  }

  // ── 6. Photo gate ──
  console.log('━━ 6. Photo gate ━━');
  r = await api(tokC, 'POST', '/matches/like', { receiverId: A.id });
  check('no-photo like → 403 PHOTO_REQUIRED', r.status === 403 && r.data.error?.includes('photo'));
  r = await api(tokC, 'GET', '/matches/discover');
  check('no-photo deck gated', r.data.gated === true && r.data.code === 'PROFILE_PHOTO_REQUIRED');

  // ── 7. Deck + likes-you priority ──
  console.log('━━ 7. Deck sync & likes-you ━━');
  // Fresh C gets a photo; A already passed C → she must re-enter A's chain
  // as recycled (the loop belongs to the passer's deck).
  await prisma.userPhoto.create({ data: { userId: C.id, data: Buffer.from('x'), mimeType: 'image/png', slot: 0 } });
  r = await api(tokA, 'GET', '/matches/discover?page=0&limit=50');
  const deckA = r.data.users || [];
  const cCard = deckA.find((u: any) => u.id === C.id);
  check('passed user re-enters passer’s chain as recycled', !!cCard && cCard.recycled === true, JSON.stringify(deckA.map((u: any) => u.username)));
  r = await api(tokC, 'GET', '/matches/discover?page=0&limit=50');
  const deckC = r.data.users || [];
  check('deck cards hide goals but carry theyLikedMe', deckC.length === 0 || (!('relationshipGoals' in deckC[0]) && 'theyLikedMe' in deckC[0]));

  // B likes C → C's deck must show B FIRST with theyLikedMe
  await api(tokB, 'POST', '/matches/like', { receiverId: C.id });
  r = await api(tokC, 'GET', '/matches/discover?page=0&limit=50');
  const firstCard = (r.data.users || [])[0];
  check('“likes you” card surfaces FIRST', firstCard?.id === B.id && firstCard?.theyLikedMe === true, JSON.stringify(firstCard?.username));
  r = await api(tokC, 'GET', '/matches/stats');
  check('stats include likesYou count', r.status === 200 && r.data.likesYou >= 1);

  // C likes back B → instant match
  r = await api(tokC, 'POST', '/matches/like', { receiverId: B.id });
  check('like-back on “likes you” → instant match', r.status === 200 && r.data.matched === true);

  // ── 8. Preference validation & filters ──
  console.log('━━ 8. Preferences ━━');
  r = await api(tokC, 'PATCH', '/matches/preferences', { openToGoals: ['DATING', 'HACKED'], minYear: 9, sharedInterestMin: 99, ageRangeMin: 10 });
  const saved = r.data;
  check('invalid goal stripped, clamps applied', r.status === 200 && saved.openToGoals?.length === 1 && saved.openToGoals[0] === 'DATING' && saved.minYear === null && saved.sharedInterestMin === 10 && saved.ageRangeMin >= 16);
  r = await api(tokC, 'PATCH', '/matches/preferences', { openToGoals: [], minYear: null, sharedInterestMin: 0 });
  check('reset to defaults works', r.status === 200 && r.data.openToGoals.length === 0 && r.data.minYear === null);

  // Verified-only dealbreaker was removed by product decision — sending it must be ignored, not crash
  r = await api(tokA, 'PATCH', '/matches/preferences', { onlyVerified: true } as any);
  check('removed onlyVerified field is ignored gracefully', r.status === 200);
  r = await api(tokA, 'GET', '/matches/discover?page=0&limit=50');
  check('deck works without verified-only filter', Array.isArray(r.data.users));

  // Year dealbreaker — incl. the 1st-year option
  r = await api(tokA, 'PATCH', '/matches/preferences', { minYear: 1 });
  r = await api(tokA, 'GET', '/matches/discover?page=0&limit=50');
  check('minYear 1 (1st year+) keeps year-set users', (r.data.users || []).some((u: any) => u.id === C.id), JSON.stringify((r.data.users || []).map((u: any) => u.username)));
  r = await api(tokA, 'PATCH', '/matches/preferences', { minYear: 3 });
  r = await api(tokA, 'GET', '/matches/discover?page=0&limit=50');
  check('minYear 3 excludes 2nd-year users', !(r.data.users || []).some((u: any) => u.id === C.id));
  await api(tokA, 'PATCH', '/matches/preferences', { minYear: null });

  // ── 9. Rewind, pass guards, limits, waiting accuracy, shared-interest N ──
  console.log('━━ 9. Rewind & guards & relevance ━━');
  const D = await mk('zt_d', 'FEMALE', true);
  const E = await mk('zt_e', 'FEMALE', true);
  const tokD = await loginAs(D.email);
  await prisma.userInterest.createMany({ data: [
    { userId: D.id, interestId: skate.id },
    { userId: E.id, interestId: skate.id }, { userId: E.id, interestId: chess.id },
  ] });

  // Rewind undoes the last PASS only, within 10 minutes
  r = await api(tokA, 'POST', '/matches/pass', { receiverId: D.id });
  check('A passes D', r.status === 200 && r.data.matched === false);
  r = await api(tokA, 'POST', '/matches/rewind');
  check('rewind undoes the last pass', r.status === 200 && r.data.rewound === true && r.data.userId === D.id, JSON.stringify(r.data));
  r = await api(tokA, 'GET', '/matches/discover?page=0&limit=50');
  const dCard = (r.data.users || []).find((u: any) => u.id === D.id);
  check('rewound profile returns as fresh (not recycled)', !!dCard && dCard.recycled !== true);
  r = await api(tokD, 'POST', '/matches/rewind');
  check('rewind on empty stack → 404', r.status === 404, `got ${r.status}`);
  await api(tokB, 'POST', '/matches/like', { receiverId: D.id });
  r = await api(tokB, 'POST', '/matches/rewind');
  check('rewind after only-like (no pass) → 404', r.status === 404, `got ${r.status}`);

  // Pass guards mirror the like guards
  r = await api(tokA, 'POST', '/matches/pass', { receiverId: A.id });
  check("can't pass yourself", r.status >= 400);
  r = await api(tokA, 'POST', '/matches/pass', { receiverId: outsider.id });
  check('cross-college pass rejected', r.status >= 400);
  r = await api(tokA, 'POST', '/matches/pass', { receiverId: 'nonexistent00000000000' });
  check('bogus pass rejected', r.status >= 400);

  // Unmatch negatives (the A-B match is foreign to C)
  const abMatch = await prisma.match.findFirst({ where: { status: 'ACTIVE', OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] } });
  r = abMatch ? await api(tokC, 'DELETE', `/matches/${abMatch.id}`) : { status: 0, data: null };
  check("can't unmatch someone else's match", r.status >= 400, `got ${r.status}`);
  r = await api(tokA, 'DELETE', '/matches/nonexistent00000000000');
  check('bogus matchId rejected', r.status >= 400, `got ${r.status}`);

  // Controller clamps runaway pagination
  r = await api(tokA, 'GET', '/matches/discover?page=0&limit=500');
  check('discover limit clamped to ≤50', r.status === 200 && (r.data.users || []).length <= 50);
  r = await api(tokA, 'GET', '/matches/likes-you?limit=500');
  check('likes-you limit clamped to ≤50', r.status === 200 && (r.data.users || []).length <= 50);

  // Waiting accuracy: B's like on D is waiting (==1); after D likes back it drops to 0
  r = await api(tokD, 'GET', '/matches/stats');
  check('likesYou counts only waiting likes', r.status === 200 && r.data.likesYou === 1, JSON.stringify(r.data));
  r = await api(tokD, 'POST', '/matches/like', { receiverId: B.id });
  check('D likes back B → instant match', r.status === 200 && r.data.matched === true);
  r = await api(tokD, 'GET', '/matches/stats');
  check('matched/answered likes leave the waiting count', r.status === 200 && r.data.likesYou === 0, JSON.stringify(r.data));

  // Shared-interest N>1 is actually enforced (A shares skate+chess; D has 1, E has 2)
  r = await api(tokA, 'PATCH', '/matches/preferences', { sharedInterestMin: 2 });
  check('sharedInterestMin 2 saves', r.status === 200 && r.data.sharedInterestMin === 2);
  r = await api(tokA, 'GET', '/matches/discover?page=0&limit=50');
  const min2deck = r.data.users || [];
  check('2+ filter keeps doubly-shared E', min2deck.some((u: any) => u.id === E.id), JSON.stringify(min2deck.map((u: any) => u.username)));
  check('2+ filter hides singly-shared D', !min2deck.some((u: any) => u.id === D.id));
  await api(tokA, 'PATCH', '/matches/preferences', { sharedInterestMin: 0 });

  const dRows = await prisma.matchLike.findMany({ where: { senderId: D.id } });
  check('D has no duplicate action rows', new Set(dRows.map((x) => x.receiverId)).size === dRows.length);

  // ── 10. Auth/abuse edges ──
  console.log('━━ 10. Auth & abuse ━━');
  r = await api('', 'GET', '/matches/discover');
  check('unauthenticated discover → 401', r.status === 401);
  r = await api('garbage.token.here', 'GET', '/matches/discover');
  check('garbage token → 401', r.status === 401);
  r = await api(tokA, 'POST', '/matches/like', { receiverId: null });
  check('null receiverId → 400', r.status === 400);

  // ── 10b. Notification inbox is actionable ──
  // Every notification type must lead somewhere. DM + MATCH rows used to be
  // dead ends (the client only navigated on postId), and the bell could only
  // be cleared by the blanket "mark all read" — so the badge lied.
  console.log('━━ 10b. Notification inbox ━━');
  {
    const pair = await prisma.match.findUnique({
      where: { userA_userB: { userA: [A.id, B.id].sort()[0], userB: [A.id, B.id].sort()[1] } },
      select: { status: true, id: true },
    });
    // The A↔B match row id, used to scope MATCH-notification assertions below
    // (B may hold MATCH rows from other suite pairings; type alone is ambiguous).
    const abMatchId = pair?.id as string;
    if (pair?.status !== 'ACTIVE') {
      await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
      await api(tokB, 'POST', '/matches/like', { receiverId: A.id });
    }
    const convRes = await api(tokA, 'POST', '/messages/conversation', { userId: B.id });
    const convId = convRes.data?.id;
    check('conversation opens for the deep-link flow', !!convId);

    await api(tokB, 'PATCH', '/notifications/read');
    const dmSend = await api(tokA, 'POST', `/messages/${convId}`, { content: 'inbox deep-link probe' });
    check('DM sent for the inbox probe', dmSend.status === 200 || dmSend.status === 201);

    // The DM notification must carry the conversationId — that IS the link.
    const dmNotifs = await api(tokB, 'GET', '/notifications?limit=50');
    const dmRow = (dmNotifs.data.notifications || []).find((n: any) => n.type === 'NEW_MESSAGE');
    check('NEW_MESSAGE notification exists', !!dmRow);
    check(
      'NEW_MESSAGE carries metadata.conversationId',
      dmRow?.metadata?.conversationId === convId,
      JSON.stringify(dmRow?.metadata),
    );
    check('DM notification never snapshots the message body', !JSON.stringify(dmRow?.metadata || {}).includes('inbox deep-link probe'));

    // Per-notification read clears exactly one badge, not the whole inbox.
    await prisma.notification.create({
      data: { recipientId: B.id, actorId: A.id, type: 'LIKE' as any },
    });
    const before = await api(tokB, 'GET', '/notifications/unread-count');
    check('unread count is positive before single-read', before.data.count > 0, JSON.stringify(before.data));

    const readOne = await api(tokB, 'PATCH', `/notifications/${dmRow.id}/read`);
    check('single-notification read succeeds', readOne.status === 200 && readOne.data.updated === 1, JSON.stringify(readOne.data));
    const after = await api(tokB, 'GET', '/notifications/unread-count');
    check('single read decrements the badge by exactly one', after.data.count === before.data.count - 1, `${before.data.count} → ${after.data.count}`);

    const idempotent = await api(tokB, 'PATCH', `/notifications/${dmRow.id}/read`);
    check('re-reading the same notification is a quiet no-op', idempotent.status === 200 && idempotent.data.updated === 0);

    // Another user's notification id must be a no-op, never a 403/500 that
    // would confirm the id exists.
    const foreign = await api(tokA, 'PATCH', `/notifications/${dmRow.id}/read`);
    check('a foreign notification id is a no-op, not a leak', foreign.status === 200 && foreign.data.updated === 0);

    const bogus = await api(tokB, 'PATCH', '/notifications/nope/read');
    check('malformed notification id → 400', bogus.status === 400, JSON.stringify(bogus.data));

    // A MATCH notification must resolve to a conversation the client can open.
    // Scoped to THIS pair: B can hold MATCH rows from earlier suite sections
    // (e.g. the B↔C like-back), and find() on type alone grabbed whichever
    // came first — an id that then resolved to a different conversation and
    // looked like "a second thread" when the product behaviour was correct.
    const matchNotif = (await api(tokB, 'GET', '/notifications?limit=50')).data.notifications?.find(
      (n: any) => n.type === 'MATCH' && n.matchId === abMatchId,
    );
    check('MATCH notification present for the inbox', !!matchNotif);
    if (matchNotif?.actor) {
      const reopen = await api(tokB, 'POST', '/messages/conversation', { userId: matchNotif.actor.id });
      check('MATCH row resolves to an openable thread', reopen.status === 200 && !!reopen.data?.id);
      check('reopening the same pair never forks a second thread', reopen.data.id === convId, `${reopen.data.id} vs ${convId}`);
    }
  }

  // ── 11. State consistency after everything ──
  console.log('━━ 11. Consistency ━━');
  const aRows = await prisma.matchLike.findMany({ where: { senderId: A.id } });
  check('A has no duplicate action rows', new Set(aRows.map((x) => x.receiverId)).size === aRows.length);
  const activeMatches = await prisma.match.count({ where: { status: 'ACTIVE', OR: [{ userA: A.id }, { userB: A.id }] } });
  check('no runaway match rows for the swiper', activeMatches <= 2, `got ${activeMatches}`);

  console.log(`\n════════ RESULT: ${pass} passed, ${fail} failed ════════`);
  if (failures.length) { console.log('FAILED:', failures.join(' | ')); }

  // ── Cleanup — one idempotent child-first purge for every throwaway ──
  const extraIds = [D.id, E.id];
  const xUser = await prisma.user.findUnique({ where: { email: 'zt_x@test.zoclo' }, select: { id: true } });
  await prisma.interest.deleteMany({ where: { name: { in: ['skateboarding', 'chess', 'anime'] } } });
  await purgeUsers([A.id, B.id, C.id, ...extraIds, ...(xUser ? [xUser.id] : [])]);
  console.log('🧹 throwaway users removed\n');
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
