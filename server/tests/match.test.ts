import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { MatchService } from '../src/services/match.service';
import { FakeDb, install, makeUser, makeCollege, FakeDbOptions } from './helpers/fake-db';
import { clear as clearCache } from '../src/config/cache';

const COLLEGE = 'college-1';
const ADULT_DOB = new Date('2000-01-01T00:00:00Z');
const DAY = 24 * 3600 * 1000;
/** A 16.5-year-old: safely inside both the minor bracket and the 16+ pref floor. */
const MINOR_DOB = new Date(Date.now() - 16.5 * 365.25 * DAY);
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

function setup(seed: FakeDbOptions = {}) {
  clearCache();
  const db = new FakeDb({ colleges: [makeCollege()], ...seed });
  install(db, prisma);
  return { db, svc: new MatchService() };
}

let seq = 0;
/** Eligible-by-default candidate: same college, adult, photo-bearing pool entry. */
function person(over: Record<string, any> = {}) {
  seq += 1;
  return makeUser({
    id: `u-${seq}`,
    email: `person${seq}@ipec.org.in`,
    username: `person${seq}`,
    displayName: `Person ${seq}`,
    collegeId: COLLEGE,
    dateOfBirth: ADULT_DOB,
    course: 'CSE',
    year: 2,
    ...over,
  });
}
const photo = (userId: string, slot = 0) => ({ id: `photo-${userId}-${slot}`, userId, slot });
const likeRow = (senderId: string, receiverId: string, action = 'LIKE', createdAt = new Date()) => ({
  senderId, receiverId, action, createdAt,
});
const interest = (id: string) => ({ id, name: `Interest ${id}` });
const hasInterest = (userId: string, interestId: string) => ({ userId, interestId });
const deckIds = (result: any) => result.users.map((u: any) => u.id);

// ─────────────────────────── deck composition ───────────────────────────

test('deck lists eligible candidates newest-first when nothing is scored', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer', course: null, year: null }),
      person({ id: 'c1', createdAt: daysAgo(3) }),
      person({ id: 'c2', createdAt: daysAgo(2) }),
      person({ id: 'c3', createdAt: daysAgo(1) }),
    ],
    userPhotos: [photo('viewer'), photo('c1'), photo('c2'), photo('c3')],
  });
  const deck = await svc.discover('viewer');
  assert.deepEqual(deckIds(deck), ['c3', 'c2', 'c1']);
});

test('deck excludes self, liked, passed, blocked, inactive, photo-less and other-college profiles', async () => {
  const { svc } = setup({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other', emailDomain: 'other.edu' })],
    users: [
      person({ id: 'viewer' }),
      person({ id: 'liked' }),
      person({ id: 'passed' }),
      person({ id: 'blocked-by-me' }),
      person({ id: 'blocked-me' }),
      person({ id: 'inactive', isActive: false }),
      person({ id: 'nophoto' }),
      person({ id: 'faraway', collegeId: 'college-2' }),
      person({ id: 'eligible' }),
    ],
    userPhotos: [
      photo('viewer'), photo('liked'), photo('passed'), photo('blocked-by-me'),
      photo('blocked-me'), photo('inactive'), photo('faraway'), photo('eligible'),
    ],
    matchLikes: [
      likeRow('viewer', 'liked', 'LIKE'),
      likeRow('viewer', 'passed', 'PASS'),
    ],
    blocks: [
      { blockerId: 'viewer', blockedId: 'blocked-by-me' },
      { blockerId: 'blocked-me', blockedId: 'viewer' },
    ],
  });
  const deck = await svc.discover('viewer');
  const ids = deckIds(deck).sort();
  assert.deepEqual(ids, ['eligible', 'passed']);
  // …but the loop chain is honest about it: fresh profiles first, the passed
  // one stitched at the back and flagged recycled (it cycles forever).
  assert.equal(deck.users[0].id, 'eligible');
  assert.ok(!deck.users[0].recycled);
  const passedCard = deck.users.find((u: any) => u.id === 'passed');
  assert.equal(passedCard?.recycled, true);
  // And a tight first window is pure fresh — nothing passed displaces it.
  assert.deepEqual(deckIds(await svc.discover('viewer', 0, 1)), ['eligible']);
});

