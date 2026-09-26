/**
 * @mention helpers — mirrors server/src/utils/mentions.ts. The render rule
 * (what becomes a profile link) and the "what is the @query at the caret"
 * rule must agree with the server's notify rule, or users would see links
 * that never notify (and vice versa).
 */

/** A handle the server would accept: 3-20 [a-z0-9_], case-insensitive. */
const HANDLE = '[a-z0-9_]{3,20}';

/**
 * Split-able mention pattern: prefix capture (no lookbehind — safe on every
 * mobile browser) + handle + negative lookahead so `@ab`, `@<21 chars>`,
 * emails (`a@b.com`) and `@@user` never linkify.
 */
const MENTION_SPLIT_RE = /(^|[^a-zA-Z0-9_@])(@[a-z0-9_]{3,20})(?![a-z0-9_])/gi;

/** Unique lowercased usernames mentioned in `text`, in order of appearance. */
export function extractMentionUsernames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  MENTION_SPLIT_RE.lastIndex = 0;
  const input = String(text || '');
  let m: RegExpExecArray | null;
  while ((m = MENTION_SPLIT_RE.exec(input)) !== null) {
    // m[2] includes the '@' — strip it.
    const name = m[2].slice(1).toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    if (m.index === MENTION_SPLIT_RE.lastIndex) MENTION_SPLIT_RE.lastIndex++;
  }
  MENTION_SPLIT_RE.lastIndex = 0;
  return out;
}

const HANDLE_CHAR = /[a-zA-Z0-9_]/;
const MAX_HANDLE_LEN = 20;

export interface MentionQuery {
  /** The raw text after `@` (may be '' right after typing `@`). */
  query: string;
  /** Index of the `@` in the full text. */
  start: number;
}

/**
 * What @query (if any) is being typed at `caret` (selectionStart).
 * Returns null when the caret is not inside an @token: no `@` before the
 * caret on this run, `@` preceded by a handle/`@` char (email, `@@`), or
 * the run already exceeds the 20-char handle limit (no username can match).
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const value = String(text || '');
  const pos = Math.max(0, Math.min(caret, value.length));
  let i = pos - 1;
  // Walk back over the handle run immediately before the caret.
  while (i >= 0 && HANDLE_CHAR.test(value[i])) i--;
  if (i < 0 || value[i] !== '@') return null;
  const start = i;
  // `@` must start the text or follow a non-handle, non-@ char.
  if (start > 0) {
    const before = value[start - 1];
    if (HANDLE_CHAR.test(before) || before === '@') return null;
  }
  const query = value.slice(start + 1, pos);
  if (query.length > MAX_HANDLE_LEN) return null;
  return { query, start };
}

/** Replace the `@query` run at `start..caret` with `@username ` + new caret. */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  username: string,
): { text: string; caret: number } {
  const value = String(text || '');
  const handle = `@${username} `;
  const next = value.slice(0, start) + handle + value.slice(caret);
  return { text: next, caret: start + handle.length };
}
