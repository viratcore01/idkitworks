import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, GitMerge, AlertTriangle, Plus } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, useOpsScope } from './_shared';
import { useAuthStore } from '@/store/auth.store';

/**
 * Campus directory control: live stats per college, duplicate detection,
 * and supreme-only merging. This is how the directory stays real instead
 * of rotting into junk rows.
 */
export default function AdminColleges() {
  const { user } = useAuthStore();
  const { withCollege, collegeId } = useOpsScope();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState('');
  const [mergeFrom, setMergeFrom] = useState<any>(null);
  const isSuper = user?.role === 'super_admin';

  const onSearch = (v: string) => {
    setQ(v);
    window.clearTimeout((onSearch as any)._t);
    (onSearch as any)._t = window.setTimeout(() => setDebounced(v), 400);
  };

  const listPath = withCollege(`/admin/colleges${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`);
  const { data, isLoading } = useQuery({
    queryKey: ['ops-colleges-list', listPath],
    queryFn: () => api.get(listPath).then((r) => r.data),
  });

  const { data: dups } = useQuery({
    queryKey: ['ops-college-dups'],
    queryFn: () => api.get('/admin/colleges/duplicates').then((r) => r.data),
    enabled: isSuper,
  });

  const merge = useMutation({
    mutationFn: ({ fromId, toId }: { fromId: string; toId: string }) =>
      api.post('/admin/colleges/merge', { fromId, toId }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ['ops-colleges-list'] });
      queryClient.invalidateQueries({ queryKey: ['ops-college-dups'] });
      queryClient.invalidateQueries({ queryKey: ['ops-overview'] });
      setMergeFrom(null);
      setError('');
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Merge failed'),
  });

  const colleges: any[] = data?.colleges || [];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">Colleges</h1>
          <p className="text-sm text-slate-400">{data?.total ?? 0} campuses · directory health</p>
        </div>
        <div className="ml-auto"><ScopeSelect /></div>
      </div>

      <div className="relative max-w-md mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search the directory…"
          className="w-full bg-[#151D31] border border-white/20 pl-9 pr-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-500"
          aria-label="Search colleges"
        />
      </div>

      {isSuper && <AddCollegeForm />}

      {error && <p className="bg-[#151D31] border border-[#F43F5E] text-[#F43F5E] p-3 mb-4 text-sm">{error}</p>}

      {isSuper && (dups?.groups || []).length > 0 && (
        <div className="bg-[#151D31] border border-[#FBBF24] p-4 mb-4">
          <h2 className="font-display font-bold text-white mb-1 flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#FBBF24]" /> {dups.totalGroups} duplicate groups
          </h2>
          <p className="text-xs text-slate-400 mb-3">Same campus, multiple rows — students split across them. Merge folds everyone into the surviving campus.</p>
          <div className="space-y-3">
            {(dups.groups || []).slice(0, 8).map((g: any) => (
              <div key={g.key} className="border border-white/10 p-3">
                <p className="text-[11px] uppercase tracking-widest text-slate-500 font-bold mb-2">“{g.key}”</p>
                <div className="flex flex-wrap gap-2">
                  {g.colleges.map((c: any) => (
                    <span key={c.id} className={`text-xs px-2.5 py-1.5 border ${mergeFrom?.id === c.id ? 'border-[#FBBF24] text-white' : 'border-white/15 text-slate-300'}`}>
                      <b>{c.shortName || c.name}</b> · {c.users} users{c.city ? ` · ${c.city}` : ' · no city'}
                    </span>
                  ))}
                </div>
                <DuplicateMergeRow
                  group={g}
                  mergeFrom={mergeFrom}
                  setMergeFrom={setMergeFrom}
                  onMerge={(toId) => {
                    if (!mergeFrom) return;
                    if (!window.confirm(`Merge "${mergeFrom.name}" INTO the selected campus? ${mergeFrom.users || 0} students move. This cannot be undone.`)) return;
                    merge.mutate({ fromId: mergeFrom.id, toId });
                  }}
                  busy={merge.isPending}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? <p className="text-slate-400 text-sm p-8">Loading directory…</p> : (
        <div className="bg-[#151D31] border border-white/10 divide-y divide-white/10">
          {colleges.map((c: any) => (
            <CollegeRow
              key={c.id}
              c={c}
              isSuper={isSuper}
              mergeFrom={mergeFrom}
              setMergeFrom={setMergeFrom}
            />
          ))}
          {colleges.length === 0 && <p className="px-4 py-6 text-sm text-slate-500 text-center">No campuses match.</p>}
        </div>
      )}
      {mergeFrom && <MergeTargetBar mergeFrom={mergeFrom} onPick={(toId) => {
        if (!window.confirm(`Merge "${mergeFrom.name}" INTO the selected campus? ${mergeFrom.users || 0} students move. This cannot be undone.`)) return;
        merge.mutate({ fromId: mergeFrom.id, toId });
      }} onCancel={() => setMergeFrom(null)} busy={merge.isPending} />}
      <p className="text-[11px] text-slate-500 mt-4">Scope: {collegeId || 'all colleges you may moderate'} · merges are audit-logged and irreversible.</p>
    </div>
  );
}

/** Inside a duplicate group: pick the survivor, merge the marked source in. */
function DuplicateMergeRow({ group, mergeFrom, setMergeFrom, onMerge, busy }: {
  group: any; mergeFrom: any; setMergeFrom: (c: any) => void; onMerge: (toId: string) => void; busy: boolean;
}) {
  const [survivor, setSurvivor] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2.5">
      <select
        value={survivor}
        onChange={(e) => setSurvivor(e.target.value)}
        className="bg-[#0B1120] border border-white/20 px-2 py-1.5 text-xs outline-none focus:border-[#FBBF24] max-w-[260px]"
        aria-label="Campus that survives the merge"
      >
        <option value="">Survivor campus…</option>
        {group.colleges.map((c: any) => (
          <option key={c.id} value={c.id}>{c.shortName || c.name} ({c.users} users)</option>
        ))}
      </select>
      {group.colleges.filter((c: any) => c.id !== survivor).map((c: any) => (
        <button
          key={c.id}
          disabled={busy || !survivor}
          onClick={() => { setMergeFrom({ id: c.id, name: c.shortName || c.name, users: c.users }); onMerge(survivor); }}
          className="text-[11px] px-2 py-1.5 bg-[#F43F5E] text-white font-bold disabled:opacity-40"
          title={`Fold "${c.shortName || c.name}" into the survivor`}
        >
          Fold “{c.shortName || c.name}” in
        </button>
      ))}
    </div>
  );
}

/** One directory row: domain badge + supreme-only inline domain editing.
 * A campus without a domain blocks every student at OTP verify, so the
 * missing-domain state is loud (red) and fixable right here. */
function CollegeRow({ c, isSuper, mergeFrom, setMergeFrom }: {
  c: any; isSuper: boolean; mergeFrom: any; setMergeFrom: (c: any) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [domain, setDomain] = useState(c.emailDomain || '');
  const [msg, setMsg] = useState('');

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/colleges/${c.id}`, { emailDomain: domain.trim() === '' ? null : domain.trim().toLowerCase() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-colleges-list'] });
      setEditing(false);
      setMsg('');
    },
    onError: (e: any) => setMsg(e?.response?.data?.error || 'Could not save domain'),
  });

  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <p className="font-bold text-white">{c.shortName || c.name}</p>
          {c.shortName && <p className="text-xs text-slate-500 truncate">{c.name}</p>}
          <p className="text-xs text-slate-500">{[c.city, c.state].filter(Boolean).join(', ') || 'no location'}</p>
        </div>
        <span className="text-xs text-slate-300">{c.users} users</span>
        {c.emailDomain
          ? <span className="text-[11px] px-2 py-0.5 border border-white/20 text-slate-300">@{c.emailDomain}</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 bg-[#F43F5E] text-white">NO DOMAIN — OTP blocked</span>}
        {c.pendingVerifications > 0 && <span className="text-[11px] font-bold px-2 py-0.5 bg-[#FBBF24] text-[#0F172A]">{c.pendingVerifications} unverified</span>}
        {c.banned > 0 && <span className="text-[11px] font-bold px-2 py-0.5 bg-[#F43F5E] text-white">{c.banned} banned</span>}
        {isSuper && !editing && (
          <button
            onClick={() => { setDomain(c.emailDomain || ''); setMsg(''); setEditing(true); }}
            className="text-[11px] px-2 py-1 border border-white/20 text-slate-400 font-bold"
            title="Set the student email domain"
          >
            {c.emailDomain ? 'edit domain' : 'set domain'}
          </button>
        )}
        {isSuper && (
          <button
            onClick={() => setMergeFrom(mergeFrom?.id === c.id ? null : { id: c.id, name: c.shortName || c.name, users: c.users })}
            className={`text-[11px] px-2 py-1 border font-bold ${mergeFrom?.id === c.id ? 'border-[#FBBF24] text-white' : 'border-white/20 text-slate-400'}`}
            title="Mark as merge source"
          >
            <GitMerge size={11} className="inline mr-1" />{mergeFrom?.id === c.id ? 'source ✓' : 'merge…'}
          </button>
        )}
      </div>
      {isSuper && editing && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. ipec.org.in (empty = clear)"
            className="bg-[#0B1120] border border-white/20 px-2 py-1.5 text-xs outline-none focus:border-[#FBBF24] placeholder:text-slate-600 min-w-[220px]"
            aria-label={`Email domain for ${c.shortName || c.name}`}
          />
          <button onClick={() => save.mutate()} disabled={save.isPending} className="text-[11px] px-3 py-1.5 bg-[#FBBF24] text-[#0F172A] font-bold disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setEditing(false); setMsg(''); }} className="text-[11px] px-2 py-1.5 border border-white/25 text-slate-300">Cancel</button>
          {msg && <span className="text-[11px] text-[#F43F5E]">{msg}</span>}
        </div>
      )}
    </div>
  );
}

/** Supreme-only directory curation: students can no longer mint colleges,
 * so missing campuses get added here — with city and short name included. */
function AddCollegeForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [msg, setMsg] = useState('');

  const add = useMutation({
    mutationFn: () => api.post('/colleges', {
      name: name.trim(),
      ...(shortName.trim() && { shortName: shortName.trim() }),
      ...(city.trim() && { city: city.trim() }),
      ...(state.trim() && { state: state.trim() }),
      ...(emailDomain.trim() && { emailDomain: emailDomain.trim().toLowerCase() }),
    }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ['ops-colleges-list'] });
      queryClient.invalidateQueries({ queryKey: ['ops-college-dups'] });
      setMsg(r.data?.deduped ? 'Already in the directory — no duplicate created.' : 'College added to the directory.');
      setName(''); setShortName(''); setCity(''); setState(''); setEmailDomain('');
    },
    onError: (e: any) => setMsg(e?.response?.data?.error || 'Could not add college'),
  });

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); setMsg(''); }} className="mb-4 text-xs px-3 py-2 bg-[#FBBF24] text-[#0F172A] font-bold">
        <Plus size={13} className="inline mr-1" /> Add a campus
      </button>
    );
  }
  return (
    <div className="bg-[#151D31] border border-[#FBBF24] p-4 mb-4 max-w-xl">
      <p className="text-xs text-slate-400 mb-3">New campuses go live for every signup the moment you add them. Set the student email domain — without it, OTP verification stays blocked. Duplicates are blocked automatically.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *" className="bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600 sm:col-span-2" aria-label="College full name" />
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Short name (e.g. IIT Delhi)" className="bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600" aria-label="Short name" />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600" aria-label="City" />
        <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" className="bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600" aria-label="State" />
        <input value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} placeholder="Student email domain * (e.g. ipec.org.in)" className="bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600 sm:col-span-2" aria-label="Student email domain" />
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => add.mutate()} disabled={add.isPending || name.trim().length < 4} className="text-xs px-4 py-2 bg-[#FBBF24] text-[#0F172A] font-bold disabled:opacity-50">
          {add.isPending ? 'Adding…' : 'Add campus'}
        </button>
        <button onClick={() => { setOpen(false); setMsg(''); }} className="text-xs px-3 py-2 border border-white/25 text-slate-300">Cancel</button>
      </div>
      {msg && <p className="text-xs mt-2 text-slate-300">{msg}</p>}
    </div>
  );
}
/** Sticky bar when a merge source is marked from the directory list. */
function MergeTargetBar({ mergeFrom, onPick, onCancel, busy }: {
  mergeFrom: any; onPick: (toId: string) => void; onCancel: () => void; busy: boolean;
}) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['ops-merge-target', q],
    queryFn: () => api.get(`/colleges?q=${encodeURIComponent(q)}&limit=6`).then((r) => r.data),
    enabled: q.trim().length >= 2,
  });
  const options: any[] = Array.isArray(data) ? data : [];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#FBBF24] text-[#0F172A] px-4 py-3">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-2 text-sm font-bold">
        <GitMerge size={15} /> Merging “{mergeFrom.name}” into…
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type the surviving campus…"
          className="bg-[#0F172A] text-white px-3 py-1.5 text-sm outline-none placeholder:text-slate-500 min-w-[220px]"
          aria-label="Surviving campus"
        />
        {options.filter((c: any) => c.id !== mergeFrom.id).slice(0, 4).map((c: any) => (
          <button key={c.id} disabled={busy} onClick={() => onPick(c.id)} className="px-3 py-1.5 bg-[#0F172A] text-white text-xs font-bold disabled:opacity-50">
            {c.shortName || c.name}
          </button>
        ))}
        <button onClick={onCancel} className="underline text-xs font-semibold ml-auto">cancel</button>
      </div>
    </div>
  );
}
