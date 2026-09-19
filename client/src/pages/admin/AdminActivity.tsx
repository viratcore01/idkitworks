import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, downloadCsv, useOpsScope } from './_shared';

const ACTION_LABEL: Record<string, string> = {
  ban: 'Banned user',
  unban: 'Unbanned user',
  'role:admin': 'Made moderator',
  'role:user': 'Removed moderator',
  'verify:approve': 'Verified ID',
  'verify:reject': 'Rejected ID',
  takedown: 'Took down content',
  announce: 'Sent announcement',
  'report:dismiss': 'Dismissed report',
  'report:delete_content': 'Resolved: deleted content',
  'report:ban_user': 'Resolved: banned user',
};

/** Who did what: the audit trail behind every moderation action. */
export default function AdminActivity() {
  const { withCollege, collegeId } = useOpsScope();
  const [actor, setActor] = useState('');

  const path = withCollege(`/admin/activity${actor ? `?actorId=${encodeURIComponent(actor)}` : ''}`);
  const { data, isLoading } = useQuery({
    queryKey: ['ops-activity', path],
    queryFn: () => api.get(path).then((r) => r.data),
  });

  const items: any[] = data?.items || [];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">Activity</h1>
          <p className="text-sm text-slate-400">{data?.total ?? 0} staff actions on record</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ScopeSelect />
          <button
            onClick={() => downloadCsv('activity.csv', items.map((l: any) => ({ at: l.createdAt, actor: l.actor?.username, action: l.action, targetType: l.targetType, targetId: l.targetId, college: l.college?.shortName || l.college?.name, reason: l.reason })))}
            className="text-xs px-3 py-2 border border-white/20 text-slate-200 hover:border-[#FBBF24]"
            title="Export visible activity to CSV"
          >
            <Download size={13} className="inline mr-1" /> CSV
          </button>
        </div>
      </div>

      <input
        value={actor}
        onChange={(e) => setActor(e.target.value)}
        placeholder="Filter by actor user-id…"
        className="w-full sm:max-w-xs bg-[#151D31] border border-white/20 px-3 py-2 text-sm mb-4 outline-none focus:border-[#FBBF24] placeholder:text-slate-500 font-mono"
        aria-label="Filter activity by actor id"
      />

      {isLoading ? <p className="text-slate-400 text-sm p-8">Loading trail…</p> : items.length === 0 ? (
        <p className="text-slate-400 text-sm bg-[#151D31] border border-white/10 p-8 text-center">No staff actions recorded yet — bans, decisions and takedowns land here.</p>
      ) : (
        <div className="bg-[#151D31] border border-white/10 divide-y divide-white/10">
          {items.map((l: any) => (
            <div key={l.id} className="px-4 py-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-white">{ACTION_LABEL[l.action] || l.action}</span>
              <span className="text-slate-400">by @{l.actor?.username || '?'}</span>
              {l.targetId && <span className="text-xs font-mono text-slate-500 truncate max-w-[220px]">{l.targetType}:{l.targetId.slice(0, 8)}…</span>}
              {l.college && <span className="text-xs text-slate-400">· {l.college.shortName || l.college.name}</span>}
              {l.reason && <span className="text-xs text-slate-500 italic truncate max-w-[280px]">“{l.reason}”</span>}
              <span className="text-xs text-slate-500 ml-auto">{new Date(l.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-4">Scope: {collegeId || 'all colleges you may moderate'} · append-only, nobody can edit this.</p>
    </div>
  );
}
