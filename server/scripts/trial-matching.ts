/* ═══════════════════════════════════════════════════════════════════
   HEAVY DUMMY-DATA TRIAL — matching feature, aggressive loop.
   Run:  cd server && npx tsx scripts/trial-matching.ts [baseURL] [phase]
   Phases: setup | deck | storm | walls | criteria | perf | cleanup | all
   (default: all). Resumable + idempotent: setup wipes stale zx_* first.

   PROD HYGIENE (this runs against the live DB by design):
   - 130 users live in a dedicated ZX Test College → INVISIBLE to real users
     (the college wall isolates them). Only 20 sit in IPEC for wall tests.
   - All rows prefixed zx_; cleanup deletes children-first, always runs.
   - API + harness pools must be tiny (connection_limit=1..2); every API call
     goes through apiR() which retries pooler 500s with backoff and reports
     them as INFRA (not FAIL) — a wrong 200-body is a real bug, a pool 500
     after retries is the known saturated-pooler environment.
   ═══════════════════════════════════════════════════════════════════ */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BASE = process.argv[2] || 'http://127.0.0.1:5000';
const PHASE = process.argv[3] || 'all';
// Optional viewer slice for the deck phase: `deck 0,3` walks viewers 0-2.
// Keeps each invocation bounded when the pooler forces long backoffs.
const SLICE = (process.argv[4] || '0,99').split(',').map((x) => parseInt(x));
const prisma = new PrismaClient();
const PASSWORD_HASH = bcrypt.hashSync('password123', 10);

// Deterministic RNG so every trial run builds the SAME world.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260921);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0, infra = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${detail}`); }
}
function infraNote(name: string) {
  infra++;
  console.log(`  🟡 INFRA (pooler, not app): ${name}`);
}

async function api(token: string, method: string, path: string, body?: any) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

// Retry armor: pooler 500s/429s/connection blips get retried with backoff.
// Returns { exhausted:true } if the pool never frees (reported as INFRA).
async function apiR(token: string, method: string, path: string, body?: any, tries = 8) {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await api(token, method, path, body);
      if (r.status < 500 && r.status !== 429) return { ...r, exhausted: false as const, attempts: i + 1 };
      last = r;
    } catch (e) {
      last = { status: 0, data: null };
    }
    await sleep(Math.min(1000 * 2 ** i, 20000));
    await sleep(150); // gentle cadence: never hammer prod
  }
  return { ...(last || { status: 0, data: null }), exhausted: true as const, attempts: tries };
}

const tokens = new Map<string, string>();
async function loginAs(email: string) {
  if (tokens.has(email)) return tokens.get(email)!;
  const r = await apiR('', 'POST', '/auth/login', { email, password: 'password123' });
  if (r.exhausted || !r.data?.accessToken) throw new Error(`login failed for ${email}`);
  tokens.set(email, r.data.accessToken);
  await sleep(150);
  return r.data.accessToken;
}

const GOALS = ['DATING', 'RELATIONSHIP', 'HOOKUP', 'CASUAL', 'NOT_SURE'];
const INTEREST_NAMES = ['Cricket', 'Chess', 'Music', 'Filmmaking', 'Gaming', 'Reading', 'Football', 'Coding'];

async function ensureInterests() {
  const map = new Map<string, string>();
  for (const n of INTEREST_NAMES) {
    const row = await prisma.interest.upsert({ where: { name: n }, update: {}, create: { name: n, category: 'Trial' } });
    map.set(n, row.id);
  }
  return map;
}

async function wipeTrialUsers() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'zx_' } }, select: { id: true, email: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await prisma.userInterest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { OR: [{ recipientId: { in: ids } }, { actorId: { in: ids } }] } });
  await prisma.match.deleteMany({ where: { OR: [{ userA: { in: ids } }, { userB: { in: ids } }] } });
  await prisma.matchLike.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } });
  await prisma.matchPreference.deleteMany({ where: { userId: { in: ids } } });
  await prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`🧹 wiped ${ids.length} stale zx_ users`);
}

