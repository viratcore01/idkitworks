import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Undo2, Trash2, User, Users, X } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, InitialAvatar, useOpsScope } from './_shared';

/** Campus broadcast (maintenance, safety, events) — or a direct announcement
 *  to ONE user. Past broadcasts (blasts and directs alike) can be selected
 *  and recalled, pulling their rows out of every inbox in one go. */
export default function AdminAnnounce() {
  const { collegeId, isSuper } = useOpsScope();
  const queryClient = useQueryClient();
  const [audience, setAudience] = useState<'everyone' | 'one'>('everyone');
  const [picked, setPicked] = useState<{ id: string; username: string; displayName: string; college?: { shortName?: string | null } } | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const past = useQuery({
    queryKey: ['ops-announcements', collegeId],
    queryFn: () => api.get(`/admin/announcements${collegeId ? `?collegeId=${encodeURIComponent(collegeId)}` : ''}`).then((r) => r.data),
  });
  const items: any[] = past?.data?.items || [];
  const removable = items.filter((b) => !b.removed);
  const allChecked = removable.length > 0 && removable.every((b: any) => selected.has(b.id));

  // User picker (direct mode): same directory the Ctrl+K palette uses.
  const results = useQuery({
    queryKey: ['ops-announce-user-search', debounced],
    queryFn: () => api.get(`/admin/users?q=${encodeURIComponent(debounced)}&limit=6`).then((r) => r.data),
    enabled: audience === 'one' && debounced.trim().length >= 2 && !picked,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ops-announcements'] });
    queryClient.invalidateQueries({ queryKey: ['ops-nav-counts'] });
    setSelected(new Set());
  };

  const send = useMutation({
    mutationFn: () => api.post('/admin/announce', {
      ...(collegeId && audience === 'everyone' ? { collegeId } : {}),
      ...(audience === 'one' && picked ? { userId: picked.id } : {}),
      title: title.trim(),
      body: body.trim(),
    }),
    onSuccess: (r: any) => {
      setResult(r.data?.direct
        ? `Sent directly to @${picked?.username} — one inbox.`
        : `Broadcast live — ${r.data?.recipients ?? 0} inboxes.`);
      setTitle('');
      setBody('');
      setPicked(null);
      setSearch('');
      setError('');
      refresh();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error || 'Could not send announcement');
      setResult('');
    },
  });

  const recall = useMutation({
    mutationFn: () => api.post('/admin/announcements/remove', { ids: Array.from(selected) }),
    onSuccess: (r: any) => {
      setResult(`Recalled — ${r.data?.removed ?? 0} notification rows removed from inboxes.`);
      setError('');
      refresh();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error || 'Could not recall broadcasts');
      setResult('');
    },
  });

  const canSend = Boolean(title.trim() && body.trim() && (audience === 'everyone' || picked));

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">Announce</h1>
          <p className="text-sm text-slate-400">Broadcast to every active inbox in scope · 5-minute cooldown per campus</p>
        </div>
        <div className="ml-auto"><ScopeSelect /></div>
      </div>

      <div className="bg-[#151D31] border border-white/10 p-5 space-y-4">
        {/* Audience: everyone in scope, or exactly one user */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">Audience</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setAudience('everyone'); setPicked(null); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border ${audience === 'everyone' ? 'bg-[#FBBF24] text-[#0F172A] border-[#FBBF24]' : 'border-white/20 text-slate-300 hover:border-white'}`}
            >
              <Users size={14} /> Everyone {collegeId ? 'in campus' : isSuper ? 'on network' : 'in campus'}
            </button>
            <button
              type="button"
              onClick={() => setAudience('one')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border ${audience === 'one' ? 'bg-[#FBBF24] text-[#0F172A] border-[#FBBF24]' : 'border-white/20 text-slate-300 hover:border-white'}`}
            >
              <User size={14} /> One user
            </button>
          </div>
          {audience === 'everyone' && !collegeId && isSuper && (
            <p className="text-xs text-[#FBBF24] mt-2">⚠ No college selected — this reaches the entire network. Narrow scope above for a campus-only blast.</p>
          )}
        </div>

        {/* Direct mode: search + pick the recipient */}
        {audience === 'one' && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">Recipient</p>
            {picked ? (
              <span className="inline-flex items-center gap-2 bg-[#0B1120] border border-[#FBBF24] px-3 py-2 text-sm">
                <InitialAvatar name={picked.displayName || picked.username} size="sm" />
                <span className="font-bold text-white">{picked.displayName || picked.username}</span>
                <span className="text-slate-400">@{picked.username}</span>
                {picked.college?.shortName && <span className="text-xs text-slate-500">{picked.college.shortName}</span>}
                <button type="button" onClick={() => setPicked(null)} aria-label="Change recipient" className="text-slate-400 hover:text-white">
                  <X size={14} />
                </button>
              </span>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, @username or email…"
                  aria-label="Search for the user to message directly"
                  className="w-full bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600"
                />
                {results.isFetching && <p className="text-xs text-slate-500 mt-1.5">Searching…</p>}
                {(results.data?.users || []).length > 0 && (
                  <div className="border border-white/10 divide-y divide-white/10 mt-1.5 max-h-56 overflow-y-auto">
                    {(results.data?.users || []).map((u: any) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => { setPicked({ id: u.id, username: u.username, displayName: u.displayName, college: u.college }); setSearch(''); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-white/10 text-left"
                      >
                        <InitialAvatar name={u.displayName || u.username} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-semibold text-white truncate">{u.displayName || u.username} <span className="font-normal text-slate-400">@{u.username}</span></span>
                          <span className="block text-xs text-slate-500 truncate">{u.college?.shortName || u.college?.name || 'no college'} · {u.isActive ? u.verificationStatus : 'BANNED'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {debounced.trim().length >= 2 && !results.isFetching && (results.data?.users || []).length === 0 && (
                  <p className="text-xs text-slate-500 mt-1.5">No users match “{debounced}”.</p>
                )}
              </>
            )}
          </div>
        )}

        <div>
          <label htmlFor="anc-title" className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">Title ({title.length}/120)</label>
          <input
            id="anc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder="Maintenance tonight 2–3am"
            className="w-full bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600"
          />
        </div>
        <div>
          <label htmlFor="anc-body" className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">Message ({body.length}/500)</label>
          <textarea
            id="anc-body"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 500))}
            placeholder="Chat will be briefly unavailable while we upgrade the servers…"
            rows={4}
            className="w-full bg-[#0B1120] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-600 resize-none"
          />
        </div>
        <button
          onClick={() => {
            if (!title.trim() || !body.trim()) { setError('Title and message are required'); return; }
            if (audience === 'one' && !picked) { setError('Pick the user who should receive this'); return; }
            const where = audience === 'one' ? `directly to @${picked?.username}` : collegeId ? 'to the selected campus' : isSuper ? 'to EVERYONE' : 'to your campus';
            if (!window.confirm(`Send this announcement ${where}?`)) return;
            send.mutate();
          }}
          disabled={send.isPending || !canSend}
          className="px-5 py-2.5 bg-[#FBBF24] text-[#0F172A] text-sm font-black disabled:opacity-50"
        >
          <Megaphone size={15} className="inline mr-1.5" />
          {send.isPending ? 'Sending…' : audience === 'one' ? 'Send directly' : 'Send broadcast'}
        </button>
        {result && <p className="text-sm text-[#10B981] font-semibold">{result}</p>}
        {error && <p className="text-sm text-[#F43F5E] font-semibold">{error}</p>}
      </div>

      {/* ── Past broadcasts: select + recall ─────────────────────────── */}
      <div className="bg-[#151D31] border border-white/10 p-5 mt-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-display font-bold text-white">Past broadcasts</h2>
          <span className="text-xs text-slate-500">select, then recall — rows leave every inbox at once</span>
        </div>

        {past.isLoading ? (
          <p className="text-sm text-slate-400">Loading history…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing sent yet in this scope.</p>
        ) : (
          <>
            {removable.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(removable.map((b: any) => b.id)))}
                  className="w-4 h-4 accent-[#FBBF24]"
                />
                Select all ({removable.length})
              </label>
            )}
            <div className="space-y-2">
              {items.map((b: any) => (
                <div key={b.id} className={`border p-3 flex flex-wrap items-center gap-2.5 text-sm ${b.removed ? 'border-white/10 opacity-60' : 'border-white/10'}`}>
                  {!b.removed ? (
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}
                      className="w-4 h-4 accent-[#FBBF24]"
                      aria-label={`Select announcement: ${b.title}`}
                    />
                  ) : (
                    <Trash2 size={14} className="text-slate-600 shrink-0" aria-label="Already recalled" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-white truncate">
                      {b.title}
                      {b.direct && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-[#FBBF24] border border-[#FBBF24] px-1.5 py-0.5 align-middle">direct → @{b.directTo || '?'}</span>}
                    </span>
                    <span className="block text-xs text-slate-400 truncate">{b.body || '(no body)'}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {new Date(b.sentAt).toLocaleString()} · {b.direct ? 'one inbox' : b.scope === 'ALL' ? 'whole network' : 'one campus'} · by @{b.actor?.username || '?'} ·{' '}
                      {b.removed ? 'recalled — no rows remain' : `${b.remaining} row${b.remaining === 1 ? '' : 's'} still in inbox${b.remaining === 1 ? '' : 'es'}${b.recipients != null && !b.direct ? ` (sent to ${b.recipients})` : ''}`}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {selected.size > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 bg-[#FBBF24] text-[#0F172A] px-4 py-2.5 text-sm font-bold">
                Recall {selected.size} announcement{selected.size > 1 ? 's' : ''} — removes rows from every inbox now
                <button
                  onClick={() => { if (window.confirm(`Pull ${selected.size} announcement(s) out of every inbox? This cannot be undone.`)) recall.mutate(); }}
                  disabled={recall.isPending}
                  className="ml-auto px-3 py-1.5 bg-[#0F172A] text-white text-xs font-black flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Undo2 size={13} /> {recall.isPending ? 'Recalling…' : 'Recall now'}
                </button>
                <button onClick={() => setSelected(new Set())} className="underline text-xs font-semibold">clear</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
