import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import { ScopeSelect, OpsCard, TrendChart, useOpsScope } from './_shared';

/** Morning brief: health numbers, 14-day trends, live attention queues. */
export default function AdminOverview() {
  const { withCollege, collegeId, setCollegeId } = useOpsScope();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['ops-overview', collegeId],
    queryFn: () => api.get(withCollege('/admin/overview')).then((r) => r.data),
  });
  const { data: trends } = useQuery({
    queryKey: ['ops-trends', collegeId],
    queryFn: () => api.get(withCollege('/admin/trends?days=14')).then((r) => r.data),
  });

  if (isLoading) return <p className="text-slate-400 text-sm p-8">Loading ops brief…</p>;
  const t = data?.totals || {};
  const cards = [
    { label: 'Users', value: t.users, sub: `${t.banned || 0} banned` },
    { label: 'Unverified', value: t.pendingVerifications, alert: (t.pendingVerifications || 0) > 0, to: '/admin/ids' },
    { label: 'Pending reports', value: t.pendingReports, alert: (t.pendingReports || 0) > 0, to: '/admin/reports' },
    { label: 'Posts', value: t.posts, sub: `${t.posts24h || 0} in 24h` },
    { label: 'Active matches', value: t.activeMatches },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight">Morning brief</h1>
          <p className="text-sm text-slate-400">{collegeId ? 'Single-college view' : 'Whole network'} · numbers refresh every 30s</p>
        </div>
        <div className="ml-auto"><ScopeSelect /></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => c.to && navigate(c.to)}
            className={`bg-[#151D31] border p-4 text-center transition-colors ${c.alert ? 'border-[#F43F5E]' : 'border-white/10'} ${c.to ? 'hover:border-[#FBBF24] cursor-pointer' : ''}`}
          >
            <p className={`font-display font-black text-2xl ${c.alert ? 'text-[#F43F5E]' : 'text-white'}`}>{c.value ?? 0}</p>
            <p className="text-xs font-semibold mt-1 text-slate-300">{c.label}</p>
            {c.sub && <p className="text-[11px] text-slate-500">{c.sub}</p>}
          </button>
        ))}
      </div>

      <OpsCard className="mb-4">
        <h2 className="font-display font-bold mb-3 text-white">Last 14 days</h2>
        <TrendChart
          series={trends?.series || []}
          lines={[
            { key: 'signups', label: 'Signups', color: '#60A5FA' },
            { key: 'posts', label: 'Posts', color: '#10B981' },
            { key: 'matches', label: 'Matches', color: '#F43F5E' },
            { key: 'reports', label: 'Reports', color: '#FBBF24' },
          ]}
        />
      </OpsCard>

      {(data?.colleges || []).map((c: any) => (
        <OpsCard key={c.id} className="mb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px]">
              <p className="font-display font-bold text-white">{c.shortName || c.name}</p>
              <p className="text-xs text-slate-400">{c.users} users · {c.posts} posts · {c.activeMatches} matches</p>
            </div>
            {(c.needsAttention || 0) > 0 && <span className="text-xs font-bold text-[#F43F5E]">{c.needsAttention} need review</span>}
          </div>
          <div className="mt-2 pt-2 border-t border-white/10">
            <p className="text-[11px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">Who rules this campus</p>
            {(c.staff || []).length === 0 ? (
              <p className="text-xs text-slate-500">No moderators assigned — this campus runs unmoderated.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(c.staff || []).map((s: any) => (
                  <span key={s.id} className="text-[11px] px-2 py-1 bg-[#6D28D9]/30 border border-[#6D28D9] text-slate-100">
                    @{s.username}{s.moderatedCollegeId && s.moderatedCollegeId !== c.id ? ' (visiting)' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </OpsCard>
      ))}

      {(data?.attention?.verifications?.length || data?.attention?.reports?.length) ? (
        <OpsCard className="mb-4">
          <h2 className="font-display font-bold mb-3 text-white">Needs attention anywhere</h2>
          <div className="space-y-2 text-sm text-slate-300">
            {(data.attention.verifications || []).slice(0, 5).map((v: any) => (
              <p key={v.id || v.user?.id}>🪪 <b className="text-white">{v.user?.displayName || 'Student'}</b> (@{v.user?.username || '?'}) · {v.user?.college?.shortName || v.user?.college?.name || 'no college'}</p>
            ))}
            {(data.attention.reports || []).slice(0, 5).map((r: any) => (
              <p key={r.id}>🚩 {r.targetType || 'content'} reported ({r.reason || 'no reason'}) · @{r.reporter?.username || '?'} · {r.reporter?.college?.shortName || r.reporter?.college?.name || 'no college'}</p>
            ))}
          </div>
        </OpsCard>
      ) : null}

      {(data?.biggest || []).length > 0 && (
        <OpsCard>
          <h2 className="font-display font-bold mb-3 text-white">Biggest colleges — tap to take scope</h2>
          <div className="flex flex-wrap gap-2">
            {(data.biggest || []).slice(0, 12).map((c: any) => (
              <button
                key={c.id || 'none'}
                onClick={() => { if (c.id) { setCollegeId(c.id); navigate('/admin/reports'); } }}
                className="text-xs px-3 py-1.5 border border-white/20 text-slate-200 hover:border-[#FBBF24] hover:text-white"
                disabled={!c.id}
              >
                {c.shortName || c.name} · {c.users}
              </button>
            ))}
          </div>
        </OpsCard>
      )}
    </div>
  );
}
