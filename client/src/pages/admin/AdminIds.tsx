import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import api from '@/services/api';
import { ScopeSelect, InitialAvatar, useOpsScope } from './_shared';

/**
 * Pending verifications: students who picked a college but haven't completed
 * college-email OTP verification yet. Verification is fully automatic now
 * (OTP to the college domain) — there is nothing to approve or reject here.
 * This list is visibility only; full files live under Users.
 */
export default function AdminIds() {
  const { withCollege, collegeId } = useOpsScope();

  const listPath = withCollege('/admin/users?filter=unverified&limit=50');
  const { data, isLoading } = useQuery({
    queryKey: ['ops-ids', listPath],
    queryFn: () => api.get(listPath).then((r) => r.data),
  });

  if (isLoading) return <p className="text-slate-400 text-sm p-8">Loading queue…</p>;
  const items: any[] = data?.users || [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">Pending verifications</h1>
          <p className="text-sm text-slate-400">{data?.total ?? 0} unverified · automatic via college-email OTP — nothing to approve</p>
        </div>
        <div className="ml-auto"><ScopeSelect /></div>
      </div>

      {items.length === 0 ? (
        <p className="text-slate-400 text-sm bg-[#151D31] border border-white/10 p-8 text-center">Everyone in scope is verified. Nothing waiting.</p>
      ) : (
        <div className="space-y-2">
          {items.map((u: any) => (
            <div key={u.id} className="bg-[#151D31] border border-white/10 p-3.5 flex flex-wrap items-center gap-2.5">
              <InitialAvatar name={u.displayName} size="sm" />
              <span className="flex-1 min-w-[160px]">
                <span className="block font-semibold text-sm truncate text-white">{u.displayName} <span className="opacity-50 font-normal">@{u.username}</span></span>
                <span className="block text-xs text-slate-400 truncate">{u.college?.shortName || u.college?.name || 'no college'} · joined {new Date(u.createdAt).toLocaleDateString()}</span>
              </span>
              <span className={`text-[11px] font-bold px-2 py-0.5 ${u.collegeEmailVerified ? 'bg-[#10B981] text-[#0F172A]' : 'bg-white/10 text-slate-200'}`}>
                {u.collegeEmailVerified ? 'EMAIL OK' : u.collegeEmail ? 'OTP PENDING' : 'NO EMAIL'}
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 bg-white/10 text-slate-200">{u.verificationStatus}</span>
              <Link to={`/admin/users?inspect=${u.id}`} className="text-xs font-bold px-3 py-1.5 border border-white/25 text-slate-200 hover:border-white">
                Open file
              </Link>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-4 flex items-center gap-1.5">
        <ShieldCheck size={13} /> Scope: {collegeId || 'all colleges you may moderate'} · students verify themselves with a code sent to their college email.
      </p>
    </div>
  );
}
