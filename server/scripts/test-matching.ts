/* ═══════════════════════════════════════════════════════════════
   MATCHING WORST-CASE TEST SUITE — hits the real API + real DB.
   Run: cd server && npx tsx scripts/test-matching.ts [baseURL]
   Creates throwaway users (zt_a, zt_b, zt_c in IPEC), runs every
   adversarial scenario, prints PASS/FAIL per case, cleans up.
   Non-zero exit code if anything fails.
   ═══════════════════════════════════════════════════════════════ */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BASE = process.argv[2] || 'http://localhost:5000';
const prisma = new PrismaClient();
const PASSWORD_HASH = bcrypt.hashSync('password123', 10);

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${detail}`); }
}

async function api(token: string, method: string, path: string, body?: any) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

async function loginAs(email: string) {
  const r = await api('', 'POST', '/auth/login', { email, password: 'password123' });
  return r.data.accessToken as string;
}

async function main() {
  console.log('\n━━ Setting up throwaway users ━━');
  const college = await prisma.college.findFirst({ where: { shortName: 'IPEC' } });
  if (!college) throw new Error('IPEC not found');
  const otherCollege = await prisma.college.findFirst({ where: { NOT: { id: college.id } } });

  const mk = async (username: string, gender: string, withPhoto: boolean) => {
    const old = await prisma.user.findUnique({ where: { email: `${username}@test.zoclo` } });
    if (old) await prisma.user.delete({ where: { id: old.id } });
    const u = await prisma.user.create({
      data: {
        email: `${username}@test.zoclo`, username, displayName: username.toUpperCase(),
        passwordHash: PASSWORD_HASH,
        collegeId: college.id, gender, dateOfBirth: new Date('2004-01-15'),
        year: 2,
        isVerified: true, verificationStatus: 'VERIFIED',
        relationshipGoal: 'DATING',
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
  const likeCount = await prisma.matchLike.count({ where: { senderId: A.id, receiverId: B.id } });
  check('exactly ONE like row exists', likeCount === 1);

  // ── 2. Mutual like → match, exactly once ──
  console.log('━━ 2. Mutual match ━━');
  r = await api(tokB, 'POST', '/matches/like', { receiverId: A.id });
  check('B likes back → matched:true', r.status === 200 && r.data.matched === true);
  const matchCount = await prisma.match.count({ where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] } });
  check('exactly ONE match row', matchCount === 1);
  r = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  check('like after match is a quiet no-op', r.status === 200 && r.data.matched === false);
  const notifs = await prisma.notification.count({ where: { type: 'MATCH', OR: [{ recipientId: A.id }, { recipientId: B.id }] } });
  check('both got MATCH notifications', notifs === 2);

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
  await prisma.user.update({ where: { id: B.id }, data: { relationshipGoal: 'CASUAL' } });
  // Unmatch → re-mutual → snapshot must refresh
  const m0 = await prisma.match.findFirst({ where: { OR: [{ userA: A.id, userB: B.id }, { userA: B.id, userB: A.id }] } });
  await api(tokA, 'DELETE', `/matches/${m0!.id}`);
  const l1 = await api(tokA, 'POST', '/matches/like', { receiverId: B.id });
  const l2 = l1.data.matched ? null : await api(tokB, 'POST', '/matches/like', { receiverId: A.id });
  const rematch = l1.data.matched ? l1 : l2;
  check('re-mutual → re-match', !!rematch && rematch.data.matched === true);
  check('diverged goals excluded from criteria', rematch.data.criteria?.goals?.length === 0, JSON.stringify(rematch.data.criteria));
  check('only the shared interest appears', rematch.data.criteria?.interests?.length === 1 && rematch.data.criteria.interests[0].name === 'skateboarding', JSON.stringify(rematch.data.criteria?.interests));
  await prisma.user.update({ where: { id: B.id }, data: { relationshipGoal: 'DATING' } });

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
  check('deck cards carry goal/verified/theyLikedMe fields', deckC.length === 0 || ('relationshipGoal' in deckC[0] && 'theyLikedMe' in deckC[0]));

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

  // ── 9. Auth/abuse edges ──
  console.log('━━ 9. Auth & abuse ━━');
  r = await api('', 'GET', '/matches/discover');
  check('unauthenticated discover → 401', r.status === 401);
  r = await api('garbage.token.here', 'GET', '/matches/discover');
  check('garbage token → 401', r.status === 401);
  r = await api(tokA, 'POST', '/matches/like', { receiverId: null });
  check('null receiverId → 400', r.status === 400);

  // ── 10. State consistency after everything ──
  console.log('━━ 10. Consistency ━━');
  const aRows = await prisma.matchLike.findMany({ where: { senderId: A.id } });
  check('A has no duplicate action rows', new Set(aRows.map((x) => x.receiverId)).size === aRows.length);
  const activeMatches = await prisma.match.count({ where: { status: 'ACTIVE', OR: [{ userA: A.id }, { userB: A.id }, { userA: B.id }, { userB: B.id }] } });
  check('no runaway match rows', activeMatches <= 2, `got ${activeMatches}`);

  console.log(`\n════════ RESULT: ${pass} passed, ${fail} failed ════════`);
  if (failures.length) { console.log('FAILED:', failures.join(' | ')); }

  // ── Cleanup (children first — matches/likes/notifications FK the users) ──
  await prisma.userInterest.deleteMany({ where: { userId: { in: [A.id, B.id, C.id] } } });
  await prisma.interest.deleteMany({ where: { name: { in: ['skateboarding', 'chess', 'anime'] } } });
  await prisma.notification.deleteMany({ where: { OR: [{ recipientId: A.id }, { recipientId: B.id }, { recipientId: C.id }, { actorId: A.id }, { actorId: B.id }, { actorId: C.id }] } });
  await prisma.match.deleteMany({ where: { OR: [{ userA: A.id }, { userB: A.id }, { userA: B.id }, { userB: B.id }, { userA: C.id }, { userB: C.id }] } });
  await prisma.matchLike.deleteMany({ where: { OR: [{ senderId: A.id }, { receiverId: A.id }, { senderId: B.id }, { receiverId: B.id }, { senderId: C.id }, { receiverId: C.id }] } });
  await prisma.matchPreference.deleteMany({ where: { userId: { in: [A.id, B.id, C.id] } } });
  await prisma.user.deleteMany({ where: { email: { in: ['zt_a@test.zoclo', 'zt_b@test.zoclo', 'zt_c@test.zoclo', 'zt_x@test.zoclo'] } } });
  console.log('🧹 throwaway users removed\n');
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
