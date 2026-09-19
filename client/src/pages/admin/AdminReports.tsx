import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2, Ban, Download } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, downloadCsv, useOpsScope } from './_shared';

/** Report triage: filter, one-click actions, bulk clear. */
export default function AdminReports() {
  const { withCollege, collegeId } = useOpsScope();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const listPath = withCollege(`/admin/reports${status ? `?status=${status}` : ''}`);
  const { data, isLoading } = useQuery({
    queryKey: ['ops-reports', listPath],
    queryFn: () => api.get(listPath).then((r) => r.data),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ops-reports'] });
    queryClient.invalidateQueries({ queryKey: ['ops-nav-counts'] });
    setSelected(new Set());
    setError('');
  };

  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.patch(`/admin/reports/${id}/resolve`, { action }),
    onSuccess: refresh,
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not resolve report'),
  });

  const bulk = useMutation({
    mutationFn: (action: string) => api.patch('/admin/reports/bulk', { ids: Array.from(selected), action }),
    onSuccess: (r: any) => {
      refresh();
      if (r.data?.failed?.length) setError(`${r.data.failed.length} failed: ${r.data.failed.map((f: any) => f.error).join('; ').slice(0, 200)}`);
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Bulk resolve failed'),
  });

  const act = (id: string, action: string, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    resolve.mutate({ id, action });
  };

  if (isLoading) return <p className="text-slate-400 text-sm p-8">Loading reports…</p>;
  const items: any[] = Array.isArray(data) ? data : [];
  const pending = items.filter((r) => r.status === 'PENDING');
  const allChecked = pending.length > 0 && pending.every((r) => selected.has(r.id));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">Reports</h1>
          <p className="text-sm text-slate-400">{pending.length} pending · one click resolves + acts</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ScopeSelect />
          <button
            onClick={() => downloadCsv('reports.csv', items.map((r: any) => ({ id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, status: r.status, reporter: r.reporter?.username, createdAt: r.createdAt })))}
            className="text-xs px-3 py-2 border border-white/20 text-slate-200 hover:border-[#FBBF24]"
            title="Export visible reports to CSV"
          >
            <Download size={13} className="inline mr-1" /> CSV
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-[#151D31] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24]" aria-label="Filter reports by status">
          <option value="">Pending + resolved</option>
          <option value="PENDING">Pending only</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="bg-[#FBBF24] text-[#0F172A] px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 text-sm font-bold">
          {selected.size} selected
          <button onClick={() => bulk.mutate('dismiss')} disabled={bulk.isPending} className="ml-2 px-3 py-1 bg-[#0F172A] text-white text-xs font-bold">Dismiss all</button>
          <button onClick={() => { if (window.confirm(`Ban the reported users on ${selected.size} reports?`)) bulk.mutate('ban_user'); }} disabled={bulk.isPending} className="px-3 py-1 border-2 border-[#0F172A] text-xs font-bold">Ban all</button>
          <button onClick={() => setSelected(new Set())} className="underline text-xs font-semibold">clear</button>
        </div>
      )}

      {error && <p className="bg-[#151D31] border border-[#F43F5E] text-[#F43F5E] p-3 mb-4 text-sm">{error}</p>}

      {items.length === 0 ? (
        <p className="text-slate-400 text-sm bg-[#151D31] border border-white/10 p-8 text-center">No reports in scope.</p>
      ) : (
        <div className="space-y-3">
          {items.length > 1 && pending.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(pending.map((r) => r.id)))} className="w-4 h-4 accent-[#FBBF24]" />
              Select all pending
            </label>
          )}
          {items.map((r: any) => (
            <div key={r.id} className={`bg-[#151D31] border p-4 ${r.status !== 'PENDING' ? 'border-white/10 opacity-60' : 'border-white/10'}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {r.status === 'PENDING' && (
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                    className="w-4 h-4 accent-[#FBBF24]"
                    aria-label={`Select report ${r.id}`}
                  />
                )}
                <span className="font-display font-bold px-2 py-0.5 bg-white/10 text-xs text-white">{r.targetType}</span>
                <span className="px-2 py-0.5 bg-[#F43F5E]/20 text-[#F43F5E] text-xs font-semibold">{r.reason}</span>
                <span className="text-xs text-slate-400">by @{r.reporter?.username} · {r.reporter?.college?.shortName || r.reporter?.college?.name || ''}</span>
                <span className="text-xs text-slate-500 ml-auto">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              {r.description && <p className="text-sm mt-2 text-slate-200">{r.description}</p>}
              <p className="text-xs text-slate-500 mt-1 truncate font-mono">target: {r.targetId}</p>
              {r.status === 'PENDING' ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button onClick={() => act(r.id, 'dismiss')} disabled={resolve.isPending} className="text-xs px-3 py-1.5 border border-white/25 text-slate-200 font-bold hover:border-white">
                    <Check size={13} className="inline mr-1" /> Dismiss
                  </button>
                  {(r.targetType === 'POST' || r.targetType === 'COMMENT') && (
                    <button
                      onClick={() => act(r.id, 'delete_content', 'Take down this content? It disappears for everyone immediately.')}
                      disabled={resolve.isPending}
                      className="text-xs px-3 py-1.5 bg-[#FBBF24] text-[#0F172A] font-bold"
                    >
                      <Trash2 size={13} className="inline mr-1" /> Delete content
                    </button>
                  )}
                  <button
                    onClick={() => act(r.id, 'ban_user', 'Ban this user? They lose access everywhere immediately (reversible in Users).')}
                    disabled={resolve.isPending}
                    className="text-xs px-3 py-1.5 bg-[#F43F5E] text-white font-bold"
                  >
                    <Ban size={13} className="inline mr-1" /> Ban user
                  </button>
                </div>
              ) : (
                <p className="text-xs mt-2 text-slate-500">Resolved {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : ''}</p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-4">Scope: {collegeId || 'all colleges you may moderate'} · every action is audit-logged.</p>
    </div>
  );
}
