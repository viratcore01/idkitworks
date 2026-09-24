import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, Building2, Loader2 } from 'lucide-react';
import api from '@/services/api';

export interface CollegeOption {
 id: string;
 name: string;
 shortName?: string | null;
 city?: string | null;
 state?: string | null;
 /** Student-mail domain the OTP flow enforces (may be null = not onboarded). */
 emailDomain?: string | null;
}

interface Props {
  value: CollegeOption | null;
  onChange: (c: CollegeOption | null) => void;
  placeholder?: string;
}

/**
 * Directory-only college picker: typing FILTERS the curated directory so you
 * find your campus fast — it can never create a new one. If your college is
 * genuinely missing, contact support and a moderator will add it.
 */
export default function CollegeSelect({ value, onChange, placeholder = 'Search your college…' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CollegeOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useRef(`college-list-${Math.random().toString(36).slice(2)}`).current;

  // Debounced typeahead against the LIVE directory (name / short name /
  // city, ranked server-side with real enrollment as the tiebreak).
  useEffect(() => {
  if (!open) return;
  const q = query.trim();
  const t = setTimeout(async () => {
  setLoading(true);
  setFailed(false);
  try {
  // Long timeout + retries: Render's free tier sleeps when idle, and the
  // request that wakes it can take 30-50s. Empty results from a cold
  // server must not look like "no colleges exist".
  const { data } = await api.get(`/colleges?q=${encodeURIComponent(q)}&limit=20`, { timeout: 45000 });
  setResults(Array.isArray(data) ? data : []);
  setHighlight(0);
  } catch { setResults([]); setFailed(true); }
  setLoading(false);
  }, 220);
  return () => clearTimeout(t);
  }, [query, open, retryNonce]);

  // Keep the keyboard highlight inside the list as results change.
  useEffect(() => {
  setHighlight((h) => Math.min(h, Math.max(results.length - 1, 0)));
  }, [results.length]);

 // Close on outside click
 useEffect(() => {
 const close = (e: MouseEvent) => {
 if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
 };
 document.addEventListener('mousedown', close);
 return () => document.removeEventListener('mousedown', close);
 }, []);

  const pick = (c: CollegeOption) => {
  onChange(c);
  setQuery('');
  setOpen(false);
  };

  const label = (c: CollegeOption) => c.shortName || c.name;

 return (
 <div ref={boxRef} className="relative">
 {/* Selected chip state */}
 {value && !open ? (
 <button
 type="button"
 onClick={() => setOpen(true)}
 className="nb-input w-full text-left flex items-center justify-between"
 >
 <span className="flex items-center gap-2 min-w-0">
 <Building2 size={16} className="text-nb-violet shrink-0" />
 <span className="truncate">
 <span className="font-semibold">{label(value)}</span>
 {value.shortName && value.name !== value.shortName && (
 <span className="opacity-60 text-sm"> · {value.name}</span>
 )}
 </span>
 </span>
 <span className="text-xs opacity-50 shrink-0 ml-2">change</span>
 </button>
 ) : (
 <div className="relative">
 <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
  <input
  type="text"
  role="combobox"
  aria-expanded={open}
  aria-controls={listId}
  aria-activedescendant={results[highlight] ? `${listId}-${results[highlight].id}` : undefined}
  aria-label={placeholder}
  className="nb-input w-full pl-9"
  placeholder={placeholder}
  value={query}
  onFocus={() => setOpen(true)}
  onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
  onKeyDown={(e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
  else if (e.key === 'Enter' && results[highlight]) { e.preventDefault(); pick(results[highlight]); }
  else if (e.key === 'Escape') { setOpen(false); }
  }}
  autoComplete="off"
  />
 {loading && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
 </div>
 )}

  {/* Dropdown */}
  {open && (
  <div id={listId} role="listbox" aria-label="Matching colleges" className="absolute z-30 left-0 right-0 mt-1 nb-card max-h-72 overflow-y-auto shadow-lg">
  {failed && (
  <div className="px-4 py-3 text-sm">
  <p className="opacity-70">Couldn't reach the college directory. Check your connection.</p>
  <button type="button" onClick={() => { setFailed(false); setRetryNonce((n) => n + 1); }} className="mt-1.5 text-nb-violet font-semibold text-sm">Retry search</button>
  </div>
  )}
  {!failed && results.length > 0 && (
  <p className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wide opacity-50" role="presentation">
  {results.length} match{results.length === 1 ? '' : 'es'}{query.trim() ? '' : ' · popular'}
  </p>
  )}
  {results.length === 0 && !loading && !failed && query.trim().length >= 2 && (
  <p className="px-4 py-3 text-sm opacity-70">
  No match for “{query.trim()}”. Try the city or short name — or pick from the popular list.
  </p>
  )}
  {results.length === 0 && !loading && !failed && query.trim().length > 0 && query.trim().length < 2 && (
  <p className="px-4 py-3 text-sm opacity-60">Keep typing…</p>
  )}
  {results.map((c, i) => (
  <button
  key={c.id}
  id={`${listId}-${c.id}`}
  role="option"
  aria-selected={i === highlight}
  type="button"
  onClick={() => pick(c)}
  onMouseEnter={() => setHighlight(i)}
  className={`w-full text-left px-4 py-2.5 flex items-center gap-2.5 ${i === highlight ? 'bg-nb-violet/10' : ''}`}
  >
 <Building2 size={15} className="text-nb-violet shrink-0" />
 <span className="min-w-0">
 <span className="text-sm font-semibold block truncate">{label(c)}</span>
 <span className="text-xs opacity-60 block truncate">{c.shortName && c.name !== c.shortName ? c.name : ''}{c.city ? `${c.shortName && c.name !== c.shortName ? ' · ' : ''}${c.city}${c.state ? ', ' + c.state : ''}` : ''}</span>
 </span>
 <MapPin size={12} className="ml-auto opacity-30 shrink-0" />
  </button>
  ))}
  </div>
  )}
  </div>
  );
}