test('passes older than 90 days recycle into fresh candidates', async () => {
  const { svc } = setup({
    users: [person({ id: 'viewer' }), person({ id: 'old' })],
    userPhotos: [photo('viewer'), photo('old')],
    matchLikes: [likeRow('viewer', 'old', 'PASS', new Date(Date.now() - 100 * DAY))],
  });
  const deck = await svc.discover('viewer');
  assert.deepEqual(deckIds(deck), ['old']);
});

test('photo gate: a viewer without any photo gets PROFILE_PHOTO_REQUIRED, not a deck', async () => {
  const { svc } = setup({
    users: [person({ id: 'viewer' }), person({ id: 'c1' })],
    userPhotos: [photo('c1')],
  });
  const deck: any = await svc.discover('viewer');
  assert.equal(deck.gated, true);
  assert.equal(deck.code, 'PROFILE_PHOTO_REQUIRED');
  assert.deepEqual(deck.users, []);
});

test('no college means an empty deck, no exceptions', async () => {
  const { svc } = setup({
    users: [person({ id: 'viewer', collegeId: null }), person({ id: 'c1' })],
    userPhotos: [photo('viewer'), photo('c1')],
  });
  const deck = await svc.discover('viewer');
  assert.deepEqual(deck.users, []);
});

// ────────────────────── ordering: best matches front ────────────────────

test('relevance outranks recency: shared interests + same course beat newer strangers', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer' }),
      // Best: older, but shares everything.
      person({ id: 'best', createdAt: daysAgo(10) }),
      // Mid: shares one interest, adjacent year.
      person({ id: 'mid', course: 'ECE', year: 1, createdAt: daysAgo(5) }),
      person({ id: 'new1', course: 'ECE', year: null, createdAt: daysAgo(1) }),
      person({ id: 'new2', course: 'ECE', year: null, createdAt: new Date() }),
    ],
    userPhotos: [photo('viewer'), photo('best'), photo('mid'), photo('new1'), photo('new2')],
    interests: [interest('i1'), interest('i2')],
    userInterests: [
      hasInterest('viewer', 'i1'), hasInterest('viewer', 'i2'),
      hasInterest('best', 'i1'), hasInterest('best', 'i2'),
      hasInterest('mid', 'i1'),
    ],
  });
  const deck = await svc.discover('viewer', 0, 2);
  assert.deepEqual(deckIds(deck), ['best', 'mid']);
  assert.equal(deck.users[0].sharedInterests, 2);
  assert.equal(deck.users[1].sharedInterests, 1);
});

test('REGRESSION: the recency boost applies (createdAt must reach the scorer)', async () => {
  // A (25d old + meaningful bio = 5 + boost 2) must lose to B (fresh = 10).
  // Without createdAt in the select the boost reads as 0 and A wins 5-0.
  const { svc } = setup({
    users: [
      person({ id: 'viewer', course: 'CSE', year: null }),
      person({ id: 'a', course: 'ECE', year: null, bio: 'A long and meaningful biography here', createdAt: daysAgo(25) }),
      person({ id: 'b', course: 'ECE', year: null, bio: null, createdAt: new Date() }),
      person({ id: 'c', course: 'ECE', year: null, bio: null, createdAt: daysAgo(26) }),
    ],
    userPhotos: [photo('viewer'), photo('a'), photo('b'), photo('c')],
  });
  const deck = await svc.discover('viewer', 0, 2);
  assert.deepEqual(deckIds(deck), ['b', 'a']);
});

