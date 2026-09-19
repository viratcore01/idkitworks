import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, Plus, Building2, Loader2 } from 'lucide-react';
import api from '@/services/api';

export interface CollegeOption {
 id: string;
 name: string;
 shortName?: string | null;
 city?: string | null;
 state?: string | null;
}

interface Props {
 value: CollegeOption | null;
 onChange: (c: CollegeOption | null) => void;
 /** Called after a new college is created server-side */
 onCreated?: (c: CollegeOption) => void;
 placeholder?: string;
}

/**
 * Searchable college picker: type to search a global directory
 * (name / short name / city), pick from results, or add a missing college.
 */
export default function CollegeSelect({ value, onChange, onCreated, placeholder = 'Search your college…' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CollegeOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
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
 setShowAdd(false);
 };

  const addMissing = async () => {
  const name = query.trim();
  if (name.length < 4) return;
  setAdding(true);
  setAddError('');
  try {
  const { data } = await api.post('/colleges', { name }, { timeout: 45000 });
  onCreated?.(data);
  pick(data);
  } catch (e: any) {
  // Surfaces server validation (too generic? duplicate?) right where typed.
  setAddError(e?.response?.data?.error || 'Could not add this college — try again.');
  }
  setAdding(false);
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
  onChange={(e) => { setQuery(e.target.value); setOpen(true); setShowAdd(false); setAddError(''); }}
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
 {results.length === 0 && !loading && query.trim().length >= 4 && (
 <button
 type="button"
 onClick={addMissing}
 disabled={adding}
 className="w-full text-left px-4 py-3 hover:bg-nb-violet/10 flex items-start gap-2.5"
 >
 <Plus size={16} className="text-nb-violet mt-0.5 shrink-0" />
 <span className="text-sm">
 <span className="font-semibold">Add “{query.trim()}”</span>
 <span className="block text-xs opacity-60 mt-0.5">Not in our directory yet — you can add it. You'll verify it with your student ID next.</span>
 </span>
 </button>
 )}
 {results.length === 0 && !loading && query.trim().length > 0 && query.trim().length < 4 && (
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
 {results.length > 0 && (
 <button
 type="button"
 onClick={() => setShowAdd((s) => !s)}
 className="w-full text-left px-4 py-2 text-xs text-nb-violet hover:bg-nb-violet/10 border-t border-dashed"
 >
 <Plus size={12} className="inline mr-1" /> College missing? Add “{query.trim() || 'it'}”
 </button>
 )}
  {showAdd && query.trim().length >= 4 && (
  <button
  type="button"
  onClick={addMissing}
  disabled={adding}
  className="w-full text-left px-4 py-2.5 text-sm hover:bg-nb-violet/10 flex items-center gap-2"
  >
  <Plus size={14} className="text-nb-violet" /> Create “{query.trim()}”
  </button>
  )}
  {addError && <p className="px-4 py-2 text-xs text-nb-pink" role="alert">{addError}</p>}
 </div>
 )}
 </div>
 );
}
