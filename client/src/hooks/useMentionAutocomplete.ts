import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { findMentionQuery, applyMention } from '@/utils/mentions';

export interface MentionSuggestion {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  avatarPhotoId?: string | null;
}

/**
 * @mention autocomplete for a text input/textarea — the Instagram-style
 * "type @, pick a person" flow.
 *
 * Standard algorithm: detect the @token at the caret → debounce a prefix
 * search (`GET /api/search`, same-college users only) → keyboard/tap to
 * pick → splice `@username ` back in and restore the caret.
 *
 * Mobile safety (the failure mode this is designed around): the panel is
 * rendered ABOVE the field (`bottom-full`, absolute — it never pushes
 * layout, never sits under the keyboard, never overlaps the text being
 * typed), capped to a viewport-relative height with its own scroll, and
 * rows are full-width tap targets. An empty/short query never fires a
 * request; a failed request degrades to a hint, never a stuck spinner.
 */
export function useMentionAutocomplete(opts: {
  value: string;
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onChange: (next: string) => void;
}) {
  const { value, inputRef, onChange } = opts;
  const [token, setToken] = useState<{ query: string; start: number } | null>(null);
  const [items, setItems] = useState<MentionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);

  const open = token !== null;

  /**
   * Re-read the @token at the caret. Pass the fresh text+caret from an
   * onChange event (the `value` closure is still pre-update there);
   * otherwise the live DOM + current value are used (clicks, key-ups).
   */
  const sync = useCallback(
    (text?: string, caret?: number) => {
      const el = inputRef.current;
      const v = text ?? value;
      const c = caret ?? el?.selectionStart ?? v.length;
      setToken(findMentionQuery(v, c));
      setHighlight(0);
    },
    [inputRef, value],
  );

  // The caret can move without the value changing (arrow keys, taps) — the
  // parent forwards onSelect/onClick/onKeyUp here via `sync`.
  useEffect(() => {
    // After every value change the token may have appeared/vanished, but
    // the caret position is only trustworthy once the DOM has it; parents
    // call sync() from their change/click/keyup handlers, so this effect
    // only handles the case where `value` was reset externally (e.g. after
    // a successful post clears the composer).
    if (value === '') setToken(null);
  }, [value]);

  // Debounced user search for the live @query.
  useEffect(() => {
    if (!token || token.query === '') {
      setItems([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    const q = token.query;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(async () => {
      const id = ++requestId.current;
      try {
        const { data } = await api.get('/search', { params: { q } });
        if (requestId.current !== id) return; // stale keystroke — drop it
        const users: MentionSuggestion[] = (data?.users || []).slice(0, 6);
        setItems(users);
        setHighlight(0);
      } catch {
        if (requestId.current !== id) return;
        setItems([]);
        setFailed(true);
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [token?.query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss on outside tap/click (the panel is temporary chrome over the
  // feed behind it — it must never trap the user).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setToken(null);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open ]);

  const close = useCallback(() => setToken(null), []);

  const pick = useCallback(
    (user: MentionSuggestion) => {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? value.length;
      const live = findMentionQuery(value, caret) ?? token;
      if (!live) return;
      const next = applyMention(value, live.start, caret, user.username);
      onChange(next.text);
      setToken(null);
      // Restore focus + caret after React flushes the new value.
      setTimeout(() => {
        const node = inputRef.current;
        if (!node) return;
        node.focus();
        try {
          node.setSelectionRange(next.caret, next.caret);
        } catch {
          /* non-text inputs never reach here */
        }
      }, 0);
    },
    [inputRef, onChange, token, value],
  );

  /**
   * Key handling. Returns true when the keystroke was consumed (caller must
   * skip its own handling — notably Enter-to-send in the comment box).
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        setToken(null);
        return true;
      }
      if (items.length === 0) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(items[highlight] ?? items[0]);
        return true;
      }
      return false;
    },
    [open, items, highlight, pick],
  );

  return {
    containerRef,
    open,
    query: token?.query ?? '',
    items,
    loading,
    failed,
    highlight,
    setHighlight,
    pick,
    close,
    sync,
    handleKeyDown,
  };
}