test('people who liked you surface first — silently, with no disclosure flag', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer', course: null, year: null }),
      // Admirer: old and low-signal, but they liked first.
      person({ id: 'admirer', course: null, year: null, createdAt: daysAgo(30) }),
      person({ id: 'stranger', course: null, year: null, createdAt: new Date() }),
    ],
    userPhotos: [photo('viewer'), photo('admirer'), photo('stranger')],
    matchLikes: [likeRow('admirer', 'viewer', 'LIKE', daysAgo(1))],
  });
  const deck = await svc.discover('viewer');
  assert.deepEqual(deckIds(deck), ['admirer', 'stranger']);
  // Blind likes: the boost is ordering-only. No flag, badge, list entry or
  // ping reveals the like — the card never says why it is first.
  assert.ok(!('theyLikedMe' in deck.users[0]));
  assert.ok(!('theyLikedMe' in deck.users[1]));
});

// ─────────────────── filters: age, goals, gender ────────────────────────

test('STRICT SEGREGATION: minors only see minors, adults never see minors', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'minor-viewer', dateOfBirth: MINOR_DOB }),
      person({ id: 'minor-cand', dateOfBirth: MINOR_DOB }),
      person({ id: 'adult-cand', dateOfBirth: ADULT_DOB }),
    ],
    userPhotos: [photo('minor-viewer'), photo('minor-cand'), photo('adult-cand')],
  });
  assert.deepEqual(deckIds(await svc.discover('minor-viewer')), ['minor-cand']);

  const { svc: svc2 } = setup({
    users: [
      person({ id: 'adult-viewer', dateOfBirth: ADULT_DOB }),
      person({ id: 'minor-cand', dateOfBirth: MINOR_DOB }),
      person({ id: 'adult-cand', dateOfBirth: ADULT_DOB }),
    ],
    userPhotos: [photo('adult-viewer'), photo('minor-cand'), photo('adult-cand')],
  });
  assert.deepEqual(deckIds(await svc2.discover('adult-viewer')), ['adult-cand']);
});

test('missing DOB counts as adult: visible to adults, invisible to minors', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'adult-viewer', dateOfBirth: ADULT_DOB }),
      person({ id: 'nodob', dateOfBirth: null }),
    ],
    userPhotos: [photo('adult-viewer'), photo('nodob')],
  });
  assert.deepEqual(deckIds(await svc.discover('adult-viewer')), ['nodob']);

  const { svc: svc2 } = setup({
    users: [
      person({ id: 'minor-viewer', dateOfBirth: MINOR_DOB }),
      person({ id: 'nodob', dateOfBirth: null }),
    ],
    userPhotos: [photo('minor-viewer'), photo('nodob')],
  });
  assert.deepEqual(deckIds(await svc2.discover('minor-viewer')), []);
});

test('goals filter hides mismatches but never the goal-less', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer', relationshipGoals: ['DATING'] }),
      person({ id: 'mismatch', relationshipGoals: ['HOOKUP'] }),
      person({ id: 'quiet', relationshipGoals: [] }),
      person({ id: 'aligned', relationshipGoals: ['DATING', 'CASUAL'] }),
    ],
    userPhotos: [photo('viewer'), photo('mismatch'), photo('quiet'), photo('aligned')],
  });
  assert.deepEqual(deckIds(await svc.discover('viewer')).sort(), ['aligned', 'quiet']);
});

test('gender preference narrows the deck', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer' }),
      person({ id: 'her', gender: 'FEMALE' }),
      person({ id: 'him', gender: 'MALE' }),
    ],
    userPhotos: [photo('viewer'), photo('her'), photo('him')],
    matchPreferences: [{ userId: 'viewer', genderPreference: 'FEMALE' }],
  });
  assert.deepEqual(deckIds(await svc.discover('viewer')), ['her']);
});