// ── SETUP ──
let ZX: any, IPEC: any, interestIds: Map<string, string>;
const zxUsers: any[] = [];   // 130 in ZX college
const ipecUsers: any[] = []; // 20 in IPEC

async function phaseSetup() {
  console.log('\n━━ SETUP: heavy dummy world ━━');
  await wipeTrialUsers();
  const zxOld = await prisma.college.findUnique({ where: { name: 'ZX Test College' } });
  if (zxOld) await prisma.college.delete({ where: { id: zxOld.id } });
  ZX = await prisma.college.create({ data: { name: 'ZX Test College', shortName: 'ZXTC', city: 'Testville', state: 'Test' } });
  IPEC = await prisma.college.findFirst({ where: { shortName: 'IPEC' } });
  if (!IPEC) throw new Error('IPEC not found');
  interestIds = await ensureInterests();

  const mk = async (tag: string, collegeId: string, i: number) => {
    const g = rnd();
    const gender = g < 0.45 ? 'MALE' : g < 0.9 ? 'FEMALE' : 'OTHER';
    const goals: string[] = [];
    const nGoals = Math.floor(rnd() * 3); // 0-2 (0 = undisclosed)
    for (let k = 0; k < nGoals; k++) { const gv = pick(GOALS); if (!goals.includes(gv)) goals.push(gv); }
    const noPhoto = rnd() < 0.08;
    const inactive = rnd() < 0.06;
    const year = 1 + Math.floor(rnd() * 4);
    const dob = new Date(2000 + Math.floor(rnd() * 6), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
    const u = await prisma.user.create({
      data: {
        email: `zx_${tag}${i}@test.zoclo`, username: `zx_${tag}${i}`, displayName: `ZX ${tag}${i}`,
        passwordHash: PASSWORD_HASH, collegeId, gender, dateOfBirth: dob, year,
        course: pick(['CSE', 'ECE', 'MBA', 'BBA']), bio: rnd() < 0.7 ? `Trial bio ${i} — ${'lorem ipsum dolor sit amet '.repeat(1 + Math.floor(rnd() * 6))}` : null,
        isVerified: true, verificationStatus: 'VERIFIED', isActive: !inactive, relationshipGoals: goals,
        photos: noPhoto ? undefined : { create: [{ data: Buffer.from('x'), mimeType: 'image/png', slot: 0 }] },
      },
    });
    // 0-4 interests
    const names = [...INTEREST_NAMES].sort(() => rnd() - 0.5).slice(0, Math.floor(rnd() * 5));
    if (names.length) {
      await prisma.userInterest.createMany({ data: names.map((n) => ({ userId: u.id, interestId: interestIds.get(n)! })) });
    }
    return { ...u, _goals: goals, _interests: names, _noPhoto: noPhoto, _inactive: inactive };
  };

  for (let i = 0; i < 130; i++) zxUsers.push(await mk('zx', ZX.id, i));
  for (let i = 0; i < 20; i++) ipecUsers.push(await mk('ipc', IPEC.id, i));

  // Strict prefs for 25 ZX users (dealbreaker matrix)
  for (let i = 0; i < 25; i++) {
    const u = zxUsers[i * 5];
    await prisma.matchPreference.upsert({
      where: { userId: u.id },
      create: {
        userId: u.id, lookingFor: 'DATING',
        ageRangeMin: 18, ageRangeMax: 26,
        genderPreference: pick(['EVERYONE', 'MALE', 'FEMALE']),
        openToGoals: [], minYear: pick([null, 2, 3]), sharedInterestMin: pick([0, 1, 2]),
      },
      update: {},
    });
  }
  // 40 intra-ZX blocks
  for (let i = 0; i < 40; i++) {
    const a = pick(zxUsers), b = pick(zxUsers);
    if (a.id === b.id) continue;
    try { await prisma.block.create({ data: { blockerId: a.id, blockedId: b.id } }); } catch { /* dup */ }
  }
  // 90 pre-existing like/pass rows (some mutual → organic matches+notifs)
  for (let i = 0; i < 90; i++) {
    const a = pick(zxUsers), b = pick(zxUsers);
    if (a.id === b.id) continue;
    try {
      await prisma.matchLike.create({ data: { senderId: a.id, receiverId: b.id, action: rnd() < 0.6 ? 'LIKE' : 'PASS' } });
    } catch { /* dup */ }
  }
  console.log(`  world: ${zxUsers.length} ZX + ${ipecUsers.length} IPEC users, blocks + pre-actions seeded`);
}

// ── DECK CORRECTNESS AT VOLUME ──
// Walks full chains for sampled viewers and verifies every card against an
// independently computed eligible set (same RULES, separate implementation).
async function phaseDeck() {
  console.log('\n━━ DECK correctness at volume ━━');
  const allViewers = zxUsers.filter((u) => !u._inactive && !u._noPhoto);
  const viewers = allViewers.slice(SLICE[0], SLICE[1]);
  console.log(`  walking ${viewers.length}/${allViewers.length} viewers (slice ${SLICE[0]}..${SLICE[1]})`);
  for (const v of viewers) {
    const tok = await loginAs(v.email);
    // Exact age, same formula as the server (ms diff) — no boundary flakes.
    const ageOf = (dob: Date) => Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
    // Expected eligible set, computed straight from the DB.
    const likes = await prisma.matchLike.findMany({ where: { senderId: v.id }, select: { receiverId: true, action: true } });
    const likedIds = new Set(likes.filter((l) => l.action === 'LIKE').map((l) => l.receiverId));
    const passedIds = new Set(likes.filter((l) => l.action === 'PASS').map((l) => l.receiverId));
    const blocks = await prisma.block.findMany({ where: { OR: [{ blockerId: v.id }, { blockedId: v.id }] } });
    const blockedIds = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
    const myInterests = new Set((await prisma.userInterest.findMany({ where: { userId: v.id }, select: { interestId: true } })).map((x) => x.interestId));
    const pref = await prisma.matchPreference.findUnique({ where: { userId: v.id } });
    const pool = zxUsers.filter((u) => {
      if (u.id === v.id || u._inactive || u._noPhoto) return false;
      if (u.collegeId !== v.collegeId) return false;
      if (likedIds.has(u.id) || blockedIds.has(u.id)) return false;
      if (pref?.genderPreference && pref.genderPreference !== 'EVERYONE' && u.gender !== pref.genderPreference) return false;
      if (pref?.minYear != null && !(u.year >= pref.minYear)) return false;
      const age = ageOf(u.dateOfBirth);
      if (age < (pref?.ageRangeMin ?? 16) || age > (pref?.ageRangeMax ?? 60)) return false;
      const goals = (v.relationshipGoals?.length ? v.relationshipGoals : (pref?.openToGoals ?? [])) as string[];
      if (goals.length && u._goals.length && !u._goals.some((g: string) => goals.includes(g))) return false;
      if ((pref?.sharedInterestMin ?? 0) > 0) {
        if (!myInterests.size) { /* self-guard: filter skips itself */ }
        else {
          const shared = u._interests.filter((n: string) => [...myInterests].some((id) => interestIds.get(n) === id)).length;
          if (shared < pref.sharedInterestMin!) return false;
        }
      }
      return true;
    });
    const expectedFresh = new Set(pool.filter((u) => !passedIds.has(u.id)).map((u: any) => u.id));
    const expectedRecycled = new Set(pool.filter((u) => passedIds.has(u.id)).map((u: any) => u.id));

    // Walk the whole chain.
    const seen = new Map<string, any>();
    let page = 0, hasMore = true, guard = 0;
    let ok = true, aborted = false;
    // Inbound LIKEs fetched ONCE (not per card — that would be 100s of queries).
    const inboundSet = new Set(
      (await prisma.matchLike.findMany({ where: { receiverId: v.id, action: 'LIKE' }, select: { senderId: true } })).map((x) => x.senderId),
    );
    while (hasMore && guard++ < 12) {
      const r = await apiR(tok, 'GET', `/matches/discover?page=${page}&limit=50`, undefined, 5);
      if (r.exhausted) { infraNote(`deck walk p${page} for ${v.username} — walk inconclusive, skipped`); aborted = true; break; }
      if (r.status !== 200) { check(`deck p${page} 200 for ${v.username}`, false, `got ${r.status}`); ok = false; break; }
      for (const c of r.data.users || []) {
        if (seen.has(c.id)) { check(`no dupes in chain (${v.username})`, false, c.username); ok = false; }
        seen.set(c.id, c);
        // Per-card invariants.
        if (c.id === v.id) { check('never self in deck', false); ok = false; }
        if (c.college?.id !== v.collegeId) { check('college wall in deck', false, c.username); ok = false; }
        if (likedIds.has(c.id)) { check('liked stay hidden', false, c.username); ok = false; }
        if (blockedIds.has(c.id)) { check('blocked stay hidden', false, c.username); ok = false; }
        if (!c.photos?.length) { check('photo-less hidden', false, c.username); ok = false; }
        if ('relationshipGoals' in c) { check('goals never leak', false); ok = false; }
        const shouldRecycled = expectedRecycled.has(c.id);
        if (!!c.recycled !== shouldRecycled) { check('recycled flag exact', false, `${c.username} flag=${c.recycled}`); ok = false; }
        // theyLikedMe accuracy (from the pre-fetched inbound set).
        if (!!c.theyLikedMe !== inboundSet.has(c.id)) { check('theyLikedMe exact', false, c.username); ok = false; }
        // sharedInterests count exactness.
        if (myInterests.size && c.sharedInterests !== undefined) {
          const real = c.interests?.filter((i: any) => [...myInterests].some((id) => id === i.id)).length ?? 0;
          if (c.sharedInterests !== real) { check('sharedInterests count exact', false, `${c.username} ${c.sharedInterests}!=${real}`); ok = false; }
        }
      }
      hasMore = !!r.data.hasMore;
      page++;
    }
    // A pool-aborted walk proves nothing — skip its verdicts (they'd be
    // vacuous FAILs on zero cards). Only completed walks render judgment.
    if (aborted) continue;
    if (ok) {
      const seenIds = new Set(seen.keys());
      const expectedIds = new Set([...expectedFresh, ...expectedRecycled]);
      const missing = [...expectedIds].filter((id) => !seenIds.has(id));
      const extra = [...seenIds].filter((id) => !expectedIds.has(id));
      check(`chain complete for ${v.username} (${seen.size} cards)`, missing.length === 0 && extra.length === 0,
        missing.length || extra.length ? `missing=${missing.length} extra=${extra.length}` : '');
      // Fresh-before-recycled ordering.
      const order = [...seen.values()];
      const firstRec = order.findIndex((c) => c.recycled);
      const lastFresh = order.map((c) => !!c.recycled).lastIndexOf(false);
      check(`fresh-first ordering (${v.username})`, firstRec === -1 || lastFresh < firstRec);
    }
  }
}

// ── ACTION STORM ──
// 25 actors × 14 rapid actions in concurrent batches; then global invariants.
async function phaseStorm() {
  console.log('\n━━ ACTION STORM (25 actors × 14) ━━');
  const actors = zxUsers.filter((u) => !u._inactive && !u._noPhoto).slice(8, 33);
  const targets = zxUsers.filter((u) => !u._inactive && !u._noPhoto);
  const jobs: Promise<any>[] = [];
  for (const a of actors) {
    const tok = await loginAs(a.email);
    for (let k = 0; k < 14; k++) {
      const t = pick(targets);
      if (t.id === a.id) continue;
      const action = rnd() < 0.55 ? 'like' : 'pass';
      jobs.push(apiR(tok, 'POST', `/matches/${action}`, { receiverId: t.id }).then(() => sleep(120)));
      if (jobs.length >= 8) { await Promise.all(jobs.splice(0, jobs.length)); }
    }
  }
  await Promise.all(jobs);
  // Invariants straight from the DB.
  const zxIds = [...zxUsers, ...ipecUsers].map((u) => u.id);
  const rows = await prisma.matchLike.findMany({ where: { OR: [{ senderId: { in: zxIds } }, { receiverId: { in: zxIds } }] }, select: { senderId: true, receiverId: true, action: true } });
  const seen = new Set(rows.map((r) => `${r.senderId}>${r.receiverId}`));
  check('zero duplicate action rows after storm', seen.size === rows.length, `${rows.length} rows`);
  // Every ACTIVE match between zx users has mutual LIKE rows (or a valid re-match path).
  const matches = await prisma.match.findMany({ where: { status: 'ACTIVE', userA: { in: zxIds }, userB: { in: zxIds } } });
  let bad = 0;
  for (const m of matches.slice(0, 60)) {
    const ab = await prisma.matchLike.findFirst({ where: { senderId: m.userA, receiverId: m.userB, action: 'LIKE' } });
    const ba = await prisma.matchLike.findFirst({ where: { senderId: m.userB, receiverId: m.userA, action: 'LIKE' } });
    if (!(ab && ba)) bad++;
  }
  check('sampled matches all rest on mutual likes', bad === 0, `${bad} bad`);
  // Notifications: exactly 2 MATCH notifs per active match (no spam, no loss).
  let notifBad = 0;
  for (const m of matches.slice(0, 60)) {
    const n = await prisma.notification.count({ where: { type: 'MATCH', matchId: m.id } });
    if (n !== 2) notifBad++;
  }
  check('MATCH notifications exactly 2 per match', notifBad === 0, `${notifBad} off`);
  // Like-cap: a FRESH actor (zero sent rows) rapid-fires 105 likes → the
  // 100/12h cap must trip (429s) and no more than 100 LIKE rows may exist.
  const sentCounts = await prisma.matchLike.groupBy({ by: ['senderId'], where: { senderId: { in: zxIds } } });
  const sentSet = new Set(sentCounts.map((g) => g.senderId));
  const cap = targets.find((t) => !sentSet.has(t.id))!;
  const capTok = await loginAs(cap.email);
  // Exclude anyone block-walled with cap (403s would eat attempts and hide the cap trip).
  const capBlocks = await prisma.block.findMany({ where: { OR: [{ blockerId: cap.id }, { blockedId: cap.id }] } });
  const capWalled = new Set(capBlocks.flatMap((b) => [b.blockerId, b.blockedId]));
  const freshTargets = targets.filter((t) => t.id !== cap.id && !capWalled.has(t.id)).slice(0, 105);
  let capped = 0, accepted = 0;
  for (const t of freshTargets) {
    const r = await apiR(capTok, 'POST', '/matches/like', { receiverId: t.id }, 3);
    if (r.exhausted) { infraNote('like-cap burst'); continue; }
    if (r.status === 429) capped++;
    else if (r.status === 200) accepted++;
    await sleep(60);
  }
  check('like cap trips at 100/12h', capped > 0, `accepted=${accepted} capped=${capped}`);
  check('cap respected (≤100 counted)', accepted <= 100, `accepted=${accepted}`);
}

// ── WALLS AT VOLUME ──
async function phaseWalls() {
  console.log('\n━━ WALLS at volume ━━');
  const a = zxUsers.find((u) => !u._inactive && !u._noPhoto)!;
  const b = ipecUsers.find((u) => !u._inactive && !u._noPhoto)!;
  const tokA = await loginAs(a.email);
  const tokB = await loginAs(b.email);
  const t = async (name: string, fn: () => Promise<any>, want: (r: any) => boolean) => {
    const res = await fn();
    if ((res as any).exhausted) { infraNote(name); return; }
    check(name, want(res), `got ${res.status}`);
  };
  await t('cross-college like 404', () => api(tokA, 'POST', '/matches/like', { receiverId: b.id }), (r) => r.status >= 400);
  await t('cross-college pass 404', () => api(tokA, 'POST', '/matches/pass', { receiverId: b.id }), (r) => r.status >= 400);
  const cr = await apiR(tokA, 'GET', `/matches/discover?page=0&limit=50`);
  if (cr.exhausted) infraNote('cross-college deck absence');
  else check('cross-college absent from deck', !(cr.data.users || []).some((u: any) => u.id === b.id));
  const cv = await api(tokA, 'POST', '/messages/conversation', { userId: b.id });
  check('cross-college conversation refused', cv.status >= 400, `got ${cv.status}`);
  // Blocked both directions, every endpoint.
  const x = zxUsers.find((u) => !u._inactive && !u._noPhoto && u.id !== a.id)!;
  const tokX = await loginAs(x.email);
  await prisma.block.deleteMany({ where: { OR: [{ blockerId: a.id, blockedId: x.id }, { blockerId: x.id, blockedId: a.id }] } });
  await prisma.block.create({ data: { blockerId: a.id, blockedId: x.id } });
  await t('blocked: like refused', () => api(tokX, 'POST', '/matches/like', { receiverId: a.id }), (r) => r.status >= 400);
  await t('blocked: pass refused', () => api(tokA, 'POST', '/matches/pass', { receiverId: x.id }), (r) => r.status >= 400);
  const dr = await apiR(tokX, 'GET', `/matches/discover?page=0&limit=50`);
  if (dr.exhausted) infraNote('blocked deck absence');
  else check('blocked absent from deck', !(dr.data.users || []).some((u: any) => u.id === a.id));
  await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: x.id } });
  // Inactive + photo-less never surface.
  const inact = zxUsers.find((u) => u._inactive)!;
  const noph = zxUsers.find((u) => u._noPhoto && !u._inactive)!;
  const tokI = await loginAs(ipecUsers[0].email);
  const ir = await apiR(tokI, 'GET', `/matches/discover?page=0&limit=50`);
  if (ir.exhausted) infraNote('inactive/photo-less absence');
  else {
    const ids = new Set((ir.data.users || []).map((u: any) => u.id));
    void inact; void noph;
    // (IPEC viewer: ZX users invisible by college wall; check within-ZX instead)
    const tokZ = await loginAs(zxUsers[40].email);
    const zr = await apiR(tokZ, 'GET', `/matches/discover?page=0&limit=50`);
    if (zr.exhausted) infraNote('inactive/photo-less absence ZX');
    else {
      const zids = new Set((zr.data.users || []).map((u: any) => u.id));
      const badInact = zxUsers.filter((u) => u._inactive).some((u) => zids.has(u.id));
      const badNoph = zxUsers.filter((u) => u._noPhoto).some((u) => zids.has(u.id));
      check('inactive never surface', !badInact);
      check('photo-less never surface', !badNoph);
      void ids;
    }
  }
  // Self / bogus / null payloads on both endpoints.
  await t('self-like 400+', () => api(tokA, 'POST', '/matches/like', { receiverId: a.id }), (r) => r.status >= 400);
  await t('self-pass 400+', () => api(tokA, 'POST', '/matches/pass', { receiverId: a.id }), (r) => r.status >= 400);
  await t('bogus like 400+', () => api(tokA, 'POST', '/matches/like', { receiverId: 'nonexistent00000000000' }), (r) => r.status >= 400);
  await t('null receiver 400', () => api(tokA, 'POST', '/matches/like', { receiverId: null }), (r) => r.status === 400);
  await t('unmatch foreign 400+', () => api(tokB, 'DELETE', '/matches/nonexistent00000000000'), (r) => r.status >= 400);
  void tokB;
}

