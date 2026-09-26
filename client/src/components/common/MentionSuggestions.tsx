import { AtSign, Loader2 } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import type { MentionSuggestion } from '@/hooks/useMentionAutocomplete';

/**
 * The @mention pick-list. Rendered by the parent in an
 * `absolute bottom-full` slot so it floats ABOVE the field: no layout
 * push, no keyboard overlap, no covering the text being typed.
 *
 * Panel contract: viewport-capped height with its own scroll (never grows
 * the page on a 360px phone), full-width rows with 44px+ tap targets,
 * mouseDown-select (beats input blur), full listbox keyboard semantics.
 */
export default function MentionSuggestions({
  query,
  items,
  loading,
  failed,
  highlight,
  onHighlight,
  onPick,
}: {
  query: string;
  items: MentionSuggestion[];
  loading: boolean;
  failed: boolean;
  highlight: number;
  onHighlight: (i: number) => void;
  onPick: (user: MentionSuggestion) => void;
}) {
  return (
    <div
      id="mention-listbox"
      role="listbox"
      aria-label={query ? `People matching @${query}` : 'Mention someone'}
      className="absolute bottom-full left-0 right-0 z-50 mb-2 nb-card bg-white p-1.5 shadow-nb-lg max-h-[38dvh] overflow-y-auto overscroll-contain min-w-0"
    >
      {query === '' ? (
        <p className="px-3 py-2.5 text-sm font-body text-gray-500 flex items-center gap-2">
          <AtSign size={15} strokeWidth={2.5} className="text-nb-violet shrink-0" />
          Keep typing to find people…
        </p>
      ) : loading && items.length === 0 ? (
        <p className="px-3 py-2.5 text-sm font-body text-gray-500 flex items-center gap-2" aria-live="polite">
          <Loader2 size={15} strokeWidth={2.5} className="animate-spin text-nb-violet shrink-0" />
          Searching…
        </p>
      ) : failed ? (
        <p className="px-3 py-2.5 text-sm font-body text-gray-500">
          Couldn't search right now — check your connection and keep typing.
        </p>
      ) : items.length === 0 ? (
        <p className="px-3 py-2.5 text-sm font-body text-gray-500">
          No one matches <span className="font-semibold text-ink">@{query}</span>
        </p>
      ) : (
        <ul className="list-none p-0 m-0">
          {items.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === highlight} id={`mention-option-${i}`}>
              {/* onMouseDown (not onClick): fires before input blur, so the
                  caret context survives the pick on touch devices. */}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(u);
                }}
                onMouseEnter={() => onHighlight(i)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[44px] text-left transition-colors min-w-0 ${
                  i === highlight ? 'bg-nb-yellow/40' : 'bg-transparent'
                }`}
              >
                <span className="shrink-0">
                  <Avatar
                    src={u.avatarUrl}
                    photoId={u.avatarPhotoId}
                    name={u.displayName || u.username}
                    size="sm"
                  />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-display font-semibold text-sm text-ink truncate">
                    {u.displayName || u.username}
                  </span>
                  <span className="block font-body text-xs text-nb-violet truncate">@{u.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
