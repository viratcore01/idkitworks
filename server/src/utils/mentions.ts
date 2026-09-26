/**
 * @mention parsing — the single source of truth for "who is mentioned in
 * this text", mirrored by client/src/utils/mentions.ts (same rule, both
 * sides must agree on what counts as a mention).
 *
 * Rule (matches USERNAME_PATTERN ^[a-z0-9_]{3,20}$):
 * - `@` must start the text or follow a non-handle character. In particular
 *   it must NOT follow [A-Za-z0-9_@], which excludes emails (`a@b.com`) and
 *   `@@user` runs.
 * - The handle is 3-20 [a-z0-9_] chars (case-insensitive on input,
 *   lowercased on output — usernames compare case-insensitively).
 * - A longer alnum run is NOT a mention (`@ab` too short, `@<21 chars>`
 *   too long): the negative lookahead rejects both.
 */
const MENTION_RE = /(^|[^a-zA-Z0-9_@])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi;

/** Unique lowercased usernames mentioned in `text`, in order of appearance. */
export function extractMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  MENTION_RE.lastIndex = 0;
  const input = String(text || '');
  let m: RegExpExecArray | null;
  // `g`-flag regexes are stateful — reset before AND loop defensively so a
  // shared module-level pattern can never leak lastIndex between calls.
  while ((m = MENTION_RE.exec(input)) !== null) {
    const name = m[2].toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    // Guard against zero-length matches (there are none by construction,
    // but a stuck lastIndex would be an infinite loop).
    if (m.index === MENTION_RE.lastIndex) MENTION_RE.lastIndex++;
  }
  MENTION_RE.lastIndex = 0;
  return out;
}
