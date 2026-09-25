import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Undo2, Trash2 } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, useOpsScope } from './_shared';

/** Campus broadcast: maintenance windows, safety notices, event blasts —
 *  plus the recall list: select past broadcasts and pull them out of every
 *  inbox in one go. */
export default function AdminAnnounce() {
  const { collegeId, isSuper } = useOpsScope();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const past = useQuery({
    queryKey: ['ops-announcements', collegeId],
    queryFn: () => api.get(`/admin/announcements${collegeId ? `?collegeId=${encodeURIComponent(collegeId)}` : ''}`).then((r) => r.data),
  });
  const items: any[] = past?.data?.items || [];
  const removable = items.filter((b) => !b.removed);
  const allChecked = removable.length > 0 && removable.every((b: any) => selected.has(b.id));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ops-announcements'] });
    queryClient.invalidateQueries({ queryKey: ['ops-nav-counts'] });
    setSelected(new Set());
  };

  const send = useMutation({
    mutationFn: () => api.post('/admin/announce', {
      ...(collegeId ? { collegeId } : {}),
      title: title.trim(),
      body: body.trim(),
    }),
    onSuccess: (r: any) => {
      setResult(`Broadcast live — ${r.data?.recipients ?? 0} inboxes.`);
      setTitle('');
      setBody('');
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
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">
            Sending to: {collegeId ? 'selected college' : isSuper ? 'EVERY active user on the network' : 'your college'}
          </p>
          {!collegeId && isSuper && (
            <p className="text-xs text-[#FBBF24]">⚠ No college selected — this reaches the entire network. Narrow scope above for a campus-only blast.</p>
          )}
        </div>
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
            if (!window.confirm(`Send this announcement${collegeId ? '' : ' to EVERYONE'}?`)) return;
            send.mutate();
          }}
          disabled={send.isPending}
          className="px-5 py-2.5 bg-[#FBBF24] text-[#0F172A] text-sm font-black disabled:opacity-50"
        >
          <Megaphone size={15} className="inline mr-1.5" />
          {send.isPending ? 'Sending…' : 'Send broadcast'}
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
          <p className="text-sm text-slate-500">Nothing broadcast yet in this scope.</p>
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
                      aria-label={`Select broadcast: ${b.title}`}
                    />
                  ) : (
                    <Trash2 size={14} className="text-slate-600 shrink-0" aria-label="Already recalled" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-white truncate">{b.title}</span>
                    <span className="block text-xs text-slate-400 truncate">
                      {b.body || '(no body)'}
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {new Date(b.sentAt).toLocaleString()} · {b.scope === 'ALL' ? 'whole network' : 'one campus'} · by @{b.actor?.username || '?'} ·{' '}
                      {b.removed ? 'recalled — no rows remain' : `${b.remaining} rows still in inboxes${b.recipients != null ? ` (sent to ${b.recipients})` : ''}`}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {selected.size > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 bg-[#FBBF24] text-[#0F172A] px-4 py-2.5 text-sm font-bold">
                Recall {selected.size} broadcast{selected.size > 1 ? 's' : ''} — removes rows from every inbox now
                <button
                  onClick={() => { if (window.confirm(`Pull ${selected.size} broadcast(s) out of every inbox? This cannot be undone.`)) recall.mutate(); }}
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
