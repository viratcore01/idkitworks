import { Fragment } from 'react';
import { Link } from 'react-router-dom';

/**
 * Plain text with @usernames linkified to profiles.
 *
 * Same rule as the server notify path (see utils/mentions): 3-20 handle
 * chars, no emails, no `@@`. Unknown handles still link — ProfilePage shows
 * "User not found" for those, exactly like a pasted profile URL would.
 * Links stopPropagation so they never trigger a parent card's open-post
 * navigation (PostCard content is clickable in feed view).
 */
const MENTION_SPLIT_RE = /(^|[^a-zA-Z0-9_@])(@[a-z0-9_]{3,20})(?![a-z0-9_])/gi;

export default function MentionText({
  text,
  linkClassName = 'text-nb-violet font-display font-semibold hover:underline break-words',
}: {
  text: string;
  linkClassName?: string;
}) {
  const parts: React.ReactNode[] = [];
  const value = String(text ?? '');
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  MENTION_SPLIT_RE.lastIndex = 0;
  while ((m = MENTION_SPLIT_RE.exec(value)) !== null) {
    const prefix = m[1];
    const handle = m[2];
    const at = m.index + prefix.length;
    if (m.index > last) parts.push(<Fragment key={key++}>{value.slice(last, m.index)}</Fragment>);
    if (prefix) parts.push(<Fragment key={key++}>{prefix}</Fragment>);
    const username = handle.slice(1);
    parts.push(
      <Link
        key={key++}
        to={`/profile/${username}`}
        className={linkClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {handle}
      </Link>,
    );
    last = at + handle.length;
  }
  MENTION_SPLIT_RE.lastIndex = 0;
  if (last < value.length) parts.push(<Fragment key={key++}>{value.slice(last)}</Fragment>);
  return <>{parts}</>;
}