test('PREFERENCE WALL: a liker outside my filters never enters the deck, boost or not', async () => {
  // Female-only preference; a guy likes the viewer. The silent front-boost
  // only REORDERS cards already inside the filtered window — it can never
  // smuggle a filtered-out profile in. Answer: no, he never shows.
  const { svc } = setup({
    users: [
      person({ id: 'viewer' }),
      person({ id: 'him', gender: 'MALE', createdAt: daysAgo(1) }),
      person({ id: 'her', gender: 'FEMALE', createdAt: daysAgo(2) }),
    ],
    userPhotos: [photo('viewer'), photo('him'), photo('her')],
    matchPreferences: [{ userId: 'viewer', genderPreference: 'FEMALE' }],
    matchLikes: [likeRow('him', 'viewer', 'LIKE', new Date())],
  });
  assert.deepEqual(deckIds(await svc.discover('viewer')), ['her']);
});

// ─────────────────── year dealbreaker (multi-select) ────────────────────

test('years filter: only picked years enter the deck; year-less rows need Any', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer' }),
      person({ id: 'y1', year: 1, createdAt: daysAgo(1) }),
      person({ id: 'y2', year: 2, createdAt: daysAgo(2) }),
      person({ id: 'y3', year: 3, createdAt: daysAgo(3) }),
      person({ id: 'y4', year: 4, createdAt: daysAgo(4) }),
      person({ id: 'noyear', year: null }),
    ],
    userPhotos: [photo('viewer'), photo('y1'), photo('y2'), photo('y3'), photo('y4'), photo('noyear')],
    matchPreferences: [{ userId: 'viewer', years: [2, 3] }],
  });
  // Newest-first within the picked set; year-less rows can't prove membership.
  assert.deepEqual(deckIds(await svc.discover('viewer')), ['y2', 'y3']);
});

test('years Any ([]) shows every year, including year-less rows', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer' }),
      person({ id: 'y1', year: 1 }),
      person({ id: 'y4', year: 4 }),
      person({ id: 'noyear', year: null }),
    ],
    userPhotos: [photo('viewer'), photo('y1'), photo('y4'), photo('noyear')],
    matchPreferences: [{ userId: 'viewer', years: [] }],
  });
  assert.deepEqual(deckIds(await svc.discover('viewer')).sort(), ['noyear', 'y1', 'y4']);
});

test('updatePreference stores a clean multi-select and echoes it back', async () => {
  const { db, svc } = setup({ users: [person({ id: 'viewer' })] });
  const saved: any = await svc.updatePreference('viewer', { years: [3, 1, 3, 99, 0, 2.5] as any });
  assert.deepEqual(saved.years, [1, 3], 'dupes, out-of-range and non-integers are dropped');
  assert.equal(saved.minYear, 1, 'the legacy mirror still reads the floor');
  assert.deepEqual(db.rows('matchPreference')[0].years, [1, 3]);

  const cleared: any = await svc.updatePreference('viewer', { years: [] });
  assert.deepEqual(cleared.years, []);
  const nulled: any = await svc.updatePreference('viewer', { years: null });
  assert.deepEqual(nulled.years, [], 'null means Any');
});

test('legacy minYear input converts to the equivalent set (old cached clients keep filtering)', async () => {
  const { db, svc } = setup({
    users: [person({ id: 'viewer' }), person({ id: 'y1', year: 1 }), person({ id: 'y3', year: 3 })],
    userPhotos: [photo('viewer'), photo('y1'), photo('y3')],
  });
  const saved: any = await svc.updatePreference('viewer', { minYear: 3 } as any);
  assert.deepEqual(saved.years, [3, 4, 5]);
  assert.deepEqual(deckIds(await svc.discover('viewer')), ['y3']);
  assert.deepEqual(db.rows('matchPreference')[0].years, [3, 4, 5]);
});

test('getPreference backfills legacy minYear rows that predate the migration', async () => {
  const { svc } = setup({
    users: [person({ id: 'viewer' })],
    matchPreferences: [{ userId: 'viewer', minYear: 2 }],
  });
  const prefs: any = await svc.getPreference('viewer');
  assert.deepEqual(prefs.years, [2, 3, 4, 5]);
});