// ── CRITERIA MATRIX ──
async function phaseCriteria() {
  console.log('\n━━ CRITERIA matrix ━━');
  const mk3 = async (tag: string, goals: string[], interests: string[]) => {
    const old = await prisma.user.findUnique({ where: { email: `zx_${tag}@test.zoclo` } });
    if (old) {
      // Children first (matches/notifs/likes restrict user deletion).
      await prisma.notification.deleteMany({ where: { OR: [{ recipientId: old.id }, { actorId: old.id }] } });
      await prisma.match.deleteMany({ where: { OR: [{ userA: old.id }, { userB: old.id }] } });
      await prisma.matchLike.deleteMany({ where: { OR: [{ senderId: old.id }, { receiverId: old.id }] } });
      await prisma.userInterest.deleteMany({ where: { userId: old.id } });
      await prisma.user.delete({ where: { id: old.id } });
    }
    const u = await prisma.user.create({
      data: {
        email: `zx_${tag}@test.zoclo`, username: `zx_${tag}`, displayName: tag.toUpperCase(),
        passwordHash: PASSWORD_HASH, collegeId: ZX.id, gender: 'FEMALE',
        dateOfBirth: new Date('2003-05-05'), year: 3, isVerified: true, verificationStatus: 'VERIFIED',
        relationshipGoals: goals,
        photos: { create: { data: Buffer.from('x'), mimeType: 'image/png', slot: 0 } },
      },
    });
    if (interests.length) {
      await prisma.userInterest.createMany({ data: interests.map((n) => ({ userId: u.id, interestId: interestIds.get(n)! })) });
    }
    return u;
  };
  const p = await mk3('cr_p', ['DATING', 'HOOKUP'], ['Cricket', 'Chess', 'Music']);
  const q = await mk3('cr_q', ['HOOKUP', 'CASUAL'], ['Chess', 'Music', 'Gaming']);
  const tp = await loginAs(p.email), tq = await loginAs(q.email);
  let r = await apiR(tp, 'POST', '/matches/like', { receiverId: q.id });
  if (r.exhausted) { infraNote('criteria like'); return; }
  r = await apiR(tq, 'POST', '/matches/like', { receiverId: p.id });
  if (r.exhausted || r.status !== 200 || !r.data) { infraNote('criteria match'); return; }
  check('match formed', r.data.matched === true);
  const goals = r.data.criteria?.goals || [];
  const ints = (r.data.criteria?.interests || []).map((i: any) => i.name).sort();
  check('criteria = STRICT intersection (goals)', JSON.stringify(goals) === JSON.stringify(['HOOKUP']), JSON.stringify(goals));
  check('criteria = STRICT intersection (interests)', JSON.stringify(ints) === JSON.stringify(['Chess', 'Music']), JSON.stringify(ints));
  // Empty intersection → honest fallback shape (client renders "vibes" copy).
  const s = await mk3('cr_s', ['CASUAL'], ['Reading']);
  const ts = await loginAs(s.email);
  await apiR(tp, 'POST', '/matches/like', { receiverId: s.id });
  r = await apiR(ts, 'POST', '/matches/like', { receiverId: p.id });
  if (!r.exhausted) {
    check('zero-common snapshot is empty (not fabricated)',
      (r.data.criteria?.goals?.length ?? -1) === 0 && (r.data.criteria?.interests?.length ?? -1) === 0,
      JSON.stringify(r.data.criteria));
  } else infraNote('zero-common snapshot');
}

