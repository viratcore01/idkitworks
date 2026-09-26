import './helpers/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { extractMentions } from '../src/utils/mentions';
import { notifyMentions, MAX_MENTION_NOTIFICATIONS } from '../src/services/mention.service';
import { subscribe } from '../src/config/bus';
import { FakeDb, install, makeUser, makeCollege, FakeDbOptions } from './helpers/fake-db';

/**
 * @mentions: parse rule + notify fan-out.
 *
 * The fan-out contract (mirrors the inbox read filters, so no phantom rows):
 * same-college, active, unblocked-either-direction users only; never self;
 * never the primary COMMENT/COMMENT_REPLY recipient; one row per user per
 * content; anonymous mentions carry no actor.
 */

function setup(seed: FakeDbOptions = {}) {
  const db = new FakeDb({
    colleges: [makeCollege(), makeCollege({ id: 'college-2', name: 'Other College', shortName: 'OC' })],
    ...seed,
  });
  install(db, prisma);
  return db;
}

const author = makeUser({ id: 'author-1', username: 'author_1', email: 'author@ipec.org.in' });
const priya = makeUser({ id: 'user-priya', username: 'priya_sharma', email: 'priya@ipec.org.in' });
const virat = makeUser({ id: 'user-virat', username: 'virat01', email: 'virat@ipec.org.in' });
const outsider = makeUser({
  id: 'user-out',
  username: 'outsider_1',
  email: 'out@other.edu',
  collegeId: 'college-2',
});
const walled = makeUser({ id: 'user-walled', username: 'walled_1', email: 'walled@ipec.org.in' });
const ghost = makeUser({
  id: 'user-ghost',
  username: 'ghost_1',
  email: 'ghost@ipec.org.in',
  isActive: false,
});

function seedUsers() {
  return setup({ users: [author, priya, virat, outsider, walled, ghost] });
}

async function mentionRows(db: FakeDb) {
  return db.delegate('notification').findMany({ where: { type: 'MENTION' } });
}

// ───────────────────────── parse rule ─────────────────────────

test('extractMentions: handles, case, dedup, bounds', () => {
  assert.deepEqual(extractMentions('hey @Priya_Sharma and @virat01!'), ['priya_sharma', 'virat01']);
  assert.deepEqual(extractMentions('@abc @abc @ABC'), ['abc']);
  assert.deepEqual(extractMentions('mail a@b.com @@x @ab'), [], 'emails, @@ runs and short tokens never parse');
  assert.deepEqual(extractMentions(`@${'a'.repeat(20)} ok`), ['a'.repeat(20)]);
  assert.deepEqual(extractMentions(`@${'a'.repeat(21)}`), [], 'over-long runs are not partial mentions');
  assert.deepEqual(extractMentions(''), []);
});

// ───────────────────────── fan-out ─────────────────────────

test('post mention notifies the mentioned user with a working deep-link payload', async () => {
  const db = seedUsers();
  const pushed: any[] = [];
  const unsub = subscribe('notification:new', (p) => pushed.push(p));
  try {
    const ids = await notifyMentions({
      content: 'welcome @priya_sharma!',
      authorId: 'author-1',
      authorCollegeId: 'college-1',
      isAnonymous: false,
      postId: 'post-1',
    });
    assert.deepEqual(ids, ['user-priya']);
    const rows = await mentionRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipientId, 'user-priya');
    assert.equal(rows[0].actorId, 'author-1');
    assert.equal(rows[0].postId, 'post-1');
    assert.equal(rows[0].commentId, null);
    assert.deepEqual(pushed, [{ userIds: ['user-priya'] }], 'realtime push fans out to the mentioned user');
  } finally {
    unsub();
  }
});

test('one notification per user no matter how often they are @’d; unknown names are ignored', async () => {
  seedUsers();
  const ids = await notifyMentions({
    content: '@priya_sharma @PRIYA_SHARMA, again @priya_sharma! cc @nobody_here_123',
    authorId: 'author-1',
    authorCollegeId: 'college-1',
    isAnonymous: false,
    postId: 'post-1',
  });
  assert.deepEqual(ids, ['user-priya']);
});

test('self-mentions, other-college users, blocked users and inactive users are never notified', async () => {
  const db = seedUsers();
  await db.delegate('block').create({ data: { blockerId: 'author-1', blockedId: 'user-walled' } });
  const ids = await notifyMentions({
    content: 'me @author_1, far @outsider_1, walled @walled_1, gone @ghost_1, real @virat01',
    authorId: 'author-1',
    authorCollegeId: 'college-1',
    isAnonymous: false,
    postId: 'post-1',
  });
  assert.deepEqual(ids, ['user-virat'], 'only the visible same-college user is notified');
  assert.equal((await mentionRows(db)).length, 1);
});

test('a block in the reverse direction also walls the mention', async () => {
  const db = seedUsers();
  await db.delegate('block').create({ data: { blockerId: 'user-walled', blockedId: 'author-1' } });
  const ids = await notifyMentions({
    content: 'hi @walled_1',
    authorId: 'author-1',
    authorCollegeId: 'college-1',
    isAnonymous: false,
    postId: 'post-1',
  });
  assert.deepEqual(ids, []);
});

test('the primary comment recipient is not double-notified for the same action', async () => {
  const db = seedUsers();
  const ids = await notifyMentions({
    content: 'thanks @priya_sharma and hi @virat01',
    authorId: 'author-1',
    authorCollegeId: 'college-1',
    isAnonymous: false,
    postId: 'post-1',
    commentId: 'comment-1',
    excludeUserIds: ['user-priya'],
  });
  assert.deepEqual(ids, ['user-virat']);
  const rows = await mentionRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].commentId, 'comment-1', 'comment mentions deep-link to the comment');
});

test('anonymous mentions notify without an actor', async () => {
  const db = seedUsers();
  await notifyMentions({
    content: 'shoutout @priya_sharma',
    authorId: 'author-1',
    authorCollegeId: 'college-1',
    isAnonymous: true,
    postId: 'post-1',
  });
  const rows = await mentionRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actorId, null);
});

test('no college, no mentions, no crash — and empty content notifies nobody', async () => {
  seedUsers();
  assert.deepEqual(
    await notifyMentions({
      content: 'hi @priya_sharma',
      authorId: 'author-1',
      authorCollegeId: null,
      isAnonymous: false,
      postId: 'post-1',
    }),
    [],
  );
  assert.deepEqual(
    await notifyMentions({
      content: 'nothing to see here',
      authorId: 'author-1',
      authorCollegeId: 'college-1',
      isAnonymous: false,
      postId: 'post-1',
    }),
    [],
  );
});

test(`fan-out is capped at ${MAX_MENTION_NOTIFICATIONS} per content`, async () => {
  const users = [author];
  for (let i = 0; i < 25; i++) {
    users.push(makeUser({ id: `user-m${i}`, username: `member_${i}`, email: `m${i}@ipec.org.in` }));
  }
  const db = setup({ users });
  const content = users
    .slice(1)
    .map((u) => `@${u.username}`)
    .join(' ');
  const ids = await notifyMentions({
    content,
    authorId: 'author-1',
    authorCollegeId: 'college-1',
    isAnonymous: false,
    postId: 'post-1',
  });
  assert.equal(ids.length, MAX_MENTION_NOTIFICATIONS);
  assert.equal((await mentionRows(db)).length, MAX_MENTION_NOTIFICATIONS);
});