test('saving years immediately reshapes the deck (fingerprint + invalidation)', async () => {
  const { svc } = setup({
    users: [person({ id: 'viewer' }), person({ id: 'y1', year: 1 }), person({ id: 'y2', year: 2 })],
    userPhotos: [photo('viewer'), photo('y1'), photo('y2')],
  });
  assert.deepEqual(deckIds(await svc.discover('viewer')).sort(), ['y1', 'y2']);
  await svc.updatePreference('viewer', { years: [2] });
  // No stale page may survive the save: the very next read is filtered.
  assert.deepEqual(deckIds(await svc.discover('viewer')), ['y2']);
});

// ───────────────────────────── actions ──────────────────────────────────

test('one-sided like stores the row, notifies NOBODY, and reports no match', async () => {
  const { db, svc } = setup({
    users: [person({ id: 'viewer' }), person({ id: 'them' })],
    userPhotos: [photo('viewer'), photo('them')],
  });
  const result: any = await svc.action('viewer', 'them', 'LIKE');
  assert.equal(result.matched, false);
  assert.equal(db.rows('matchLike').length, 1);
  // Blind likes: a one-sided like is fully undisclosed — no LIKE ping, no
  // badge, no list. Only a mutual like (the match) ever notifies.
  assert.equal(db.rows('notification').length, 0, 'one-sided likes stay silent');
});

test('mutual like matches atomically with the strictly-common criteria', async () => {
  const { db, svc } = setup({
    users: [person({ id: 'a' }), person({ id: 'b' })],
    userPhotos: [photo('a'), photo('b')],
    interests: [interest('i1'), interest('i2')],
    userInterests: [hasInterest('a', 'i1'), hasInterest('a', 'i2'), hasInterest('b', 'i1')],
  });
  await svc.action('a', 'b', 'LIKE');
  const result: any = await svc.action('b', 'a', 'LIKE');
  assert.equal(result.matched, true);
  assert.ok(result.matchId);

  const rows = db.rows('match');
  assert.equal(rows.length, 1, 'exactly one match row');
  assert.equal(rows[0].status, 'ACTIVE');
  assert.deepEqual(result.criteria.interests.map((i: any) => i.id), ['i1'], 'only the SHARED interest is snapshotted');
  const pings = db.rows('notification').filter((n) => n.type === 'MATCH');
  assert.equal(pings.length, 2, 'both sides get the MATCH ping');

  const list = await svc.getMatches('a');
  assert.equal(list.matches.length, 1);
  assert.equal(list.matches[0].partner.id, 'b');
});

test('re-tapping like is idempotent: no duplicate rows, no double match', async () => {
  const { db, svc } = setup({
    users: [person({ id: 'a' }), person({ id: 'b' })],
    userPhotos: [photo('a'), photo('b')],
  });
  await svc.action('a', 'b', 'LIKE');
  const again: any = await svc.action('a', 'b', 'LIKE');
  assert.equal(again.duplicate, true);
  assert.equal(db.rows('matchLike').length, 1);
  assert.equal(db.rows('match').length, 0);
});

test('action guards: self, cross-college, inactive, blocked and minor/adult mixing', async () => {
  const { svc } = setup({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other', emailDomain: 'other.edu' })],
    users: [
      person({ id: 'viewer' }),
      person({ id: 'faraway', collegeId: 'college-2' }),
      person({ id: 'inactive', isActive: false }),
      person({ id: 'blocked', }),
      person({ id: 'minor', dateOfBirth: MINOR_DOB }),
    ],
    userPhotos: [photo('viewer'), photo('faraway'), photo('inactive'), photo('blocked'), photo('minor')],
    blocks: [{ blockerId: 'viewer', blockedId: 'blocked' }],
  });
  await assert.rejects(() => svc.action('viewer', 'viewer', 'LIKE'), /yourself/);
  await assert.rejects(() => svc.action('viewer', 'faraway', 'LIKE'));
  await assert.rejects(() => svc.action('viewer', 'inactive', 'LIKE'), /not available/);
  const blockedErr: any = await svc.action('viewer', 'blocked', 'LIKE').then(
    () => { throw new Error('should have refused'); },
    (e) => e,
  );
  assert.equal(blockedErr.code, 'BLOCKED');
  await assert.rejects(() => svc.action('viewer', 'minor', 'LIKE'));
});