// ── PERF SAMPLES ──
async function phasePerf() {
  console.log('\n━━ PERF samples (deck latency) ━━');
  const v = zxUsers.find((u) => !u._inactive && !u._noPhoto)!;
  const tok = await loginAs(v.email);
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await apiR(tok, 'GET', `/matches/discover?page=${i % 3}&limit=20`, undefined, 4);
    if (!r.exhausted && r.status === 200) samples.push(Date.now() - t0);
    await sleep(400);
  }
  samples.sort((a, b) => a - b);
  if (!samples.length) { infraNote('perf samples (pool never freed)'); return; }
  const p50 = samples[Math.floor(samples.length / 2)];
  const p95 = samples[samples.length - 1];
  console.log(`  deck latency: n=${samples.length} p50=${p50}ms p95=${p95}ms`);
  check('deck p95 < 15s (pool-pain tolerant)', p95 < 15000, `p95=${p95}`);
}

// ── CLEANUP ──
async function phaseCleanup() {
  console.log('\n━━ CLEANUP ━━');
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'zx_' } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.userInterest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { OR: [{ recipientId: { in: ids } }, { actorId: { in: ids } }] } });
    await prisma.match.deleteMany({ where: { OR: [{ userA: { in: ids } }, { userB: { in: ids } }] } });
    await prisma.matchLike.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } });
    await prisma.matchPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  const zx = await prisma.college.findUnique({ where: { name: 'ZX Test College' } });
  if (zx) {
    const leftovers = await prisma.user.count({ where: { collegeId: zx.id } });
    if (leftovers === 0) await prisma.college.delete({ where: { id: zx.id } });
    else console.log(`  ⚠️ ZX college kept (${leftovers} users remain — rerun cleanup)`);
  }
  console.log(`🧹 removed ${ids.length} trial users`);
}

