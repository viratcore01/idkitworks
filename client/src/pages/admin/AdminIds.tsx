import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, InitialAvatar, useOpsScope } from './_shared';

/** Student-ID review with bulk decisions for spam waves. */
export default function AdminIds() {
  const { withCollege, collegeId } = useOpsScope();
  const queryClient = useQueryClient();
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const queueKey = withCollege('/verification/queue');
  const { data, isLoading } = useQuery({
    queryKey: ['ops-ids', queueKey],
    queryFn: () => api.get(queueKey).then((r) => r.data),
  });

  useQuery({
    queryKey: ['ops-id-images', (data?.items || []).map((i: any) => i.id).join(',')],
    enabled: !!data?.items?.length,
    queryFn: async () => {
      const entries: Record<string, string> = {};
      for (const item of data!.items) {
        try {
          const res = await api.get(item.imageUrl.replace('/api/', '/'), { responseType: 'blob' });
          entries[item.id] = URL.createObjectURL(res.data);
        } catch { /* already decided */ }
      }
      setImgs(entries);
      return entries;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ops-ids'] });
    queryClient.invalidateQueries({ queryKey: ['ops-nav-counts'] });
    setSelected(new Set());
    setError('');
  };

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api.patch(`/verification/${id}/decide`, { approve }),
    onSuccess: refresh,
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not save decision'),
  });

  const bulk = useMutation({
    mutationFn: (approve: boolean) => api.patch('/verification/bulk', { ids: Array.from(selected), approve }),
    onSuccess: refresh,
    onError: (e: any) => setError(e?.response?.data?.error || 'Bulk decision failed'),
  });

  if (isLoading) return <p className="text-slate-400 text-sm p-8">Loading queue…</p>;
  const items: any[] = data?.items || [];
  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">ID reviews</h1>
          <p className="text-sm text-slate-400">{data?.total ?? 0} pending · photos erased on decision</p>
        </div>
        <div className="ml-auto"><ScopeSelect /></div>
      </div>

      {selected.size > 0 && (
        <div className="bg-[#FBBF24] text-[#0F172A] px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 text-sm font-bold">
          {selected.size} selected
          <button onClick={() => bulk.mutate(true)} disabled={bulk.isPending} className="ml-2 px-3 py-1 bg-[#0F172A] text-white text-xs font-bold">Verify all</button>
          <button onClick={() => bulk.mutate(false)} disabled={bulk.isPending} className="px-3 py-1 border-2 border-[#0F172A] text-xs font-bold">Reject all</button>
          <button onClick={() => setSelected(new Set())} className="underline text-xs font-semibold">clear</button>
        </div>
      )}

      {error && <p className="bg-[#151D31] border border-[#F43F5E] text-[#F43F5E] p-3 mb-4 text-sm">{error}</p>}

      {items.length === 0 ? (
        <p className="text-slate-400 text-sm bg-[#151D31] border border-white/10 p-8 text-center">Queue is clear. Nothing waiting for review.</p>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)))} className="w-4 h-4 accent-[#FBBF24]" />
            Select all on this page
          </label>
          {items.map((item: any) => (
            <div key={item.id} className="bg-[#151D31] border border-white/10 p-4 flex flex-col sm:flex-row gap-4">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })}
                className="w-4 h-4 accent-[#FBBF24] mt-1"
                aria-label={`Select ${item.user.username}`}
              />
              <div className="sm:w-52 shrink-0">
                {imgs[item.id]
                  ? <img src={imgs[item.id]} alt="Student ID" className="w-full object-contain max-h-40 bg-black/40" />
                  : <div className="w-full h-40 bg-black/40 flex items-center justify-center text-xs text-slate-500 text-center px-2">Image unavailable — already decided</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <InitialAvatar name={item.user.displayName} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate text-white">{item.user.displayName}</p>
                    <p className="text-xs text-slate-400 truncate">@{item.user.username} · {item.user.college?.shortName || item.user.college?.name}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2">Submitted {new Date(item.submittedAt).toLocaleString()}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => decide.mutate({ id: item.id, approve: true })} disabled={decide.isPending} className="flex-1 py-2 text-sm font-bold bg-[#10B981] text-[#0F172A]">
                    <Check size={16} className="inline mr-1" /> Verify
                  </button>
                  <button onClick={() => decide.mutate({ id: item.id, approve: false })} disabled={decide.isPending} className="flex-1 py-2 text-sm font-bold border border-white/25 text-slate-200 hover:border-white">
                    <X size={16} className="inline mr-1" /> Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-4">Scope: {collegeId || 'all colleges you may moderate'} · decisions are final and logged.</p>
    </div>
  );
}
