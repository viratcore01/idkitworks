import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, useOpsScope } from './_shared';

/** Proactive sweep: newest content in scope, takedown without waiting. */
export default function AdminContent() {
  const { withCollege, collegeId } = useOpsScope();
  const queryClient = useQueryClient();
  const [type, setType] = useState('post');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const path = withCollege(`/admin/content?type=${type}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const { data, isLoading } = useQuery({
    queryKey: ['ops-content', path],
    queryFn: () => api.get(path).then((r) => r.data),
  });

  const remove = useMutation({
    mutationFn: (item: any) => api.delete(`/admin/content/${type}/${item.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-content'] });
      setError('');
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not delete'),
  });

  const items: any[] = data?.items || [];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">Content sweep</h1>
          <p className="text-sm text-slate-400">{data?.total ?? 0} items in scope · newest first</p>
        </div>
        <div className="ml-auto"><ScopeSelect /></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex border border-white/25 text-sm font-semibold">
          {(['post', 'comment'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`px-4 py-2 capitalize ${type === t ? 'bg-[#FBBF24] text-[#0F172A]' : 'text-slate-300'}`}>
              {t}s
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search content text…" className="w-full bg-[#151D31] border border-white/20 pl-9 pr-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-500" aria-label="Search content" />
        </div>
      </div>

      {error && <p className="bg-[#151D31] border border-[#F43F5E] text-[#F43F5E] p-3 mb-4 text-sm">{error}</p>}

      {isLoading ? <p className="text-slate-400 text-sm p-8">Scanning…</p> : items.length === 0 ? (
        <p className="text-slate-400 text-sm bg-[#151D31] border border-white/10 p-8 text-center">Nothing here.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item: any) => (
            <div key={item.id} className="bg-[#151D31] border border-white/10 p-4">
              <p className="text-sm whitespace-pre-wrap break-words text-slate-100">{item.content}</p>
              <p className="text-xs text-slate-500 mt-2">
                @{item.author?.username} · {item.author?.college?.shortName || item.author?.college?.name || ''} · {new Date(item.createdAt).toLocaleString()}
                {type === 'post' ? ` · ${item._count?.likes || 0} likes · ${item._count?.comments || 0} comments` : ` · on: ${(item.post?.content || '').slice(0, 60)}`}
              </p>
              <button
                onClick={() => { if (window.confirm('Take down this content? It disappears for everyone immediately.')) remove.mutate(item); }}
                disabled={remove.isPending}
                className="text-xs px-3 py-1.5 mt-3 bg-[#F43F5E] text-white font-bold"
              >
                <Trash2 size={13} className="inline mr-1" /> Take down
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-4">Scope: {collegeId || 'all colleges you may moderate'} · takedowns are audit-logged.</p>
    </div>
  );
}