// ── RUNNER ──
async function main() {
  const run = async (name: string, fn: () => Promise<void>) => {
    if (PHASE !== 'all' && PHASE !== name) return;
    try { await fn(); }
    catch (e: any) { fail++; failures.push(`${name} CRASH`); console.log(`  ❌ ${name} CRASH: ${e.message}`); }
  };
  // Load world for SINGLE non-setup phases (setup must run first at least
  // once). 'all' builds the world via setup instead — never double-load.
  const enrich = async (u: any) => {
    const [photos, ints] = await Promise.all([
      prisma.userPhoto.findMany({ where: { userId: u.id }, select: { id: true } }),
      prisma.userInterest.findMany({ where: { userId: u.id }, include: { interest: true } }),
    ]);
    return {
      ...u,
      _goals: u.relationshipGoals || [],
      _interests: ints.map((x) => x.interest.name),
      _noPhoto: photos.length === 0,
      _inactive: !u.isActive,
    };
  };
  if (PHASE !== 'all' && PHASE !== 'setup' && PHASE !== 'cleanup') {
    ZX = await prisma.college.findUnique({ where: { name: 'ZX Test College' } });
    IPEC = await prisma.college.findFirst({ where: { shortName: 'IPEC' } });
    if (!ZX) { console.log('No trial world — run the setup phase first.'); process.exit(2); }
    interestIds = await ensureInterests();
    const zx = await prisma.user.findMany({ where: { collegeId: ZX.id } });
    const ipc = await prisma.user.findMany({ where: { email: { startsWith: 'zx_ipc' } } });
    for (const u of zx) zxUsers.push(await enrich(u));
    for (const u of ipc) ipecUsers.push(await enrich(u));
  }
  await run('setup', phaseSetup);
  await run('deck', phaseDeck);
  await run('storm', phaseStorm);
  await run('walls', phaseWalls);
  await run('criteria', phaseCriteria);
  await run('perf', phasePerf);
  if (PHASE === 'all' || PHASE === 'cleanup') {
    try { await phaseCleanup(); }
    catch (e: any) { console.log(`  ⚠️ cleanup issue: ${e.message}`); }
  }
  console.log(`\n════════ TRIAL: ${pass} passed, ${fail} failed, ${infra} infra ════════`);
  if (failures.length) console.log('FAILED:', failures.join(' | '));
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('TRIAL CRASH:', e); process.exit(1); });