test('like cap: the 101st like inside 12 hours answers 429', async () => {
  const likes = Array.from({ length: 100 }, (_, i) => likeRow('viewer', `r-${i}`, 'LIKE'));
  const { svc } = setup({
    users: [person({ id: 'viewer' }), person({ id: 'them' })],
    userPhotos: [photo('viewer'), photo('them')],
    matchLikes: likes,
  });
  const err: any = await svc.action('viewer', 'them', 'LIKE').then(
    () => { throw new Error('should have been capped'); },
    (e) => e,
  );
  assert.equal(err.status, 429);
});

test('pass moves the profile to the recycled tail; rewind (10 min) restores it fresh', async () => {
  const { svc } = setup({
    users: [
      person({ id: 'viewer', course: null, year: null }),
      person({ id: 'c1', course: null, year: null, createdAt: daysAgo(2) }),
      person({ id: 'c2', course: null, year: null, createdAt: daysAgo(1) }),
    ],
    userPhotos: [photo('viewer'), photo('c1'), photo('c2')],
  });
  await svc.action('viewer', 'c1', 'PASS');
  const after = await svc.discover('viewer');
  assert.deepEqual(deckIds(after), ['c2', 'c1'], 'passed profiles re-enter at the back');
  assert.ok(!after.users[0].recycled);
  assert.equal(after.users[1].recycled, true);
  const rewound: any = await svc.rewindLastPass('viewer');
  assert.equal(rewound.rewound, true);
  const restored = await svc.discover('viewer');
  assert.deepEqual(deckIds(restored), ['c2', 'c1']);
  assert.ok(restored.users.every((u: any) => !u.recycled), 'rewound profiles are fresh again');
});

test('unmatch ends the match and clears likes; re-liking re-matches from scratch', async () => {
  const { db, svc } = setup({
    users: [person({ id: 'a' }), person({ id: 'b' })],
    userPhotos: [photo('a'), photo('b')],
  });
  await svc.action('a', 'b', 'LIKE');
  const matched: any = await svc.action('b', 'a', 'LIKE');
  await svc.unmatch('a', matched.matchId);
  assert.equal(db.rows('match')[0].status, 'ENDED');
  assert.equal(db.rows('matchLike').length, 0, 'the like pair is cleared');
  assert.deepEqual((await svc.getMatches('a')).matches, []);

  const again: any = await svc.action('a', 'b', 'LIKE');
  assert.equal(again.matched, false, 'one side only — no instant re-match');
  const reMatched: any = await svc.action('b', 'a', 'LIKE');
  assert.equal(reMatched.matched, true);
  assert.equal(db.rows('match').filter((m) => m.status === 'ACTIVE').length, 1);
});

test('getMatches hides a blocked ex (either direction)', async () => {
  const { svc } = setup({
    users: [person({ id: 'a' }), person({ id: 'b' })],
    userPhotos: [photo('a'), photo('b')],
    matches: [{ id: 'm-1', userA: 'a', userB: 'b', status: 'ACTIVE', createdAt: new Date() }],
    blocks: [{ blockerId: 'a', blockedId: 'b' }],
  });
  assert.deepEqual((await svc.getMatches('a')).matches, []);
  assert.deepEqual((await svc.getMatches('b')).matches, []);
});
