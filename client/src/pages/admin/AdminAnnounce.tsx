import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, useOpsScope } from './_shared';

/** Campus broadcast: maintenance windows, safety notices, event blasts. */
export default function AdminAnnounce() {
  const { collegeId, isSuper } = useOpsScope();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

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
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error || 'Could not send announcement');
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
    </div>
  );
}
