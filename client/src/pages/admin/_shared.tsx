import { useQuery } from '@tanstack/react-query';
import { GraduationCap, ChevronDown } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth.store';

/** Shared moderation scope: super-admins narrow every tab with ?college=.
 * College admins are locked to their campus (enforced server-side too). */
export function useOpsScope() {
  const { user } = useAuthStore();
  const [params, setParams] = useSearchParams();
  const isSuper = user?.role === 'super_admin';
  const collegeId = isSuper ? params.get('college') || '' : '';
  const setCollegeId = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('college', id);
    else next.delete('college');
    setParams(next, { replace: true });
  };
  /** Append the scope to any ops API path. */
  const withCollege = (path: string) =>
    collegeId ? `${path}${path.includes('?') ? '&' : '?'}collegeId=${collegeId}` : path;
  return { isSuper, collegeId, setCollegeId, withCollege };
}

export function ScopeSelect() {
  const { isSuper, collegeId, setCollegeId } = useOpsScope();
  const { data } = useQuery({
    queryKey: ['ops-colleges'],
    queryFn: () => api.get('/admin/overview').then((r) => r.data),
    staleTime: 60_000,
    enabled: isSuper,
  });
  if (!isSuper) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <GraduationCap size={16} className="text-[#FBBF24]" />
      <span className="relative inline-flex items-center">
        <select
          value={collegeId}
          onChange={(e) => setCollegeId(e.target.value)}
          className="bg-[#151D31] border border-white/20 pl-3 pr-8 py-2 text-sm appearance-none max-w-[240px] outline-none focus:border-[#FBBF24]"
          aria-label="Filter console to a college"
        >
          <option value="">All colleges</option>
          {(data?.biggest || []).map((c: any) => (
            <option key={c.id || 'none'} value={c.id || ''}>
              {c.shortName || c.name} ({c.users})
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2 pointer-events-none text-slate-400" />
      </span>
    </label>
  );
}

export function OpsCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-[#151D31] border border-white/10 p-4 ${className}`}>{children}</div>;
}

export function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function InitialAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return (
    <span className={`${cls} bg-[#6D28D9] text-white font-bold inline-flex items-center justify-center shrink-0`}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Minimal SVG trend chart: up to 3 series over the same day axis. */
export function TrendChart({ series, lines }: {
  series: { date: string; [k: string]: any }[];
  lines: { key: string; label: string; color: string }[];
}) {
  const W = 560;
  const H = 150;
  const P = 8;
  if (!series.length) return <p className="text-sm text-slate-400">No data yet.</p>;
  const max = Math.max(1, ...series.flatMap((d) => lines.map((l) => Number(d[l.key]) || 0)));
  const x = (i: number) => P + (i * (W - P * 2)) / Math.max(series.length - 1, 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const path = (key: string) => series.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(d[key]) || 0).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trend chart">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.08)" />
        ))}
        {lines.map((l) => (
          <path key={l.key} d={path(l.key)} fill="none" stroke={l.color} strokeWidth="2.5" />
        ))}
        {series.map((d, i) =>
          i % Math.ceil(series.length / 7) === 0 ? (
            <text key={d.date} x={x(i)} y={H - 1} fontSize="8" fill="#64748B" textAnchor="middle">
              {d.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="flex flex-wrap gap-3 mt-1">
        {lines.map((l) => (
          <span key={l.key} className="text-xs text-slate-300 inline-flex items-center gap-1.5">
            <span className="w-3 h-[3px] inline-block" style={{ background: l.color }} /> {l.label}
          </span>
        ))}
        <span className="text-xs text-slate-500 ml-auto">peak {max}/day</span>
      </div>
    </div>
  );
}
