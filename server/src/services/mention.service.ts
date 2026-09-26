import { prisma } from '../config/prisma';
import { invalidateUnreadCount } from './notification.service';
import { publish } from '../config/bus';
import { extractMentions } from '../utils/mentions';

/**
 * @mention fan-out — "you were mentioned in a post/comment".
 *
 * Standard mention algorithm (Twitter/Instagram style), adapted to this
 * app's hyperlocal rules:
 *  1. Parse `@username` tokens server-side at create time (never trust the
 *     client's token list — the text is the contract).
 *  2. Resolve case-insensitively against real users, deduped.
 *  3. Notify ONLY users who can actually SEE the notification. The inbox
 *     read path hides cross-college actors and blocked-either-direction
 *     actors, so notifying those users would mint phantom rows: an unread
 *     badge bump for a notification that never renders. Same-college,
 *     unblocked, active users only. The @link still renders for everyone
 *     (profile pages resolve app-wide).
 *  4. Never notify yourself; never double-notify the user who already gets
 *     the primary COMMENT/COMMENT_REPLY notification for the same action.
 *  5. One notification per mentioned user per post/comment, no matter how
 *     many times they are @'d in the text; fan-out capped so a 5000-char
 *     post cannot spam the whole campus.
 */
export const MAX_MENTION_NOTIFICATIONS = 20;

export interface NotifyMentionsInput {
  content: string;
  authorId: string;
  /** Author's college (== the post's college — college-gated upstream). */
  authorCollegeId: string | null | undefined;
  isAnonymous: boolean;
  postId: string;
  /** Set for comment mentions; undefined for post mentions. */
  commentId?: string;
  /** Users already notified for this same action (post/comment author…). */
  excludeUserIds?: string[];
}

export async function notifyMentions(input: NotifyMentionsInput): Promise<string[]> {
  const { content, authorId, authorCollegeId, isAnonymous, postId, commentId } = input;
  const excluded = new Set(input.excludeUserIds || []);
  if (!authorCollegeId) return [];

  const names = extractMentions(content);
  if (names.length === 0) return [];

  // Usernames are stored lowercase-normalized; the extractor lowercases too,
  // so an exact `in` match resolves on Postgres AND on the in-memory test
  // fake (no reliance on `mode: 'insensitive'` combos). The JS guard below
  // keeps the comparison case-insensitive everywhere regardless.
  const candidates = await prisma.user.findMany({
    where: { username: { in: names } },
    select: { id: true, username: true, collegeId: true, isActive: true },
  });
  const wanted = new Set(names);
  const resolved = candidates.filter(
    (u) =>
      u.isActive &&
      u.id !== authorId &&
      !excluded.has(u.id) &&
      u.collegeId === authorCollegeId &&
      wanted.has(String(u.username || '').toLowerCase()),
  );
  if (resolved.length === 0) return [];

  // Either-direction block is a hard wall (mirrors the inbox read filter —
  // a blocked actor's notification would never render).
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: authorId }, { blockedId: authorId }] },
    select: { blockerId: true, blockedId: true },
  });
  const walled = new Set<string>();
  for (const b of blocks) {
    if (b.blockerId !== authorId) walled.add(b.blockerId);
    if (b.blockedId !== authorId) walled.add(b.blockedId);
  }

  const targets = resolved.filter((u) => !walled.has(u.id)).slice(0, MAX_MENTION_NOTIFICATIONS);
  if (targets.length === 0) return [];

  const snippet = String(content || '').trim().slice(0, 140);
  await prisma.notification.createMany({
    data: targets.map((u) => ({
      recipientId: u.id,
      // PRIVACY: same rule as COMMENT notifications — an anonymous mention
      // notifies WITHOUT an actor ("Someone mentioned you").
      actorId: isAnonymous ? null : authorId,
      type: 'MENTION',
      postId,
      commentId: commentId ?? null,
      metadata: { snippet },
    })),
  });

  const ids = targets.map((u) => u.id);
  invalidateUnreadCount(...ids);
  publish('notification:new', { userIds: ids });
  return ids;
}
