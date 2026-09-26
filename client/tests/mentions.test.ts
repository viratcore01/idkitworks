import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMentionUsernames,
  findMentionQuery,
  applyMention,
} from '../src/utils/mentions';

/**
 * @mentions must agree with server/src/utils/mentions.ts: whatever linkifies
 * here is what the server notifies about. These cases pin the shared rule —
 * handle shape, email exclusion, length bounds, dedup.
 */

// ───────────────────────── extraction ─────────────────────────

test('extracts plain mentions, lowercased, in order, deduped', () => {
  assert.deepEqual(extractMentionUsernames('hey @Priya_Sharma and @virat01!'), [
    'priya_sharma',
    'virat01',
  ]);
  assert.deepEqual(extractMentionUsernames('@a @a @A'), [], 'too short is never a mention');
  assert.deepEqual(extractMentionUsernames('@abc @abc @ABC'), ['abc']);
});

test('emails, @@ runs and punctuation-adjacent tokens are not mentions', () => {
  assert.deepEqual(extractMentionUsernames('mail me at a@b.com please'), []);
  assert.deepEqual(extractMentionUsernames('@@priya'), []);
  assert.deepEqual(extractMentionUsernames('(@priya), [@virat01]; {#chan}'), ['priya', 'virat01']);
  assert.deepEqual(extractMentionUsernames('end of line @priya'), ['priya']);
  assert.deepEqual(extractMentionUsernames('@priya... wow'), ['priya']);
});

test('length bounds mirror the username rules (3-20)', () => {
  assert.deepEqual(extractMentionUsernames('@ab'), [], '2 chars: no');
  assert.deepEqual(extractMentionUsernames('@abc'), ['abc'], '3 chars: yes');
  assert.deepEqual(extractMentionUsernames(`@${'a'.repeat(20)}`), ['a'.repeat(20)]);
  assert.deepEqual(extractMentionUsernames(`@${'a'.repeat(21)}`), [], '21-char run: no partial match');
  assert.deepEqual(extractMentionUsernames(''), []);
  assert.deepEqual(extractMentionUsernames('@'), []);
});

test('multiline text and mid-word @ signs', () => {
  assert.deepEqual(extractMentionUsernames('line1\n@priya\nline3 @virat01'), ['priya', 'virat01']);
  assert.deepEqual(extractMentionUsernames('abc@priya'), [], 'handle char before @: no');
});

// ─────────────────────── caret query ───────────────────────

test('findMentionQuery tracks the token at the caret', () => {
  assert.deepEqual(findMentionQuery('@', 1), { query: '', start: 0 });
  assert.deepEqual(findMentionQuery('hi @priya', 9), { query: 'priya', start: 3 });
  assert.deepEqual(findMentionQuery('hi @priya x', 8), { query: 'priy', start: 3 });
  assert.deepEqual(findMentionQuery('@priya and @vir', 15), { query: 'vir', start: 11 });
});

test('findMentionQuery returns null outside a token', () => {
  assert.equal(findMentionQuery('hello', 5), null);
  assert.equal(findMentionQuery('hi @priya', 2), null, 'caret before the @');
  assert.equal(findMentionQuery('a@b.com', 3), null, 'email');
  assert.equal(findMentionQuery('@@x', 3), null, '@@ run');
  assert.equal(findMentionQuery(`@user ${'a'.repeat(21)}`, 27), null, 'over-long run can never match');
  assert.equal(findMentionQuery(`@${'a'.repeat(20)}`, 21)?.query, 'a'.repeat(20), 'exactly 20 still tracks');
});

// ──────────────────────── insertion ────────────────────────

test('applyMention splices @username plus a trailing space and lands the caret after it', () => {
  assert.deepEqual(applyMention('hi @pri', 3, 7, 'priya_sharma'), {
    text: 'hi @priya_sharma ',
    caret: 17,
  });
  assert.deepEqual(applyMention('@v', 0, 2, 'virat01'), {
    text: '@virat01 ',
    caret: 9,
  });
  assert.deepEqual(applyMention('hey @pri, welcome', 4, 8, 'priya'), {
    text: 'hey @priya , welcome',
    caret: 11,
  });
});
